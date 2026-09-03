/**
 * Vercel Function: POST /api/generate-example
 * Keeps OPENAI_API_KEY on the server and returns one validated-format example.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST required' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'OPENAI_API_KEY is not configured' });
  }

  const body = req.body || {};
  const word = String(body?.word || '').trim();
  const meaning = String(body?.meaning || '').trim();
  const pos = String(body?.partOfSpeech || '').trim();
  const answerForm = String(body?.answerForm || word).trim();

  if (!word || !meaning) {
    return res.status(400).json({ error: 'word and meaning are required' });
  }

  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  const instructions = `You are an expert English teacher creating Eiken vocabulary questions for Japanese learners.
Create ONE natural, idiomatic English sentence that teaches the exact target word meaning supplied below.
Rules:
- Use the target word exactly as the requested answer form when grammatically appropriate.
- The sentence must sound like something a native speaker would actually say or write.
- Give the target word a clear semantic role; do not use an unrelated compound/idiom sense (for example, do not teach "tub" only through "hot tub").
- Match the supplied part of speech. Never invent a verb use for an adjective or noun.
- Make the grammar frame fit the target word. For example, adjectives normally do not follow "to" as if they were verbs.
- Use realistic everyday, school, work, travel, news, family, or social contexts appropriate for Eiken Grade 2.
- Avoid dictionary-like definitions, unnatural filler, and overly literary language.
- Prefer 8–22 words, but prioritize naturalness over the exact count.
- Return JSON only: {"ex":"...","ja":"..."}. The Japanese should naturally translate the sentence.
- Do not put blanks, quotation marks around the target word, explanations, or multiple alternatives in the output.`;

  const userInput = `Target word: ${word}\nAnswer form: ${answerForm}\nPart of speech: ${pos || 'infer from the English word'}\nJapanese meaning: ${meaning}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        instructions,
        input: userInput,
        max_output_tokens: 180
      }),
      signal: controller.signal
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(502).json({
        error: data?.error?.message || 'Upstream AI error'
      });
    }

    const text = String(data?.output_text || '').trim();
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
      return res.status(502).json({ error: 'AI returned no sentence' });
    }

    return res.status(200).json({
      ex: String(parsed.ex).trim(),
      ja: String(parsed.ja || '').trim(),
      source: 'ai-server'
    });
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'AI request timed out' : 'AI request failed';
    return res.status(502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
}
