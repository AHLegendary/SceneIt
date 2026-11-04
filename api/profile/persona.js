// POST /api/profile/persona   { axes: [{ genre, value, count, taste }], ranked }
//
// A one-line read on what kind of movie watcher someone is, written by an
// LLM from their genre stats. Needs OPENAI_API_KEY; without it the response
// is 204 and the app uses its built-in description instead. No movie titles
// or personal data are sent, only the genre numbers.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(204).end();

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const axes = Array.isArray(body.axes) ? body.axes.filter((a) => a && typeof a.genre === 'string' && a.count > 0).slice(0, 20) : [];
  if (!axes.length) return res.status(204).end();

  const summary = axes
    .map((a) => `${a.genre}: ${Math.round(a.count)} ranked, taste ${Math.round(a.taste)}/100, stat ${Math.round(a.value)}/100`)
    .join('; ');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.8,
        max_tokens: 80,
        messages: [
          {
            role: 'system',
            content:
              'You describe what kind of movie watcher someone is from their genre stats. Reply as JSON: {"title": <2-3 word archetype like "Thrill Chaser">, "text": <one sentence, max 22 words, second person, warm, specific to the strongest genres>}. No markdown.',
          },
          { role: 'user', content: `${body.ranked ?? 0} movies ranked. ${summary}` },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
    if (typeof parsed.title !== 'string' || typeof parsed.text !== 'string') throw new Error('Bad persona');
    res.setHeader?.('Cache-Control', 'no-store');
    return res.status(200).json({ title: parsed.title.slice(0, 40), text: parsed.text.slice(0, 200) });
  } catch (error) {
    console.error('Persona failed:', error.message);
    return res.status(204).end();
  }
}
