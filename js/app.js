/**
 * Main Application Orchestrator
 */

const PLACEHOLDER_ART = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#282828"/>' +
  '<text x="50" y="62" font-size="40" text-anchor="middle" fill="#6a6a6a">♪</text></svg>'
);

const APP = {
  currentTrackId: null,
  currentTrackData: null,
  pollInterval: null,
  progressInterval: null,
  currentLyrics: null,
  activeLineIndex: -1,
  displayMode: 'both', // 'original', 'romaji', 'both'
  showTranslation: false,
  autoScroll: true,
  isDemoMode: false,
  currentProgressMs: 0,
  trackDurationMs: 0,
  syncOffsetMs: 0,
  isPlaying: false,

  // Incremented whenever a new track's lyrics start loading. Async work that
  // finishes after the track changed compares its token and drops its result.
  lyricsLoadToken: 0,
  // Timestamp of the last playback command, so a poll that started before it
  // (and carries stale state) doesn't undo the optimistic UI update.
  lastCommandAt: 0,
  isTranslating: false,

  // User scroll & interaction flags to prevent scroll jumping/freezing
  isUserInteracting: false,
  userScrollTimeout: null,
  isProgrammaticScroll: false,
  toastTimeout: null,

  // Demo Track Data when user has no Spotify Client ID set up yet
  DEMO_TRACK: {
    id: 'demo_yoasobi_idoru',
    title: 'アイドル (Idol)',
    artist: 'YOASOBI',
    primaryArtist: 'YOASOBI',
    albumArt: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80',
    durationMs: 213000,
    progressMs: 0,
    isPlaying: true
  },

  DEMO_LRC: `[00:00.00] 無敵の笑顔で荒らすメディア
[00:03.50] 知りたいその秘密
[00:07.10] 截然 (シャープ) でミステリアス
[00:10.00] 抜けてる部分すら彼女のエリア
[00:13.80] 完璧で嘘つきな君は
[00:17.50] 天才的なアイドル様
[00:21.00] 今日何食べた？好きな本は？
[00:24.50] 遊びに行くならどこに行くの？
[00:28.00] 何も食べてない、それは秘密
[00:31.50] 何を聞かれても のらりくらり
[00:35.00] そう淡々と だけど燦々と
[00:38.50] 見えそうで見えない秘密は蜜の味
[00:42.00] あれもない ない ない
[00:44.00] 好きなタイプは？ 相手は？
[00:46.50] さあ答えて！
[00:48.00] 誰かを好きになることなんて私分からなくてさ
[00:54.00] 嘘か本当か知り得ない
[00:57.00] そんな言葉に また一人堕ちる
[01:00.50] また好きにさせる`,

  async init() {
    this.flushLocalStorageLyrics();
    try { this.showTranslation = localStorage.getItem('show_translation') === '1'; } catch (e) {}
    this.setupEventListeners();
    this.updateTranslateButton();

    // Check if configuration requires setup
    const isConfigured = CONFIG.CLIENT_ID && !CONFIG.CLIENT_ID.includes('PASTE_SPOTIFY_CLIENT_ID');

    let authError = null;
    if (window.location.search.includes('error=')) {
      const urlParams = new URLSearchParams(window.location.search);
      authError = urlParams.get('error');
    }

    // Check if returning from Spotify Auth
    const isCallback = window.location.search.includes('code=') || !!authError;
    if (isCallback && isConfigured) {
      this.updateStatus('Authenticating with Spotify...');
      const success = await AUTH.handleCallback();
      if (success) {
        this.updateStatus('Authenticated successfully!');
      }
    }

    if (AUTH.isLoggedIn() && isConfigured) {
      this.showAuthenticatedState();
      this.startPolling();
    } else {
      this.showLoggedOutState(!isConfigured || !!authError);
      if (authError) {
        const notice = document.getElementById('config-notice');
        if (notice) {
          notice.classList.remove('hidden');
          notice.style.border = '1px solid #ff4d4d';
          notice.style.background = '#2a1212';
        }
      }
    }
  },

  setupEventListeners() {
    // Auth Buttons
    document.getElementById('login-btn')?.addEventListener('click', () => AUTH.login());
    document.getElementById('logout-btn')?.addEventListener('click', () => AUTH.logout());
    document.getElementById('demo-btn')?.addEventListener('click', () => this.startDemoMode());

    // Config Modal / Banner & Redirect URI copy
    const redirectCode = document.getElementById('display-redirect-uri');
    if (redirectCode && typeof CONFIG !== 'undefined') {
      redirectCode.textContent = CONFIG.REDIRECT_URI;
    }

    document.getElementById('copy-redirect-uri-btn')?.addEventListener('click', () => {
      const uri = CONFIG.REDIRECT_URI;
      navigator.clipboard.writeText(uri).then(() => {
        const btn = document.getElementById('copy-redirect-uri-btn');
        if (btn) {
          btn.textContent = 'Copied! ✅';
          setTimeout(() => { btn.textContent = 'Copy 📋'; }, 2000);
        }
      });
    });

    document.getElementById('save-config-btn')?.addEventListener('click', () => {
      const clientIdInput = document.getElementById('config-client-id').value.trim();
      if (clientIdInput) {
        CONFIG.CLIENT_ID = clientIdInput;
        AUTH.login();
      }
    });

    // Playback controls
    document.getElementById('ctrl-prev')?.addEventListener('click', () => this.controlPlayback('previous'));
    document.getElementById('ctrl-back')?.addEventListener('click', () => this.controlPlayback('seekBy', -10000));
    document.getElementById('ctrl-play')?.addEventListener('click', () => this.controlPlayback('toggle'));
    document.getElementById('ctrl-fwd')?.addEventListener('click', () => this.controlPlayback('seekBy', 10000));
    document.getElementById('ctrl-next')?.addEventListener('click', () => this.controlPlayback('next'));

    // Click / tap on the progress bar to seek
    document.getElementById('progress-bar-outer')?.addEventListener('click', (e) => {
      if (!this.trackDurationMs) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      this.controlPlayback('seekTo', ratio * this.trackDurationMs);
    });

    // Keyboard shortcuts: Space = play/pause, ←/→ = ±5s (ignored while typing)
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('logged-in-view')?.classList.contains('hidden')) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      if (e.code === 'Space') { e.preventDefault(); this.controlPlayback('toggle'); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); this.controlPlayback('seekBy', -5000); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); this.controlPlayback('seekBy', 5000); }
    });

    // Sync Timing Offset Adjustment Controls (-0.5s / +0.5s)
    const updateOffsetUI = () => {
      const display = document.getElementById('offset-val-display');
      if (display) {
        const sec = this.syncOffsetMs / 1000;
        display.textContent = `${sec > 0 ? '+' : ''}${sec.toFixed(1)}s`;
      }
      this.syncActiveLyricLine();
    };

    document.getElementById('offset-minus-btn')?.addEventListener('click', () => {
      this.syncOffsetMs -= 500;
      updateOffsetUI();
    });

    document.getElementById('offset-plus-btn')?.addEventListener('click', () => {
      this.syncOffsetMs += 500;
      updateOffsetUI();
    });

    // View Mode Controls
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.displayMode = e.currentTarget.dataset.mode;
        this.renderLyrics();
        this.scrollToActiveLine();
      });
    });

    // English translation toggle
    document.getElementById('translate-btn')?.addEventListener('click', () => {
      this.showTranslation = !this.showTranslation;
      try { localStorage.setItem('show_translation', this.showTranslation ? '1' : '0'); } catch (e) {}
      this.updateTranslateButton();
      this.renderLyrics();
      if (this.showTranslation) this.ensureTranslation();
    });

    // Auto-scroll toggle
    const scrollToggle = document.getElementById('autoscroll-toggle');
    if (scrollToggle) {
      scrollToggle.addEventListener('change', (e) => {
        this.autoScroll = e.target.checked;
        if (this.autoScroll && this.activeLineIndex >= 0) {
          this.scrollToActiveLine();
        }
      });
    }

    // Manual Paste Section Toggle
    const togglePasteBtn = document.getElementById('toggle-paste-btn');
    const manualPasteSection = document.getElementById('manual-paste-section');
    togglePasteBtn?.addEventListener('click', () => {
      manualPasteSection?.classList.toggle('hidden');
    });
    document.getElementById('cancel-manual-paste-btn')?.addEventListener('click', () => {
      manualPasteSection?.classList.add('hidden');
    });
    document.getElementById('submit-manual-paste-btn')?.addEventListener('click', async () => {
      const raw = document.getElementById('manual-lyrics-input')?.value;
      if (raw && raw.trim()) {
        manualPasteSection?.classList.add('hidden');
        await this.applyAndSaveCustomLyrics(raw, this.currentTrackData);
      }
    });

    // User scroll detection on Lyrics Container
    const container = document.getElementById('lyrics-container');
    if (container) {
      container.addEventListener('wheel', () => this.markUserInteracting(3500), { passive: true });
      container.addEventListener('touchmove', () => this.markUserInteracting(3500), { passive: true });
      container.addEventListener('scroll', () => {
        if (!this.isProgrammaticScroll) this.markUserInteracting(3500);
      }, { passive: true });
    }
  },

  markUserInteracting(ms) {
    this.isUserInteracting = true;
    if (this.userScrollTimeout) clearTimeout(this.userScrollTimeout);
    this.userScrollTimeout = setTimeout(() => {
      this.isUserInteracting = false;
    }, ms);
  },

  updateStatus(msg) {
    const el = document.getElementById('app-status');
    if (el) el.textContent = msg;
  },

  showToast(msg, { actionLabel, onAction, durationMs = 4500 } = {}) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = msg;
    toast.appendChild(text);
    if (actionLabel && onAction) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = actionLabel;
      btn.addEventListener('click', onAction);
      toast.appendChild(btn);
    }
    toast.classList.remove('hidden');
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => toast.classList.add('hidden'), durationMs);
  },

  showLoggedOutState(needsConfig = false) {
    document.getElementById('logged-in-view')?.classList.add('hidden');
    document.getElementById('logged-out-view')?.classList.remove('hidden');
    document.getElementById('logout-btn')?.classList.add('hidden');

    const configNotice = document.getElementById('config-notice');
    if (configNotice) {
      if (needsConfig) {
        configNotice.classList.remove('hidden');
      } else {
        configNotice.classList.add('hidden');
      }
    }
  },

  showAuthenticatedState() {
    document.getElementById('logged-out-view')?.classList.add('hidden');
    document.getElementById('logged-in-view')?.classList.remove('hidden');
    if (!this.isDemoMode) document.getElementById('logout-btn')?.classList.remove('hidden');
  },

  startPolling() {
    this.stopPolling();
    this.pollCurrentlyPlaying(); // immediate initial check
    this.pollInterval = setInterval(() => this.pollCurrentlyPlaying(), CONFIG.POLL_INTERVAL_MS);
  },

  stopPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.progressInterval) clearInterval(this.progressInterval);
  },

  async pollCurrentlyPlaying() {
    if (this.isDemoMode) return;
    const pollStartedAt = Date.now();

    const token = await AUTH.getValidToken();
    if (!token) {
      this.showLoggedOutState();
      return;
    }

    const data = await SPOTIFY.fetchCurrentlyPlaying(token);

    // A playback command was sent while this request was in flight: its state is stale
    if (pollStartedAt < this.lastCommandAt) return;

    if (data && data.reason === 'unauthorized') {
      AUTH.logout();
      return;
    }

    if (!data || data.reason) {
      // Network error (null), nothing playing, or no track item (e.g. ad / podcast)
      if (!data) return; // transient error: keep showing the last known state
      this.renderIdleState('Nothing playing on Spotify right now');
      return;
    }

    this.handlePlaybackState(data);
  },

  handlePlaybackState(data) {
    this.isPlaying = data.isPlaying;
    this.currentTrackData = data;

    // Use Spotify's exact playback position
    this.currentProgressMs = data.progressMs || 0;
    this.trackDurationMs = data.durationMs || 0;

    // Update Player UI Metadata
    document.getElementById('track-title').textContent = data.title;
    document.getElementById('track-artist').textContent = data.artist;
    const art = document.getElementById('album-art');
    const artSrc = data.albumArt || PLACEHOLDER_ART;
    if (art && art.src !== artSrc) art.src = artSrc;

    this.updateProgressUI();
    this.updatePlayButton();

    // Check if track changed (local files have no Spotify ID, so fall back to title+artist)
    const trackKey = data.id || `local:${data.title}|${data.artist}`;
    if (trackKey !== this.currentTrackId) {
      this.currentTrackId = trackKey;
      this.loadLyricsForTrack(data);
    }

    // Start progress timer
    this.startProgressTimer();
    this.syncActiveLyricLine();
  },

  startProgressTimer() {
    if (this.progressInterval) clearInterval(this.progressInterval);
    if (!this.isPlaying) return;

    const startTime = Date.now();
    const initialProgress = this.currentProgressMs;

    this.progressInterval = setInterval(() => {
      if (!this.isPlaying) return;
      const elapsed = Date.now() - startTime;
      this.currentProgressMs = Math.min(initialProgress + elapsed, this.trackDurationMs);
      this.updateProgressUI();
      this.syncActiveLyricLine();
      if (this.isDemoMode && this.currentProgressMs >= this.trackDurationMs) {
        this.isPlaying = false;
        this.updatePlayButton();
      }
    }, 250);
  },

  updateProgressUI() {
    const curSec = Math.floor(this.currentProgressMs / 1000);
    const durSec = Math.floor(this.trackDurationMs / 1000);

    document.getElementById('time-current').textContent = this.formatTime(curSec);
    document.getElementById('time-duration').textContent = this.formatTime(durSec);

    const percent = this.trackDurationMs > 0 ? (this.currentProgressMs / this.trackDurationMs) * 100 : 0;
    const progressBar = document.getElementById('progress-bar-inner');
    if (progressBar) progressBar.style.width = `${percent}%`;
  },

  updatePlayButton() {
    const btn = document.getElementById('ctrl-play');
    if (!btn) return;
    btn.innerHTML = this.isPlaying
      ? '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    btn.setAttribute('aria-label', this.isPlaying ? 'Pause' : 'Play');
    btn.title = this.isPlaying ? 'Pause (Space)' : 'Play (Space)';
  },

  formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  },

  /**
   * Playback control: 'toggle' | 'next' | 'previous' | 'seekBy' (value=deltaMs) | 'seekTo' (value=ms)
   * Updates the UI optimistically, sends the command to Spotify, then re-polls.
   */
  async controlPlayback(action, value) {
    // Resolve seek target
    let seekTarget = null;
    if (action === 'seekBy') seekTarget = this.currentProgressMs + value;
    if (action === 'seekTo') seekTarget = value;
    if (seekTarget !== null) {
      seekTarget = Math.min(Math.max(0, seekTarget), Math.max(0, this.trackDurationMs - 1000));
    }

    // Demo mode: simulate locally
    if (this.isDemoMode) {
      if (action === 'toggle') {
        this.isPlaying = !this.isPlaying;
        if (this.isPlaying && this.currentProgressMs >= this.trackDurationMs) this.currentProgressMs = 0;
      } else if (action === 'previous') {
        this.currentProgressMs = 0;
      } else if (action === 'next') {
        this.showToast('Demo mode has only one track. Log in with Spotify to skip tracks.');
        return;
      } else if (seekTarget !== null) {
        this.currentProgressMs = seekTarget;
      }
      this.applyLocalPlaybackChange();
      return;
    }

    if (!AUTH.hasScope('user-modify-playback-state')) {
      this.showToast('Playback control needs a new Spotify permission.', {
        actionLabel: 'Log in again',
        onAction: () => AUTH.login(),
        durationMs: 8000
      });
      return;
    }

    const token = await AUTH.getValidToken();
    if (!token) return;

    this.lastCommandAt = Date.now();
    const prevState = { isPlaying: this.isPlaying, progress: this.currentProgressMs };
    let result;

    if (action === 'toggle') {
      this.isPlaying = !this.isPlaying;
      this.applyLocalPlaybackChange();
      result = this.isPlaying ? await SPOTIFY.play(token) : await SPOTIFY.pause(token);
    } else if (action === 'next') {
      result = await SPOTIFY.next(token);
    } else if (action === 'previous') {
      result = await SPOTIFY.previous(token);
    } else if (seekTarget !== null) {
      this.currentProgressMs = seekTarget;
      this.applyLocalPlaybackChange();
      result = await SPOTIFY.seek(token, seekTarget);
    } else {
      return;
    }

    if (!result.ok) {
      // Roll back the optimistic change
      this.isPlaying = prevState.isPlaying;
      this.currentProgressMs = prevState.progress;
      this.applyLocalPlaybackChange();
      this.lastCommandAt = 0;
      const needsRelogin = result.status === 401;
      this.showToast(result.message, needsRelogin
        ? { actionLabel: 'Log in again', onAction: () => AUTH.login(), durationMs: 8000 }
        : undefined);
      return;
    }

    // Spotify applies commands asynchronously; give it a moment before re-reading state
    const delay = (action === 'next' || action === 'previous') ? 700 : 400;
    setTimeout(() => {
      this.lastCommandAt = 0;
      this.pollCurrentlyPlaying();
    }, delay);
  },

  applyLocalPlaybackChange() {
    this.updateProgressUI();
    this.updatePlayButton();
    this.startProgressTimer();
    this.syncActiveLyricLine(true);
  },

  async loadLyricsForTrack(trackData) {
    const token = ++this.lyricsLoadToken;
    const isStale = () => token !== this.lyricsLoadToken;

    this.currentLyrics = null;
    this.activeLineIndex = -1;
    this.renderLyricsLoading(`Fetching lyrics for "${trackData.title}"...`);

    // 1. Check Neon Cloud Database (shared cache across devices)
    if (!this.isDemoMode && typeof NEON !== 'undefined') {
      try {
        const cloudLyrics = await NEON.getLyrics(trackData.id, trackData.title, trackData.primaryArtist || trackData.artist);
        if (isStale()) return;
        if (cloudLyrics && cloudLyrics.lines && cloudLyrics.lines.length > 0) {
          this.setLyrics(cloudLyrics, true);
          this.updateStatus('Loaded from Neon Cloud Database! ☁️');
          if (this.showTranslation) this.ensureTranslation();
          return;
        }
      } catch (err) {
        console.warn('Neon check error:', err);
      }
    }

    let lyricResult;
    if (this.isDemoMode) {
      lyricResult = LYRICS.processLyricData({ syncedLyrics: this.DEMO_LRC });
    } else {
      lyricResult = await LYRICS.fetchLyrics(
        trackData.title,
        trackData.primaryArtist || trackData.artist,
        trackData.durationMs
      );
    }
    if (isStale()) return;

    if (!lyricResult.found || !lyricResult.lines || lyricResult.lines.length === 0) {
      this.renderLyricsError('Lyrics not found in database', trackData);
      return;
    }

    // Render original lyrics immediately so user sees lyrics right away
    this.setLyrics({
      isSynced: lyricResult.isSynced,
      source: lyricResult.source,
      lines: lyricResult.lines.map(l => ({
        ...l,
        romaji: null,
        isJapanese: ROMAJI.containsJapanese(l.text)
      }))
    }, true);

    // Start translation in parallel with romaji conversion (it doesn't depend on it)
    if (this.showTranslation) this.ensureTranslation();

    // Convert Japanese lyrics to Romaji in the background if needed
    const hasJapanese = lyricResult.lines.some(l => ROMAJI.containsJapanese(l.text));
    if (hasJapanese) {
      this.updateStatus('Converting Japanese lyrics to Romaji...');

      try {
        const processedLines = await ROMAJI.convertLyrics(lyricResult.lines, (msg) => {
          if (!isStale()) this.updateStatus(msg);
        });
        if (isStale()) return;

        // Keep any translations that arrived while romaji was converting
        this.mergeLines(processedLines);
        this.updateStatus('Lyrics ready!');
      } catch (romajiErr) {
        console.warn('Romaji conversion error (non-fatal):', romajiErr);
        this.updateStatus('Lyrics ready (Romaji unavailable)');
      }
    }

    // Cache in Neon so next time this song loads instantly (no LRCLIB/QQ lookup, no romaji wait)
    if (!isStale()) this.cacheCurrentLyrics();
  },

  cacheCurrentLyrics() {
    const t = this.currentTrackData;
    if (this.isDemoMode || !t || !t.id || !this.currentLyrics || typeof NEON === 'undefined') return;
    NEON.saveLyrics(t.id, t.title, t.primaryArtist || t.artist, this.currentLyrics)
      .catch(e => console.warn('Neon save error (non-fatal):', e));
  },

  // Replace the current lyrics. isNewTrack resets auto-scroll to a sensible default.
  setLyrics(lyrics, isNewTrack) {
    this.currentLyrics = lyrics;
    if (isNewTrack) {
      this.activeLineIndex = -1;
      this.setAutoscroll(!!lyrics.isSynced);
    }
    this.renderLyrics();
    this.syncActiveLyricLine(true);
  },

  // Merge romaji results into current lines without dropping translations
  mergeLines(processedLines) {
    if (!this.currentLyrics) return;
    const old = this.currentLyrics.lines;
    this.currentLyrics.lines = processedLines.map((l, i) => ({
      ...l,
      translation: l.translation || (old[i] && old[i].translation) || undefined
    }));
    this.renderLyrics();
    this.syncActiveLyricLine(true);
  },

  updateTranslateButton() {
    const btn = document.getElementById('translate-btn');
    if (!btn) return;
    btn.classList.toggle('active', this.showTranslation);
    btn.setAttribute('aria-pressed', this.showTranslation ? 'true' : 'false');
  },

  // Fetch English translations for the current lyrics if they're missing
  async ensureTranslation() {
    const lyrics = this.currentLyrics;
    if (!lyrics || !lyrics.lines || this.isTranslating) return;

    const needs = lyrics.lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.isJapanese && !l.translation && l.text.trim());
    if (needs.length === 0) return;

    const token = this.lyricsLoadToken;
    this.isTranslating = true;
    const btn = document.getElementById('translate-btn');
    if (btn) btn.classList.add('loading');
    this.updateStatus('Translating lyrics to English...');

    try {
      const translations = await TRANSLATE.translateLines(needs.map(({ l }) => l.text), 'en', 'auto');
      if (token !== this.lyricsLoadToken || this.currentLyrics !== lyrics) return; // track changed

      needs.forEach(({ i }, j) => {
        if (translations[j]) lyrics.lines[i].translation = translations[j];
      });
      this.renderLyrics();
      this.syncActiveLyricLine(true);
      this.updateStatus('Translation ready! 🌐');

      // Cache translations (plus romaji) in Neon so the next load is instant
      this.cacheCurrentLyrics();
    } catch (err) {
      console.warn('Translation failed:', err);
      if (token === this.lyricsLoadToken) this.showToast('English translation failed. Try again in a moment.');
    } finally {
      this.isTranslating = false;
      if (btn) btn.classList.remove('loading');
    }
  },

  renderLyricsLoading(message) {
    const container = document.getElementById('lyrics-container');
    if (container) {
      container.innerHTML = `
        <div class="lyrics-message">
          <div class="spinner"></div>
          <p>${this.escapeHtml(message)}</p>
        </div>
      `;
    }
  },

  renderLyricsError(message, trackData) {
    const container = document.getElementById('lyrics-container');
    if (!container) return;

    const queryStr = trackData ? `${trackData.title} ${trackData.artist} lyrics` : 'lyrics';
    const lrcQueryStr = trackData ? `${trackData.title} ${trackData.artist} lrc` : 'lyrics lrc';
    const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(queryStr)}`;
    const lrcSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(lrcQueryStr)}`;

    container.innerHTML = `
      <div class="lyrics-message" style="gap: 0.85rem; max-width: 540px; margin: 0 auto; text-align: center;">
        <div>
          <p class="error-text" style="font-weight: 700; font-size: 1.05rem; margin-bottom: 0.25rem;">ℹ️ Lyrics not in database</p>
          <p style="font-size: 0.85rem; color: var(--text-secondary);">Not found in LRCLIB or QQ Music. You can find synced .lrc or paste Japanese lyrics below.</p>
        </div>

        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center;">
          <a href="${lrcSearchUrl}" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration: none;">
            🎵 Find Synced (.LRC) on Google
          </a>
          <a href="${googleSearchUrl}" target="_blank" rel="noopener" class="btn btn-secondary" style="text-decoration: none;">
            🔍 Search Plain Lyrics
          </a>
        </div>

        <!-- Quick Paste Lyrics Box -->
        <div id="paste-lyrics-box" style="width: 100%; text-align: left; background: #111; padding: 0.85rem; border-radius: 12px; border: 1px dashed var(--accent-green); margin-top: 0.25rem;">
          <label for="custom-lyrics-input" style="font-size: 0.8rem; color: var(--accent-green); display: block; margin-bottom: 0.4rem; font-weight: 600;">
            📝 Paste lyrics or .LRC format below (saves to Neon Cloud & converts to Romaji):
          </label>
          <textarea id="custom-lyrics-input" rows="5" placeholder="Tip: Paste .LRC format [00:12.34] for exact karaoke sync, or plain Japanese text..." style="width: 100%; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.6rem; font-family: inherit; font-size: 0.85rem; resize: vertical; margin-bottom: 0.5rem;"></textarea>
          <button id="submit-custom-lyrics" class="btn btn-primary" style="width: 100%; justify-content: center;">Convert & Display Romaji</button>
        </div>
      </div>
    `;

    // Submit Custom Lyrics & Save permanently
    document.getElementById('submit-custom-lyrics')?.addEventListener('click', async () => {
      const rawText = document.getElementById('custom-lyrics-input')?.value;
      const submitBtn = document.getElementById('submit-custom-lyrics');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Converting to Romaji...';
      }
      await this.applyAndSaveCustomLyrics(rawText, trackData);
    });
  },

  async applyAndSaveCustomLyrics(rawText, trackData) {
    if (!rawText || !rawText.trim()) return;

    const parsed = LYRICS.parseCustomLyrics(rawText);
    if (!parsed || !parsed.lines || parsed.lines.length === 0) {
      alert('Could not detect any lyrics lines. Please check your text.');
      return;
    }

    const token = ++this.lyricsLoadToken;

    // 1. Render immediately with instant Kana preview
    this.setLyrics({
      isSynced: parsed.isSynced,
      source: { provider: 'Manual paste' },
      lines: parsed.lines.map(l => ({
        ...l,
        romaji: ROMAJI.containsJapanese(l.text) ? ROMAJI.kanaToRomaji(l.text) : null,
        isJapanese: ROMAJI.containsJapanese(l.text)
      }))
    }, true);

    // 2. Convert Japanese lyrics to Romaji (Kuroshiro worker)
    const hasJapanese = parsed.lines.some(l => ROMAJI.containsJapanese(l.text));
    if (hasJapanese) {
      this.updateStatus('Converting lyrics to Romaji...');
      const processedLines = await ROMAJI.convertLyrics(parsed.lines, (msg) => {
        if (token === this.lyricsLoadToken) this.updateStatus(msg);
      });
      if (token !== this.lyricsLoadToken) return; // track changed meanwhile
      this.mergeLines(processedLines);
    }

    // 3. Save to Neon Cloud Database (fire-and-forget, never blocks UI)
    const t = trackData || this.currentTrackData;
    if (!this.isDemoMode && t && t.id && typeof NEON !== 'undefined') {
      NEON.saveLyrics(t.id, t.title || 'Custom Track', t.primaryArtist || t.artist || 'Unknown', this.currentLyrics)
        .catch(e => console.warn('Neon save error (non-fatal):', e));
    }

    this.updateStatus('Lyrics converted to Romaji & saved! ✨');
    if (this.showTranslation) this.ensureTranslation();
  },

  flushLocalStorageLyrics() {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('custom_lyrics_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      if (keysToRemove.length > 0) {
        console.log(`🧹 Flushed ${keysToRemove.length} cached lyrics from localStorage`);
      }
    } catch (e) {}
  },

  renderIdleState(message) {
    this.isPlaying = false;
    this.updatePlayButton();
    if (this.progressInterval) clearInterval(this.progressInterval);
    // Forget the current track so lyrics reload when playback resumes
    this.currentTrackId = null;
    this.lyricsLoadToken++;

    document.getElementById('track-title').textContent = 'Not Playing';
    document.getElementById('track-artist').textContent = 'Play a song on Spotify to see lyrics';
    document.getElementById('album-art').src = PLACEHOLDER_ART;

    const container = document.getElementById('lyrics-container');
    if (container) {
      container.innerHTML = `
        <div class="lyrics-message">
          <p>🎵 ${this.escapeHtml(message)}</p>
        </div>
      `;
    }
  },

  setAutoscroll(enabled) {
    this.autoScroll = enabled;
    const scrollToggle = document.getElementById('autoscroll-toggle');
    if (scrollToggle) scrollToggle.checked = enabled;
  },

  renderLyrics() {
    const container = document.getElementById('lyrics-container');
    if (!container || !this.currentLyrics) return;

    const { lines, isSynced } = this.currentLyrics;

    container.innerHTML = '';

    // Update sync badge in controls bar
    const badge = document.getElementById('sync-badge');
    if (badge) {
      if (isSynced) {
        badge.textContent = '🟢 Karaoke Synced';
        badge.style.color = '#1ed760';
        badge.style.background = '#1a3322';
      } else {
        badge.textContent = '⚪ Plain Lyrics';
        badge.style.color = 'var(--text-secondary)';
        badge.style.background = '#282828';
      }
    }

    const list = document.createElement('div');
    list.className = `lyrics-list ${isSynced ? 'synced' : 'plain'}`;

    const source = this.currentLyrics.source;
    if (source && source.provider) {
      const label = document.createElement('div');
      label.className = 'lyrics-source';
      const detail = source.track ? ` · ${source.track}${source.artist ? ' — ' + source.artist : ''}` : '';
      label.textContent = `Lyrics: ${source.provider}${detail}`;
      const wrong = document.createElement('button');
      wrong.className = 'lyrics-source-fix';
      wrong.textContent = 'Wrong lyrics?';
      wrong.title = 'Paste the correct lyrics for this track';
      wrong.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('manual-paste-section')?.classList.remove('hidden');
        document.getElementById('manual-lyrics-input')?.focus();
      });
      label.appendChild(wrong);
      list.appendChild(label);
    }

    lines.forEach((line, index) => {
      const lineEl = document.createElement('div');
      lineEl.className = `lyric-line ${index === this.activeLineIndex ? 'active' : ''}`;
      lineEl.dataset.index = index;

      if (line.timeMs !== null && line.timeMs !== undefined) {
        lineEl.dataset.timeMs = line.timeMs;
      }

      // Click a synced line to jump the song there (on Spotify too, if logged in)
      lineEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.markUserInteracting(4000);

        this.activeLineIndex = index;
        document.querySelectorAll('.lyric-line').forEach(el => el.classList.remove('active'));
        lineEl.classList.add('active');

        if (isSynced && line.timeMs !== null && line.timeMs !== undefined) {
          // Undo the user's offset so the clicked line becomes the active one
          this.controlPlayback('seekTo', line.timeMs - (this.syncOffsetMs || 0));
        }
      });

      let contentHtml = '';

      if (this.displayMode === 'original') {
        contentHtml = `<div class="line-original">${this.escapeHtml(line.text)}</div>`;
      } else if (this.displayMode === 'romaji') {
        const textToShow = line.romaji || line.text;
        contentHtml = `<div class="line-romaji">${this.escapeHtml(textToShow)}</div>`;
      } else { // 'both'
        if (line.romaji && line.romaji.trim() !== line.text.trim()) {
          contentHtml = `
            <div class="line-romaji">${this.escapeHtml(line.romaji)}</div>
            <div class="line-original sub-text">${this.escapeHtml(line.text)}</div>
          `;
        } else {
          contentHtml = `<div class="line-original">${this.escapeHtml(line.text)}</div>`;
        }
      }

      if (this.showTranslation && line.translation) {
        contentHtml += `<div class="line-translation">${this.escapeHtml(line.translation)}</div>`;
      }

      lineEl.innerHTML = contentHtml;
      list.appendChild(lineEl);
    });

    container.appendChild(list);
  },

  // force=true re-applies highlight/scroll even if the active index didn't change
  syncActiveLyricLine(force = false) {
    if (!this.currentLyrics || !this.currentLyrics.lines || this.currentLyrics.lines.length === 0) return;

    // Auto highlight is only possible for timestamped lyrics
    if (!this.currentLyrics.isSynced) return;

    const lines = this.currentLyrics.lines;
    const progress = this.currentProgressMs + (this.syncOffsetMs || 0);

    let newActiveIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (progress >= lines[i].timeMs) {
        newActiveIndex = i;
      } else {
        break;
      }
    }

    if (newActiveIndex === this.activeLineIndex && !force) return;

    document.querySelectorAll('.lyric-line.active').forEach(el => el.classList.remove('active'));
    this.activeLineIndex = newActiveIndex;

    if (newActiveIndex < 0) return; // before the first line (e.g. after seeking back to intro)

    const newActive = document.querySelector(`.lyric-line[data-index="${newActiveIndex}"]`);
    if (newActive) {
      newActive.classList.add('active');
      if (this.autoScroll && !this.isUserInteracting) {
        this.scrollToActiveLine();
      }
    }
  },

  scrollToActiveLine() {
    if (this.isUserInteracting || !this.autoScroll) return; // Don't fight user gestures!

    const container = document.getElementById('lyrics-container');
    const activeEl = document.querySelector('.lyric-line.active');

    if (container && activeEl) {
      const containerHeight = container.clientHeight;
      const activeTop = activeEl.offsetTop;
      const activeHeight = activeEl.clientHeight;

      const targetScroll = activeTop - (containerHeight / 2) + (activeHeight / 2);
      this.isProgrammaticScroll = true;
      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
      });
      setTimeout(() => { this.isProgrammaticScroll = false; }, 350);
    }
  },

  startDemoMode() {
    this.isDemoMode = true;
    this.currentTrackId = null;
    this.stopPolling();
    this.showAuthenticatedState();

    // Setup Demo Track
    this.handlePlaybackState({ ...this.DEMO_TRACK });
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

// Initialize App when DOM is ready
document.addEventListener('DOMContentLoaded', () => APP.init());
