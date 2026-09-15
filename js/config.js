// Spotify Web App Configuration
// Note: Backend secrets (Neon DB & Gemini API) are managed securely via Vercel Environment Variables!
const CONFIG = {
  // Public Spotify Client ID (Safe in frontend for OAuth PKCE flow)
  CLIENT_ID: "c87036a104344b4ab73cbad19964df75",

  // Optional client-side fallback keys (left blank for security, handled by /api/ endpoints on Vercel)
  GEMINI_API_KEY: "",
  NEON_CONN_STRING: "",
  NEON_ENDPOINT: "",

  // Redirect URI automatically detects whether you are running locally or on Vercel
  REDIRECT_URI: (window.location.origin + window.location.pathname).replace(/\/index\.html$/, '/'),
  POLL_INTERVAL_MS: 3000,
  
  // CDN for Kuromoji dictionary files
  KUROMOJI_DICT_PATH: "https://cdn.jsdelivr.net/gh/takuyaa/kuromoji.js@gh-pages/demo/kuromoji/dict/"
};
