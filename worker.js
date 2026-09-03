/**
 * Cloudflare Worker entry point.
 *
 * This project uses Cloudflare's unified "Workers + static assets" model
 * (not classic Pages Functions). Static files live under /public and are
 * served automatically via the ASSETS binding (see wrangler.json). This
 * script only needs to handle the one dynamic route: /api/generate-example,
 * which calls Google's free-tier Gemini API on the server so the API key
 * never reaches the browser. Any other request falls through to ASSETS.
 */

const GENERATE_EXAMPLE_PATH = '/api/generate-example';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === GENERATE_EXAMPLE_PATH) {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'POST required' }, 405);
      }
      return handleGenerateExample(request, env);
    }

    // Everything else (index.html, app.js, styles.css, etc.) is served
    // from the static assets directory configured in wrangler.json.
    return env.ASSETS.fetch(request);
  }
};

async function handleGenerateExample(request, env) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[generate-example] GEMINI_API_KEY is not set');
    return jsonResponse({ error: 'GEMINI_API_KEY is not configured' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  const word = String(body?.word || '').trim();
  const meaning = String(body?.meaning || '').trim();
  const pos = String(body?.partOfSpeech || '').trim();
  const answerForm = String(body?.answerForm || word).trim();

  if (!word || !meaning) {
    return jsonResponse({ error: 'word and meaning are required' }, 400);
  }

  console.log(`[generate-example] requesting sentence for "${word}" (${pos || 'pos unknown'})`);

  // "gemini-flash-lite-latest" is Google's rolling alias for the current
  // free-tier Flash-Lite model, so this keeps working as Google renames
  // the underlying model over time. Override with GEMINI_MODEL if needed.
  const model = env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const systemInstruction = `You are an expert English teacher creating Eiken (英検) Grade 2 vocabulary questions for Japanese learners.
Create ONE natural, idiomatic English sentence that teaches the exact target word meaning supplied below.
Rules:
- Use the target word exactly as the requested answer form when grammatically appropriate.
- The sentence must sound like something a native speaker would actually say or write, not a mechanical template.
- Give the target word a clear semantic role; do not use an unrelated compound/idiom sense (for example, do not teach "tub" only through "hot tub").
- Match the supplied part of speech. Never invent a verb use for an adjective or noun, and never use an adjective as if it were a noun or verb.
- Make the grammar frame fit the target word naturally. For example, adjectives normally do not follow "to" as if they were verbs.
- Use realistic everyday, school, work, travel, news, family, or social contexts appropriate for Eiken Grade 2 (avoid childish or overly literary language).
- Vary sentence structure and topic each time; do not default to the same generic frame (e.g. avoid always starting with "The team..." or "She decided to...").
- Prefer 8-22 words, but prioritize naturalness over the exact count.
- Do not put blanks, quotation marks around the target word, explanations, or multiple alternatives in the output.
- Respond with ONLY a single-line JSON object and nothing else: {"ex":"...","ja":"..."}
- "ja" must be a natural, fluent Japanese translation of the exact English sentence in "ex".`;

  const userInput = `Target word: ${word}\nAnswer form: ${answerForm}\nPart of speech: ${pos || 'infer from the English word'}\nJapanese meaning: ${meaning}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: userInput }] }],
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.9
          }
        }),
        signal: controller.signal
      }
    );

    const data = await upstream.json();
    if (!upstream.ok) {
      // 429 = free-tier rate limit hit. The client falls back to local
      // templates in this case, so this is not a fatal error for the game.
      console.log(`[generate-example] Gemini error ${upstream.status}: ${data?.error?.message || 'unknown'}`);
      return jsonResponse(
        { error: data?.error?.message || 'Upstream AI error' },
        upstream.status === 429 ? 429 : 502
      );
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => String(part?.text || ''))
      .join('')
      .trim();

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch (_) {}
      }
    }

    if (!parsed?.ex) {
      console.log('[generate-example] Gemini returned no usable sentence');
      return jsonResponse({ error: 'AI returned no sentence' }, 502);
    }

    console.log(`[generate-example] success: "${parsed.ex}"`);
    return jsonResponse({
      ex: String(parsed.ex).trim(),
      ja: String(parsed.ja || '').trim(),
      source: 'ai-server'
    }, 200);
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'AI request timed out' : 'AI request failed';
    return jsonResponse({ error: message }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
