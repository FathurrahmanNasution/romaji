/**
 * Spotify Player API Wrapper
 */

const SPOTIFY = {
  async fetchCurrentlyPlaying(token) {
    if (!token) return null;

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      // 204 No Content means nothing is currently playing
      if (response.status === 204 || response.status === 202) {
        return { isPlaying: false, reason: 'nothing_playing' };
      }

      if (response.status === 401) {
        console.warn('Unauthorized Spotify request');
        return { isPlaying: false, reason: 'unauthorized' };
      }

      if (!response.ok) {
        throw new Error(`Spotify API HTTP Error ${response.status}`);
      }

      const data = await response.json();

      if (!data || !data.item) {
        return { isPlaying: false, reason: 'no_track_item' };
      }

      const item = data.item;
      const albumArt = item.album && item.album.images && item.album.images.length > 0
        ? item.album.images[0].url
        : '';

      const artists = item.artists ? item.artists.map(a => a.name).join(', ') : 'Unknown Artist';

      return {
        id: item.id,
        title: item.name,
        artist: artists,
        primaryArtist: item.artists && item.artists[0] ? item.artists[0].name : artists,
        albumArt: albumArt,
        durationMs: item.duration_ms || 0,
        progressMs: data.progress_ms || 0,
        isPlaying: data.is_playing || false,
        timestamp: data.timestamp || Date.now()
      };

    } catch (err) {
      console.error('Fetch currently playing error:', err);
      return null;
    }
  },

  /**
   * Low-level player command. Returns { ok, status, message }.
   * Spotify requires Premium for these endpoints and an active device.
   */
  async playerCommand(token, method, path) {
    if (!token) return { ok: false, status: 401, message: 'Not logged in' };
    try {
      const response = await fetch(`https://api.spotify.com/v1/me/player${path}`, {
        method,
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) return { ok: true, status: response.status };

      let message = '';
      try {
        const body = await response.json();
        message = (body && body.error && body.error.message) || '';
      } catch (e) { /* empty body */ }

      if (response.status === 404) {
        message = 'No active Spotify device. Open Spotify on a device and start playing first.';
      } else if (response.status === 403) {
        message = message.toLowerCase().includes('premium') || !message
          ? 'Playback control requires Spotify Premium.'
          : `Spotify refused the command: ${message}`;
      } else if (response.status === 401) {
        message = 'Missing playback permission. Please log out and log in again.';
      }
      return { ok: false, status: response.status, message: message || `Spotify error ${response.status}` };
    } catch (err) {
      return { ok: false, status: 0, message: 'Network error talking to Spotify' };
    }
  },

  play(token) { return this.playerCommand(token, 'PUT', '/play'); },
  pause(token) { return this.playerCommand(token, 'PUT', '/pause'); },
  next(token) { return this.playerCommand(token, 'POST', '/next'); },
  previous(token) { return this.playerCommand(token, 'POST', '/previous'); },
  seek(token, positionMs) {
    const pos = Math.max(0, Math.round(positionMs));
    return this.playerCommand(token, 'PUT', `/seek?position_ms=${pos}`);
  }
};
