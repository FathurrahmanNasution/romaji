// Spotify Web App Configuration
// Note: Backend secrets (Neon DB & Gemini API) are managed securely via Vercel Environment Variables!
const CONFIG = {
  // Public Spotify Client ID (Safe in frontend for OAuth PKCE flow)
  CLIENT_ID: "c87036a104344b4ab73cbad19964df75",

  // Neon Cloud Database Connection
  NEON_CONN_STRING: "postgresql://neondb_owner:npg_mfxoTXrF08Be@ep-muddy-glade-b3itscs5-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  NEON_ENDPOINT: "https://ep-muddy-glade-b3itscs5.c-4.ap-southeast-1.aws.neon.tech/sql",

  // Redirect URI automatically detects whether you are running locally or on Vercel
  REDIRECT_URI: (window.location.origin + window.location.pathname).replace(/\/index\.html$/, '/'),
  POLL_INTERVAL_MS: 3000,
  
  // CDN for Kuromoji dictionary files
  KUROMOJI_DICT_PATH: "https://cdn.jsdelivr.net/gh/takuyaa/kuromoji.js@gh-pages/demo/kuromoji/dict/"
};
