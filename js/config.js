// Spotify Web App Configuration
// Backend secrets (Neon DB connection string) live ONLY in Vercel Environment Variables.
const CONFIG = {
  // Public Spotify Client ID (safe in frontend for the OAuth PKCE flow)
  CLIENT_ID: "c87036a104344b4ab73cbad19964df75",

  // Redirect URI automatically detects whether you are running locally or on Vercel
  REDIRECT_URI: (window.location.origin + window.location.pathname).replace(/\/index\.html$/, '/'),
  POLL_INTERVAL_MS: 3000,

  // Spotify OAuth scopes: read playback + control playback (play/pause/skip/seek needs Premium)
  SPOTIFY_SCOPES: 'user-read-currently-playing user-read-playback-state user-modify-playback-state'
};
