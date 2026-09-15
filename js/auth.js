/**
 * Spotify PKCE Authentication Manager
 */

const AUTH = {
  // Generate random string for code_verifier
  generateCodeVerifier(length = 64) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values).map(x => possible[x % possible.length]).join('');
  },

  // Calculate SHA-256 hash and base64url encode it for code_challenge
  async generateCodeChallenge(codeVerifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  },

  // Start Spotify Login Redirect
  async login() {
    if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.includes('PASTE_SPOTIFY_CLIENT_ID')) {
      alert('Please set your Spotify Client ID in js/config.js first!');
      return;
    }

    const verifier = this.generateCodeVerifier();
    sessionStorage.setItem('spotify_code_verifier', verifier);

    const challenge = await this.generateCodeChallenge(verifier);
    const scope = 'user-read-currently-playing user-read-playback-state';

    const params = new URLSearchParams({
      client_id: CONFIG.CLIENT_ID,
      response_type: 'code',
      redirect_uri: CONFIG.REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: scope
    });

    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
  },

  // Process Authorization Code return from Spotify
  async handleCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    if (error) {
      console.error('Spotify Auth Error:', error);
      this.clearUrlParams();
      return false;
    }

    if (!code) return false;

    const verifier = sessionStorage.getItem('spotify_code_verifier');
    if (!verifier) {
      console.error('Code verifier not found in sessionStorage');
      this.clearUrlParams();
      return false;
    }

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: CONFIG.CLIENT_ID,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: CONFIG.REDIRECT_URI,
          code_verifier: verifier
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error_description || 'Failed to exchange token');
      }

      const data = await response.json();
      this.storeTokens(data);
      sessionStorage.removeItem('spotify_code_verifier');
      this.clearUrlParams();
      return true;
    } catch (err) {
      console.error('Token Exchange Error:', err);
      this.clearUrlParams();
      return false;
    }
  },

  // Refresh access token using refresh token
  async refreshToken() {
    const refreshToken = localStorage.getItem('spotify_refresh_token');
    if (!refreshToken) return null;

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: CONFIG.CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        })
      });

      if (!response.ok) {
        console.warn('Refresh token failed, logging out');
        this.logout();
        return null;
      }

      const data = await response.json();
      this.storeTokens(data);
      return data.access_token;
    } catch (err) {
      console.error('Refresh Token Error:', err);
      return null;
    }
  },

  // Save tokens to localStorage
  storeTokens(data) {
    if (data.access_token) {
      localStorage.setItem('spotify_access_token', data.access_token);
    }
    if (data.refresh_token) {
      localStorage.setItem('spotify_refresh_token', data.refresh_token);
    }
    if (data.expires_in) {
      const expiresAt = Date.now() + (data.expires_in * 1000);
      localStorage.setItem('spotify_expires_at', expiresAt.toString());
    }
  },

  // Get valid token (auto refresh if expiring within 60s)
  async getValidToken() {
    const accessToken = localStorage.getItem('spotify_access_token');
    const expiresAt = parseInt(localStorage.getItem('spotify_expires_at') || '0', 10);

    if (!accessToken) return null;

    // Refresh if expires in less than 60 seconds
    if (Date.now() + 60000 >= expiresAt) {
      return await this.refreshToken();
    }

    return accessToken;
  },

  isLoggedIn() {
    return !!localStorage.getItem('spotify_access_token');
  },

  logout() {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('spotify_expires_at');
    sessionStorage.removeItem('spotify_code_verifier');
    window.location.reload();
  },

  clearUrlParams() {
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  }
};
