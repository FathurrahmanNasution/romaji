/**
 * Vercel Serverless Function: /api/gemini
 * Secure proxy to Google Gemini API so API key is hidden in serverless environment!
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured in Vercel environment' });
  }

  const { trackTitle, artistName } = req.body || {};
  if (!trackTitle) {
    return res.status(400).json({ error: 'Missing trackTitle in request body' });
  }

  const models = [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.8-flash'
  ];

  const promptText = `Provide the full lyrics for the song titled "${trackTitle}" by "${artistName || ''}".
If the song is in Japanese, translate each line into Romaji transliteration line-by-line.
Return ONLY valid JSON matching this exact structure:
{
  "found": true,
  "lines": [
    { "original": "Japanese line 1", "romaji": "Romaji line 1" },
    { "original": "Japanese line 2", "romaji": "Romaji line 2" }
  ]
}
If you know the song, always return "found": true with the lines array.`;

  let lastError = null;

  for (const model of models) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        lastError = errJson.error?.message || `HTTP ${response.status}`;
        continue;
      }

      const result = await response.json();
      const parts = result.candidates?.[0]?.content?.parts || [];
      
      let candidate = '';
      for (const part of parts) {
        if (part.text && (part.text.includes('{') || part.text.includes('found') || part.text.includes('lines'))) {
          candidate = part.text;
          break;
        }
      }
      if (!candidate && parts.length > 0) {
        candidate = parts[parts.length - 1].text || '';
      }

      if (!candidate) continue;

      let jsonStr = candidate.trim();
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

      const parsed = JSON.parse(jsonStr);
      if (parsed.found && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
        return res.status(200).json({
          found: true,
          lines: parsed.lines,
          model: model
        });
      }

      if (parsed.found === false) {
        return res.status(200).json({ found: false, message: parsed.message || 'Lyrics not found' });
      }

    } catch (err) {
      lastError = err.message;
    }
  }

  return res.status(200).json({ found: false, message: lastError || 'Gemini AI search failed' });
}
