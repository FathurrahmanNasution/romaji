/**
 * Main Application Orchestrator
 */

const APP = {
  currentTrackId: null,
  pollInterval: null,
  progressInterval: null,
  currentLyrics: null,
  activeLineIndex: -1,
  displayMode: 'both', // 'original', 'romaji', 'both'
  autoScroll: true,
  isDemoMode: false,
  currentProgressMs: 0,
  trackDurationMs: 0,
  isPlaying: false,

  // Demo Track Data when user has no Spotify Client ID set up yet
  DEMO_TRACK: {
    id: 'demo_yoasobi_idoru',
    title: 'アイドル (Idol)',
    artist: 'YOASOBI',
    primaryArtist: 'YOASOBI',
    albumArt: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80',
    durationMs: 213000,
    progressMs: 32000,
    isPlaying: true
  },

  DEMO_LRC: `[00:00.00] 無敵の笑顔で荒らすメディア
[00:03.50] 知りたいその秘密プラive-to (プライベート)
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
    this.setupEventListeners();

    // Check if configuration requires setup
    const isConfigured = CONFIG.CLIENT_ID && !CONFIG.CLIENT_ID.includes('PASTE_SPOTIFY_CLIENT_ID');
    
    // Check if returning from Spotify Auth
    const isCallback = window.location.search.includes('code=') || window.location.search.includes('error=');
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
      this.showLoggedOutState(!isConfigured);
    }
  },

  setupEventListeners() {
    // Auth Buttons
    document.getElementById('login-btn')?.addEventListener('click', () => AUTH.login());
    document.getElementById('logout-btn')?.addEventListener('click', () => AUTH.logout());
    document.getElementById('demo-btn')?.addEventListener('click', () => this.startDemoMode());

    // Config Modal / Banner
    document.getElementById('save-config-btn')?.addEventListener('click', () => {
      const clientIdInput = document.getElementById('config-client-id').value.trim();
      if (clientIdInput) {
        CONFIG.CLIENT_ID = clientIdInput;
        AUTH.login();
      }
    });

    // View Mode Controls
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.displayMode = e.currentTarget.dataset.mode;
        this.renderLyrics();
      });
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
  },

  updateStatus(msg) {
    const el = document.getElementById('app-status');
    if (el) el.textContent = msg;
  },

  showLoggedOutState(needsConfig = false) {
    document.getElementById('logged-in-view')?.classList.add('hidden');
    document.getElementById('logged-out-view')?.classList.remove('hidden');
    
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

    const token = await AUTH.getValidToken();
    if (!token) {
      this.showLoggedOutState();
      return;
    }

    const data = await SPOTIFY.fetchCurrentlyPlaying(token);
    
    if (!data || !data.isPlaying && data.reason === 'nothing_playing') {
      this.renderIdleState('Nothing playing on Spotify right now');
      return;
    }

    if (data.reason === 'unauthorized') {
      AUTH.logout();
      return;
    }

    this.handlePlaybackState(data);
  },

  handlePlaybackState(data) {
    this.isPlaying = data.isPlaying;
    
    // Compensate for Spotify API network latency (time elapsed between Spotify snapshot and client receive)
    const latency = data.timestamp ? Math.max(0, Date.now() - data.timestamp) : 0;
    this.currentProgressMs = data.progressMs + latency;
    this.trackDurationMs = data.durationMs;

    // Update Player UI Metadata
    document.getElementById('track-title').textContent = data.title;
    document.getElementById('track-artist').textContent = data.artist;
    document.getElementById('album-art').src = data.albumArt || 'https://via.placeholder.com/300?text=No+Cover';
    
    this.updateProgressUI();

    // Smooth local progress interpolation if playing
    this.startProgressTimer();

    // Check if track changed
    if (data.id !== this.currentTrackId) {
      this.currentTrackId = data.id;
      this.loadLyricsForTrack(data);
    }
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
    }, 200);
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

  formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  },

  async loadLyricsForTrack(trackData) {
    // 0. Check if user previously saved custom lyrics locally
    try {
      const savedCustom = localStorage.getItem(`custom_lyrics_${trackData.id}`) ||
                          localStorage.getItem(`custom_lyrics_${encodeURIComponent(trackData.title)}`);
      if (savedCustom) {
        const parsed = JSON.parse(savedCustom);
        if (parsed && parsed.lines && parsed.lines.length > 0) {
          this.currentLyrics = parsed;
          this.renderLyrics();
          this.syncActiveLyricLine();
          this.updateStatus('Loaded saved lyrics!');
          return;
        }
      }
    } catch (e) {}

    // 1. Check Neon Cloud Database (Cloud Sync across all your devices!)
    if (typeof NEON !== 'undefined') {
      try {
        const cloudLyrics = await NEON.getLyrics(trackData.id, trackData.title);
        if (cloudLyrics && cloudLyrics.lines && cloudLyrics.lines.length > 0) {
          this.currentLyrics = cloudLyrics;
          this.renderLyrics();
          this.syncActiveLyricLine();
          this.updateStatus('Loaded from Neon Cloud Database! ☁️');
          return;
        }
      } catch (err) {
        console.warn('Neon check error:', err);
      }
    }

    this.renderLyricsLoading(`Fetching lyrics for "${trackData.title}"...`);
    
    let lyricResult;
    if (this.isDemoMode) {
      lyricResult = LYRICS.processLyricData({ syncedLyrics: this.DEMO_LRC });
    } else {
      lyricResult = await LYRICS.fetchLyrics(
        trackData.primaryArtist || trackData.artist,
        trackData.title,
        trackData.durationMs
      );
    }

    if (!lyricResult.found || !lyricResult.lines || lyricResult.lines.length === 0) {
      console.log('LRCLIB lyrics not found, attempting Gemini AI search...');
      this.executeGeminiSearch(trackData);
      return;
    }

    // 1. Render original lyrics immediately so user sees lyrics right away
    this.currentLyrics = {
      isSynced: lyricResult.isSynced,
      lines: lyricResult.lines.map(l => ({
        ...l,
        romaji: null,
        isJapanese: ROMAJI.containsJapanese(l.text)
      }))
    };
    this.renderLyrics();
    this.syncActiveLyricLine();

    // 2. Convert Japanese lyrics to Romaji in the background if needed
    const hasJapanese = lyricResult.lines.some(l => ROMAJI.containsJapanese(l.text));
    if (hasJapanese) {
      this.updateStatus('Converting Japanese lyrics to Romaji...');
      
      const processedLines = await ROMAJI.convertLyrics(lyricResult.lines, (msg) => {
        this.updateStatus(msg);
      });

      this.currentLyrics = {
        isSynced: lyricResult.isSynced,
        lines: processedLines
      };

      this.renderLyrics();
      this.syncActiveLyricLine();
      this.updateStatus('Lyrics ready!');
    }
  },

  renderLyricsLoading(message) {
    const container = document.getElementById('lyrics-container');
    if (container) {
      container.innerHTML = `
        <div class="lyrics-message">
          <div class="spinner"></div>
          <p>${message}</p>
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
    const hasGeminiKey = CONFIG.GEMINI_API_KEY && !CONFIG.GEMINI_API_KEY.includes('PASTE_GEMINI_API_KEY');

    container.innerHTML = `
      <div class="lyrics-message" style="gap: 0.85rem; max-width: 540px; margin: 0 auto; text-align: center;">
        <div>
          <p class="error-text" style="font-weight: 700; font-size: 1.05rem; margin-bottom: 0.25rem;">ℹ️ Lyrics not in database</p>
          <p style="font-size: 0.85rem; color: var(--text-secondary);">This song is not in LRCLIB yet. You can find synced .lrc or paste Japanese lyrics below.</p>
        </div>
        
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center;">
          <a href="${lrcSearchUrl}" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration: none;">
            🎵 Find Synced (.LRC) on Google
          </a>
          <a href="${googleSearchUrl}" target="_blank" rel="noopener" class="btn btn-secondary" style="text-decoration: none;">
            🔍 Search Plain Lyrics
          </a>
          <button id="gemini-search-btn" class="btn btn-secondary">
            ✨ Gemini
          </button>
        </div>

        <!-- Quick Paste Lyrics Box -->
        <div id="paste-lyrics-box" style="width: 100%; text-align: left; background: #111; padding: 0.85rem; border-radius: 12px; border: 1px dashed var(--accent-green); margin-top: 0.25rem;">
          <label style="font-size: 0.8rem; color: var(--accent-green); display: block; margin-bottom: 0.4rem; font-weight: 600;">
            📝 Paste lyrics or .LRC format below (saves to Neon Cloud & converts to Romaji):
          </label>
          <textarea id="custom-lyrics-input" rows="5" placeholder="Tip: Paste .LRC format [00:12.34] for exact 100% karaoke sync, or plain Japanese text..." style="width: 100%; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.6rem; font-family: inherit; font-size: 0.85rem; resize: vertical; margin-bottom: 0.5rem;"></textarea>
          <button id="submit-custom-lyrics" class="btn btn-primary" style="width: 100%; justify-content: center;">Convert & Display Romaji</button>
        </div>
      </div>
    `;

    // Gemini Retry
    document.getElementById('gemini-search-btn')?.addEventListener('click', () => {
      this.executeGeminiSearch(trackData);
    });

    // Submit Custom Lyrics & Save permanently
    document.getElementById('submit-custom-lyrics')?.addEventListener('click', async () => {
      const rawText = document.getElementById('custom-lyrics-input')?.value;
      if (!rawText || !rawText.trim()) return;

      const parsed = LYRICS.parseCustomLyrics(rawText);
      if (parsed && parsed.lines.length > 0) {
        // 1. Render immediately so lyrics show up right away!
        this.currentLyrics = {
          isSynced: parsed.isSynced,
          lines: parsed.lines.map(l => ({
            ...l,
            romaji: null,
            isJapanese: ROMAJI.containsJapanese(l.text)
          }))
        };
        this.renderLyrics();
        this.syncActiveLyricLine();

        // 2. Convert to Romaji in the background
        const hasJapanese = parsed.lines.some(l => ROMAJI.containsJapanese(l.text));
        if (hasJapanese) {
          this.updateStatus('Converting to Romaji...');
          const processedLines = await ROMAJI.convertLyrics(parsed.lines, (msg) => {
            this.updateStatus(msg);
          });

          this.currentLyrics = {
            isSynced: parsed.isSynced,
            lines: processedLines
          };
          this.renderLyrics();
          this.syncActiveLyricLine();
        }

        // 3. Save permanently in localStorage & Neon Cloud Database
        if (trackData && trackData.id) {
          localStorage.setItem(`custom_lyrics_${trackData.id}`, JSON.stringify(this.currentLyrics));
          localStorage.setItem(`custom_lyrics_${encodeURIComponent(trackData.title)}`, JSON.stringify(this.currentLyrics));
          
          if (typeof NEON !== 'undefined') {
            NEON.saveLyrics(trackData.id, trackData.title, trackData.artist, this.currentLyrics);
          }
        }

        this.updateStatus('Lyrics saved & ready!');
      }
    });
  },

  async executeGeminiSearch(trackData, apiKey) {
    if (!trackData) return;
    this.renderLyricsLoading(`Searching lyrics & Romaji for "${trackData.title}" using Gemini AI...`);
    
    const result = await GEMINI.fetchLyrics(trackData.title, trackData.artist, apiKey);

    if (result.found && result.lines && result.lines.length > 0) {
      this.currentLyrics = {
        isSynced: false,
        lines: result.lines
      };
      
      // Save to Neon Cloud Database
      if (typeof NEON !== 'undefined' && trackData && trackData.id) {
        NEON.saveLyrics(trackData.id, trackData.title, trackData.artist, this.currentLyrics);
      }

      this.renderLyrics();
      this.updateStatus('Lyrics found via Gemini AI!');
    } else {
      this.renderLyricsError(result.message || 'Gemini AI could not find lyrics for this song.', trackData);
    }
  },

  renderIdleState(message) {
    document.getElementById('track-title').textContent = 'Not Playing';
    document.getElementById('track-artist').textContent = 'Play a song on Spotify to see lyrics';
    document.getElementById('album-art').src = 'https://via.placeholder.com/300/282828/FFFFFF?text=Idle';
    
    const container = document.getElementById('lyrics-container');
    if (container) {
      container.innerHTML = `
        <div class="lyrics-message">
          <p>🎵 ${message}</p>
        </div>
      `;
    }
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

    lines.forEach((line, index) => {
      const lineEl = document.createElement('div');
      lineEl.className = `lyric-line ${index === this.activeLineIndex ? 'active' : ''}`;
      lineEl.dataset.index = index;

      if (line.timeMs !== null) {
        lineEl.dataset.timeMs = line.timeMs;
      }

      // User click on line
      lineEl.addEventListener('click', () => {
        if (isSynced && line.timeMs !== null) {
          this.currentProgressMs = line.timeMs;
          this.updateProgressUI();
          this.syncActiveLyricLine();
        } else {
          this.activeLineIndex = index;
          document.querySelectorAll('.lyric-line').forEach(el => el.classList.remove('active'));
          lineEl.classList.add('active');
          if (this.autoScroll) this.scrollToActiveLine();
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

      lineEl.innerHTML = contentHtml;
      list.appendChild(lineEl);
    });

    container.appendChild(list);
  },

  syncActiveLyricLine() {
    if (!this.currentLyrics || !this.currentLyrics.lines || this.currentLyrics.lines.length === 0) return;

    const lines = this.currentLyrics.lines;
    const progress = this.currentProgressMs;
    const duration = this.trackDurationMs || 1;

    let newActiveIndex = -1;

    if (this.currentLyrics.isSynced) {
      // 1. Exact timestamp matching for LRC synced lyrics
      for (let i = 0; i < lines.length; i++) {
        if (progress >= lines[i].timeMs) {
          newActiveIndex = i;
        } else {
          break;
        }
      }
    } else {
      // 2. Smart Proportional Progress matching for saved & unsynced lyrics!
      // Estimates line progress between 4% intro and 96% outro of song duration
      const startMs = duration * 0.04;
      const endMs = duration * 0.96;
      
      if (progress < startMs) {
        newActiveIndex = 0;
      } else if (progress >= endMs) {
        newActiveIndex = lines.length - 1;
      } else {
        const effectiveRatio = (progress - startMs) / (endMs - startMs);
        newActiveIndex = Math.min(
          lines.length - 1,
          Math.max(0, Math.floor(effectiveRatio * lines.length))
        );
      }
    }

    if (newActiveIndex !== this.activeLineIndex && newActiveIndex >= 0) {
      const oldActive = document.querySelector(`.lyric-line[data-index="${this.activeLineIndex}"]`);
      if (oldActive) oldActive.classList.remove('active');

      this.activeLineIndex = newActiveIndex;

      const newActive = document.querySelector(`.lyric-line[data-index="${newActiveIndex}"]`);
      if (newActive) {
        newActive.classList.add('active');
        if (this.autoScroll) {
          this.scrollToActiveLine();
        }
      }
    }
  },

  scrollToActiveLine() {
    const container = document.getElementById('lyrics-container');
    const activeEl = document.querySelector('.lyric-line.active');

    if (container && activeEl) {
      const containerHeight = container.clientHeight;
      const activeTop = activeEl.offsetTop;
      const activeHeight = activeEl.clientHeight;

      const targetScroll = activeTop - (containerHeight / 2) + (activeHeight / 2);
      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
      });
    }
  },

  startDemoMode() {
    this.isDemoMode = true;
    this.currentTrackId = null;
    this.stopPolling();
    this.showAuthenticatedState();
    
    // Setup Demo Track
    this.handlePlaybackState(this.DEMO_TRACK);
  },

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

// Initialize App when DOM is ready
document.addEventListener('DOMContentLoaded', () => APP.init());
