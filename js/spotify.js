/**
 * Spotify Player API Wrapper
 */

const SPOTIFY = {
  async fetchCurrentlyPlaying(token) {
    if (!token) return null;

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
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
  }
};
