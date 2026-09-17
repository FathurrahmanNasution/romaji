/**
 * Neon DB Cloud Database Client (with Vercel API support)
 */

const NEON = {
  // Fetch lyrics: tries secure /api/lyrics first, falls back to direct endpoint if config exists
  async getLyrics(trackId, trackTitle) {
    try {
      const apiUrl = `/api/lyrics?trackId=${encodeURIComponent(trackId || '')}&trackTitle=${encodeURIComponent(trackTitle || '')}`;
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 12000); // 12s: Vercel cold starts can be slow
      const apiRes = await fetch(apiUrl, { signal: ctrl.signal });
      clearTimeout(tid);
      if (apiRes.ok) {
        let data;
        try { data = await apiRes.json(); } catch (e) { data = null; }
        if (data && data.found && data.lyrics) {
          console.log('✅ Loaded from Neon DB via /api/lyrics:', trackTitle);
          return data.lyrics;
        }
      }
    } catch (apiErr) {
      // /api route not found or local static environment
    }

    // Direct fallback if NEON_CONN_STRING is provided in config
    if (CONFIG.NEON_CONN_STRING && !CONFIG.NEON_CONN_STRING.includes('PASTE_NEON_CONN')) {
      try {
        const endpoint = CONFIG.NEON_ENDPOINT || "https://ep-muddy-glade-b3itscs5.c-4.ap-southeast-1.aws.neon.tech/sql";
        const cleanTitle = (trackTitle || '').replace(/'/g, "''").trim();
        const safeId = (trackId || '').replace(/'/g, "''").trim();

        const query = `
          SELECT lyrics_data, track_title, artist_name 
          FROM lyrics 
          WHERE track_id = '${safeId}' 
             OR track_title ILIKE '${cleanTitle}' 
          LIMIT 1;
        `;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Neon-Connection-String': CONFIG.NEON_CONN_STRING,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.rows && data.rows.length > 0 && data.rows[0].lyrics_data) {
            return data.rows[0].lyrics_data;
          }
        }
      } catch (err) {
        console.warn('Neon DB direct fallback error:', err);
      }
    }

    return null;
  },

  // Save lyrics: tries secure /api/lyrics first, falls back to direct endpoint
  async saveLyrics(trackId, trackTitle, artistName, lyricsData) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 12000); // 12s: Vercel cold starts can be slow
      const apiRes = await fetch('/api/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, trackTitle, artistName, lyricsData }),
        signal: ctrl.signal
      });
      clearTimeout(tid);

      if (apiRes.ok) {
        console.log('💾 Saved to Neon DB via /api/lyrics:', trackTitle);
        return true;
      }
    } catch (apiErr) {
      // /api route not found or local static environment
    }

    // Direct fallback if NEON_CONN_STRING is provided in config
    if (CONFIG.NEON_CONN_STRING && !CONFIG.NEON_CONN_STRING.includes('PASTE_NEON_CONN')) {
      try {
        const endpoint = CONFIG.NEON_ENDPOINT || "https://ep-muddy-glade-b3itscs5.c-4.ap-southeast-1.aws.neon.tech/sql";
        const safeId = (trackId || '').replace(/'/g, "''").trim();
        const safeTitle = (trackTitle || '').replace(/'/g, "''").trim();
        const safeArtist = (artistName || '').replace(/'/g, "''").trim();
        const jsonData = JSON.stringify(lyricsData);

        const query = `
          INSERT INTO lyrics (track_id, track_title, artist_name, lyrics_data)
          VALUES ('${safeId}', '${safeTitle}', '${safeArtist}', $LYRICS$${jsonData}$LYRICS$)
          ON CONFLICT (track_id) 
          DO UPDATE SET 
            track_title = EXCLUDED.track_title,
            artist_name = EXCLUDED.artist_name,
            lyrics_data = EXCLUDED.lyrics_data;
        `;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Neon-Connection-String': CONFIG.NEON_CONN_STRING,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query })
        });

        return response.ok;
      } catch (err) {
        console.warn('Neon DB direct save fallback error:', err);
      }
    }

    return false;
  }
};
