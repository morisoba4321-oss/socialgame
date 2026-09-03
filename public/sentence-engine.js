/*
 * Sentence Engine
 * -------------------------------------------------------------------------
 * - IndexedDB cache for previously generated/fetched sentences
 * - Optional server-side AI generation through /api/generate-example,
 *   which calls Google's free-tier Gemini API (no cost, rate-limited).
 *   This is only used as a fallback when the browser-side free corpora
 *   (Tatoeba / Free Dictionary, handled in app.js) don't have a hit.
 * - Shared grammar / part-of-speech validation used by every sentence
 *   source (corpora, AI, and local templates) before a sentence is shown.
 * - Short timeout so the game never waits long on the network.
 */
(function () {
  'use strict';

  const DB_NAME = 'word-guard-sentence-db-v3';
  const STORE = 'sentences';
  const DB_VERSION = 1;
  const API_URL = '/api/generate-example';
  const CACHE_TTL = 1000 * 60 * 60 * 24 * 30;

  function normalizeKey(word) {
    const w = String(word?.w || word || '').trim().toLowerCase();
    const m = String(word?.m || '').trim().slice(0, 120).toLowerCase();
    const p = String(word?.pos || '').trim().toLowerCase();
    return `${w}::${p}::${m}`;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('indexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    });
  }

  async function getCached(key) {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => {
          const value = req.result;
          if (!value || Date.now() - value.savedAt > CACHE_TTL) return resolve(null);
          resolve(value.data || null);
        };
        req.onerror = () => resolve(null);
      });
    } catch (_) { return null; }
  }

  async function putCached(key, data) {
    try {
      const db = await openDb();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key, savedAt: Date.now(), data });
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (_) {}
  }

  function targetForm(word) {
    return String(word?.answerForm || word?.w || '').trim();
  }

  function hasTarget(sentence, word) {
    const form = targetForm(word);
    const head = String(word?.w || '').trim();
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z])(?:${esc(form)}|${esc(head)})(?=$|[^A-Za-z])`, 'i').test(sentence);
  }

  function grammarCompatible(sentence, word) {
    const text = String(sentence || '').trim();
    const w = String(word?.w || '').trim();
    const form = targetForm(word);
    if (!text || !w || !form) return false;

    let pos = String(word?.pos || '').toLowerCase();
    if (typeof normalizePartOfSpeech === 'function') {
      pos = normalizePartOfSpeech(w, pos, String(word?.m || ''));
    }
    const e = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Adjectives must not be used as bare infinitives or after modal verbs.
    if (pos === 'adjective') {
      if (new RegExp(`\\bto\\s+${e}\\b`, 'i').test(text)) return false;
      if (new RegExp(`\\b(?:can|could|may|might|must|should|will|would|do|does|did)\\s+${e}\\b`, 'i').test(text)) return false;
      if (new RegExp(`\\b(?:a|an|the)\\s+${e}\\b`, 'i').test(text)) {
        // Some adjectives can be nominalized, but that is not desirable for Eiken vocab.
        return false;
      }
    }
    // Nouns should not be forced into a verb slot when the dictionary POS is noun.
    if (pos === 'noun' && new RegExp(`\\bto\\s+${e}\\b`, 'i').test(text)) return false;
    // Adverbs should not appear as the direct object of infinitive/modal constructions.
    if (pos === 'adverb' && new RegExp(`\\bto\\s+${e}\\b`, 'i').test(text)) return false;
    // Verbs should not be used as predicative adjectives after be.
    if (pos === 'verb' && new RegExp(`\\b(?:is|are|was|were|seem(?:s)?|become|became)\\s+${e}\\b`, 'i').test(text)) return false;

    return true;
  }

  function quality(sentence, word) {
    const text = String(sentence || '').trim();
    if (!text || text.length < 25 || text.length > 180) return -999;
    if (!/[.!?]$/.test(text)) return -999;
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length < 6 || tokens.length > 30) return -999;
    if (!hasTarget(text, word)) return -999;
    if (!grammarCompatible(text, word)) return -999;

    const bad = [
      /\bthe (?:word|answer)\b/i,
      /\bthis word\b/i,
      /\bmeans?\b/i,
      /\bfill in the blank\b/i,
      /\b___\b/i,
      /\bexample sentence\b/i,
      /\bto honorable\b/i
    ];
    if (bad.some(r => r.test(text))) return -999;

    let score = 70;
    if (tokens.length >= 9 && tokens.length <= 20) score += 12;
    if (/[,:;]/.test(text)) score += 4;
    if (/\b(?:because|although|while|before|after|when|if|so that|which|that)\b/i.test(text)) score += 8;
    if (/\b(?:people|company|school|government|family|students|workers|manager|doctor|researchers|police|community)\b/i.test(text)) score += 4;
    return score;
  }

  function cleanSentence(value) {
    let s = String(value || '').trim();
    s = s.replace(/^```(?:json|text)?/i, '').replace(/```$/i, '').trim();
    s = s.replace(/^['"]|['"]$/g, '').trim();
    return s;
  }

  const inflight = new Map();

  // Calls /api/generate-example, which uses Google's free-tier Gemini API
  // (no cost, but rate-limited). If the free tier's daily/per-minute quota
  // is hit, the endpoint returns 429 and the caller (app.js) simply moves
  // on to the local-template fallback, so the game never blocks on this.
  async function generate(word, options = {}) {
    const key = normalizeKey(word);
    if (!key) return null;
    if (inflight.has(key)) return inflight.get(key);

    const task = (async () => {
      const cached = await getCached(key);
      if (cached?.ex && quality(cached.ex, word) >= 70) return cached;

      const timeoutMs = Number(options.timeoutMs || 1800);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            word: String(word?.w || '').trim(),
            meaning: String(word?.m || '').trim(),
            partOfSpeech: String(word?.pos || '').trim(),
            answerForm: targetForm(word)
          })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const ex = cleanSentence(data?.ex || data?.sentence || '');
        if (quality(ex, word) < 70) return null;
        const result = {
          ex,
          ja: String(data?.ja || '').trim(),
          source: 'ai-server',
          answerForm: targetForm(word),
          score: quality(ex, word)
        };
        await putCached(key, result);
        return result;
      } catch (_) {
        return null;
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => inflight.delete(key));

    inflight.set(key, task);
    return task;
  }

  window.SentenceAI = {
    generate,
    quality,
    grammarCompatible,
    getCached
  };
})();
