/**
 * Vercel Serverless Function: /api/lyrics
 * Secure proxy to Neon DB so DB credentials are never exposed to the frontend!
 */

export default async function handler(req, res) {
  // Enable CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const connString = process.env.NEON_CONN_STRING;
  if (!connString) {
    return res.status(500).json({ error: 'NEON_CONN_STRING not set in Vercel environment' });
  }

  const neonHttpUrl = 'https://ep-muddy-glade-b3itscs5.c-4.ap-southeast-1.aws.neon.tech/sql';

  // GET: Retrieve lyrics for a track
  if (req.method === 'GET') {
    const { trackId, trackTitle } = req.query;
    if (!trackId && !trackTitle) {
      return res.status(400).json({ error: 'Missing trackId or trackTitle query parameter' });
    }

    const safeId = (trackId || '').replace(/'/g, "''").trim();
    const safeTitle = (trackTitle || '').replace(/'/g, "''").trim();

    const query = `
      SELECT lyrics_data, track_title, artist_name 
      FROM lyrics 
      WHERE track_id = '${safeId}' 
         OR track_title ILIKE '${safeTitle}' 
      LIMIT 1;
    `;

    try {
      const dbRes = await fetch(neonHttpUrl, {
        method: 'POST',
        headers: {
          'Neon-Connection-String': connString,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      });

      if (!dbRes.ok) {
        return res.status(dbRes.status).json({ error: 'Neon database query failed' });
      }

      const data = await dbRes.json();
      if (data.rows && data.rows.length > 0 && data.rows[0].lyrics_data) {
        return res.status(200).json({
          found: true,
          lyrics: data.rows[0].lyrics_data
        });
      }

      return res.status(200).json({ found: false });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST: Insert or update lyrics for a track
  if (req.method === 'POST') {
    const { trackId, trackTitle, artistName, lyricsData } = req.body;
    if (!trackId || !lyricsData) {
      return res.status(400).json({ error: 'Missing trackId or lyricsData in request body' });
    }

    const safeId = (trackId || '').replace(/'/g, "''").trim();
    const safeTitle = (trackTitle || '').replace(/'/g, "''").trim();
    const safeArtist = (artistName || '').replace(/'/g, "''").trim();
    const jsonData = JSON.stringify(lyricsData).replace(/'/g, "''");

    const query = `
      INSERT INTO lyrics (track_id, track_title, artist_name, lyrics_data)
      VALUES ('${safeId}', '${safeTitle}', '${safeArtist}', '${jsonData}')
      ON CONFLICT (track_id) 
      DO UPDATE SET 
        track_title = EXCLUDED.track_title,
        artist_name = EXCLUDED.artist_name,
        lyrics_data = EXCLUDED.lyrics_data;
    `;

    try {
      const dbRes = await fetch(neonHttpUrl, {
        method: 'POST',
        headers: {
          'Neon-Connection-String': connString,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      });

      if (!dbRes.ok) {
        return res.status(dbRes.status).json({ error: 'Failed to insert lyrics in Neon DB' });
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
