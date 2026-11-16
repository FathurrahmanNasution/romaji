/**
 * Vercel Serverless Function: /api/lyrics
 * Secure proxy to Neon DB. The connection string lives ONLY in the
 * NEON_CONN_STRING environment variable and is never sent to the browser.
 */

const MAX_BODY_CHARS = 300_000; // ~300 KB of lyrics JSON is far more than any song needs

function neonSqlUrl(connString) {
  // Neon HTTP SQL endpoint lives on the (non-pooler) compute host
  const host = new URL(connString).hostname.replace('-pooler', '');
  return `https://${host}/sql`;
}

async function runQuery(connString, query, params) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000); // stay under Vercel's function limit
  try {
    const dbRes = await fetch(neonSqlUrl(connString), {
      method: 'POST',
      headers: {
        'Neon-Connection-String': connString,
        'Content-Type': 'application/json'
      },
      // Parameterized query: values are never interpolated into SQL text
      body: JSON.stringify({ query, params }),
      signal: ctrl.signal
    });
    if (!dbRes.ok) {
      const detail = await dbRes.text().catch(() => '');
      throw new Error(`Neon HTTP ${dbRes.status} ${detail.slice(0, 200)}`);
    }
    return await dbRes.json();
  } finally {
    clearTimeout(tid);
  }
}

function isValidLyricsData(data) {
  return data && typeof data === 'object' && Array.isArray(data.lines) && data.lines.length > 0 &&
    data.lines.length <= 2000 &&
    data.lines.every(l => l && typeof l.text === 'string');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const connString = process.env.NEON_CONN_STRING;
  if (!connString) {
    return res.status(500).json({ error: 'NEON_CONN_STRING is not configured on the server' });
  }

  // GET: retrieve lyrics for a track
  if (req.method === 'GET') {
    const trackId = String(req.query.trackId || '').trim();
    const trackTitle = String(req.query.trackTitle || '').trim();
    const artistName = String(req.query.artistName || '').trim();

    if (!trackId && !trackTitle) {
      return res.status(400).json({ error: 'Missing trackId or trackTitle query parameter' });
    }

    try {
      // Exact Spotify track ID match first. Title match only as a fallback and it
      // must also match the artist, so two songs with the same title don't collide.
      const data = await runQuery(
        connString,
        `SELECT lyrics_data FROM lyrics
         WHERE track_id = $1
            OR ($2 <> '' AND $3 <> '' AND track_title ILIKE $2 AND artist_name ILIKE $3)
         ORDER BY (track_id = $1) DESC
         LIMIT 1`,
        [trackId, trackTitle, artistName]
      );

      const row = data.rows && data.rows[0];
      if (row && row.lyrics_data) {
        return res.status(200).json({ found: true, lyrics: row.lyrics_data });
      }
      return res.status(200).json({ found: false });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  // POST: insert or update lyrics for a track
  if (req.method === 'POST') {
    const body = req.body || {};
    const trackId = String(body.trackId || '').trim().slice(0, 200);
    const trackTitle = String(body.trackTitle || '').trim().slice(0, 500);
    const artistName = String(body.artistName || '').trim().slice(0, 500);
    const lyricsData = body.lyricsData;

    if (!trackId || !isValidLyricsData(lyricsData)) {
      return res.status(400).json({ error: 'Missing trackId or invalid lyricsData in request body' });
    }

    const jsonData = JSON.stringify(lyricsData);
    if (jsonData.length > MAX_BODY_CHARS) {
      return res.status(413).json({ error: 'lyricsData too large' });
    }

    try {
      await runQuery(
        connString,
        `INSERT INTO lyrics (track_id, track_title, artist_name, lyrics_data)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (track_id) DO UPDATE SET
           track_title = EXCLUDED.track_title,
           artist_name = EXCLUDED.artist_name,
           lyrics_data = EXCLUDED.lyrics_data`,
        [trackId, trackTitle, artistName, jsonData]
      );
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
