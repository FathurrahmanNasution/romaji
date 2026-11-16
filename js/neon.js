/**
 * Lyrics cloud cache client.
 * Talks ONLY to the /api/lyrics serverless function. Database credentials stay
 * on the server (Vercel env var NEON_CONN_STRING) and never reach the browser.
 */

const NEON = {
  async getLyrics(trackId, trackTitle, artistName) {
    try {
      const params = new URLSearchParams({
        trackId: trackId || '',
        trackTitle: trackTitle || '',
        artistName: artistName || ''
      });
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 12000); // Vercel/Neon cold starts can be slow
      const apiRes = await fetch(`/api/lyrics?${params}`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!apiRes.ok) return null;

      const data = await apiRes.json().catch(() => null);
      if (data && data.found && data.lyrics) {
        console.log('✅ Loaded from Neon DB via /api/lyrics:', trackTitle);
        return data.lyrics;
      }
    } catch (e) {
      // /api not available (e.g. plain static server during local dev) — just skip the cache
    }
    return null;
  },

  async saveLyrics(trackId, trackTitle, artistName, lyricsData) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 12000);
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
    } catch (e) {
      // /api not available — nothing to do
    }
    return false;
  }
};
