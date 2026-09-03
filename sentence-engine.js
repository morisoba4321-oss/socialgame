/*
 * Sentence Engine (free/offline build)
 * -------------------------------------------------------------------------
 * This app no longer calls any paid AI API. Example sentences come from
 * free, human-written corpora (Tatoeba, Free Dictionary API) first, and
 * fall back to curated local templates in app.js. This file now only
 * provides a shared grammar/part-of-speech sanity check that every source
 * (Tatoeba, Free Dictionary, local templates) is validated against before
 * a sentence is shown to the learner, so a POS mismatch (e.g. an adjective
 * slotted into a verb frame) never reaches the game.
 */
(function () {
  'use strict';

  function grammarCompatible(sentence, word) {
    const text = String(sentence || '').trim();
    const w = String(word?.w || '').trim();
    const form = String(word?.answerForm || w).trim();
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

  window.SentenceAI = {
    grammarCompatible
  };
})();
