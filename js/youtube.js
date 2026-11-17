/**
 * YouTube page adapter.
 * Embeds a video or playlist with the official YouTube IFrame Player API and
 * feeds its state into APP (the same lyrics view / romaji / translation / cache
 * as the Spotify page). Song title & artist are guessed from the video title
 * and channel name, and can be corrected by the user. Typing a song title
 * instead of a link searches YouTube via /api/ytsearch (YouTube Data API).
 */

const YOUTUBE = {
  player: null,
  videoId: null,
  listId: null,          // active playlist ID, if any
  pendingStartVideo: null, // video to jump to once a playlist has loaded
  apiPromise: null,
  meta: null,            // { videoId, title, artist }
  metaRetryTimer: null,
  skipTimer: null,

  // Bracketed tags that describe the upload, not the song
  TAG_RE: /\bmv\b|m\/v|\bpv\b|official|公式|music ?video|lyrics?\b|歌詞|\baudio\b|\bfull\b|\bhd\b|4k|歌ってみた|うたってみた|cover|カバー|弾いてみた|叩いてみた|踊ってみた|\blive\b|ライブ|\bshorts?\b|teaser|animated|アニメ|vocaloid|ボカロ|オリジナル|\boriginal\b|新曲|初音ミク|鏡音|巡音|\bgumi\b|\bkafu\b|可不|重音テト|feat|ft\.|\bver\b|version|remaster|\bop\b|\bed\b|主題歌|tie-?up|nightcore|sped up|slowed|romaji|english|\bsubs?\b|字幕/i,

  init() {
    document.getElementById('yt-load-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = (document.getElementById('yt-url-input')?.value || '').trim();
      if (!value) return;
      const target = this.parseInput(value);
      if (target) {
        this.hideSearchResults();
        this.load(target, true);
      } else {
        // Not a link: treat it as a song title and search YouTube
        this.search(value);
      }
    });

    document.getElementById('yt-meta-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.searchWithEditedMeta();
    });

    // Open from ?v=ID&list=ID (shareable link) or whatever was watched last
    const params = new URLSearchParams(window.location.search);
    let initial = this.parseInput(window.location.search ? `https://www.youtube.com/watch?${params}` : '');
    if (!initial) {
      try {
        const saved = JSON.parse(localStorage.getItem('yt_last') || 'null');
        if (saved && (saved.videoId || saved.listId)) initial = saved;
        else if (localStorage.getItem('yt_last_video')) initial = { videoId: localStorage.getItem('yt_last_video') };
      } catch (e) {}
    }
    if (initial) {
      const input = document.getElementById('yt-url-input');
      if (input) input.value = this.buildUrl(initial);
      this.load(initial, false);
    }
  },

  /**
   * Parse a YouTube link into { videoId, listId, index }. Returns null if it isn't one.
   * Supports watch, youtu.be, shorts, embed, live, music.youtube.com and playlist links.
   */
  parseInput(input) {
    const s = (input || '').trim();
    if (/^[\w-]{11}$/.test(s)) return { videoId: s };
    try {
      const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
      const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
      let videoId = null;
      if (host === 'youtu.be') {
        const id = u.pathname.slice(1, 12);
        if (/^[\w-]{11}$/.test(id)) videoId = id;
      } else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
        const v = u.searchParams.get('v');
        if (v && /^[\w-]{11}/.test(v)) videoId = v.slice(0, 11);
        const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
        if (!videoId && m) videoId = m[1];
      } else {
        return null;
      }
      const list = u.searchParams.get('list');
      const listId = list && /^[\w-]{10,}$/.test(list) ? list : null;
      const index = parseInt(u.searchParams.get('index'), 10);
      if (!videoId && !listId) return null;
      return { videoId, listId, index: Number.isFinite(index) && index > 0 ? index - 1 : undefined };
    } catch (e) {
      return null; // not a URL
    }
  },

  buildUrl({ videoId, listId }) {
    const p = new URLSearchParams();
    if (videoId) p.set('v', videoId);
    if (listId) p.set('list', listId);
    return listId && !videoId ? `https://www.youtube.com/playlist?${p}` : `https://www.youtube.com/watch?${p}`;
  },

  loadApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (this.apiPromise) return this.apiPromise;
    this.apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === 'function') prev();
        resolve();
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('Could not load the YouTube player'));
      document.head.appendChild(s);
    });
    return this.apiPromise;
  },

  // Remember the current video/playlist in the URL and localStorage
  saveLocation() {
    const loc = { videoId: this.videoId, listId: this.listId };
    try { localStorage.setItem('yt_last', JSON.stringify(loc)); } catch (e) {}
    const url = new URL(window.location.href);
    url.search = '';
    if (loc.videoId) url.searchParams.set('v', loc.videoId);
    if (loc.listId) url.searchParams.set('list', loc.listId);
    window.history.replaceState({}, document.title, url.toString());
  },

  async load({ videoId, listId, index }, autoplay) {
    this.videoId = videoId || null;
    this.listId = listId || null;
    this.pendingStartVideo = listId && videoId && index === undefined ? videoId : null;
    this.meta = null;
    clearTimeout(this.skipTimer);
    this.saveLocation();
    this.updatePlaylistUI();

    document.getElementById('yt-player-section')?.classList.remove('hidden');
    document.getElementById('yt-empty-hint')?.classList.add('hidden');

    try {
      await this.loadApi();
    } catch (err) {
      APP.showToast(err.message);
      return;
    }

    const playlistArgs = { list: listId, listType: 'playlist', index: index || 0 };

    if (!this.player) {
      const playerVars = { playsinline: 1, rel: 0, autoplay: autoplay ? 1 : 0 };
      if (listId) Object.assign(playerVars, { list: listId, listType: 'playlist', index: index || 0 });
      this.player = new YT.Player('yt-player', {
        videoId: listId ? undefined : videoId,
        playerVars,
        events: {
          onReady: () => this.refreshMeta(),
          onStateChange: (e) => this.onStateChange(e),
          onError: (e) => this.onError(e)
        }
      });
    } else if (listId) {
      if (autoplay) this.player.loadPlaylist(playlistArgs); else this.player.cuePlaylist(playlistArgs);
    } else if (autoplay) {
      this.player.loadVideoById(videoId);
    } else {
      this.player.cueVideoById(videoId);
    }
  },

  inPlaylist() {
    const list = this.player && this.player.getPlaylist ? this.player.getPlaylist() : null;
    return !!(this.listId && list && list.length);
  },

  onError(e) {
    const messages = {
      2: 'Invalid YouTube video ID.',
      5: 'This video can\'t be played in the embedded player.',
      100: 'Video not found (removed or private).',
      101: 'The owner doesn\'t allow this video to be embedded. Try another upload (e.g. the "Topic" or official channel).',
      150: 'The owner doesn\'t allow this video to be embedded. Try another upload (e.g. the "Topic" or official channel).'
    };
    const msg = messages[e.data] || `YouTube player error ${e.data}`;
    clearTimeout(this.metaRetryTimer);
    APP.lyricsLoadToken++; // drop any lyrics lookup for the failed video
    document.getElementById('track-title').textContent = 'Video unavailable';
    document.getElementById('track-artist').textContent = '';
    const container = document.getElementById('lyrics-container');
    if (container) {
      container.innerHTML = '<div class="lyrics-message"><p></p></div>';
      container.querySelector('p').textContent = `⚠️ ${msg}`;
    }

    // In a playlist, skip blocked/removed videos automatically
    if (this.inPlaylist()) {
      APP.showToast(`${msg} Skipping to the next video...`, { durationMs: 4000 });
      clearTimeout(this.skipTimer);
      this.skipTimer = setTimeout(() => this.player.nextVideo(), 2500);
    } else {
      APP.showToast(msg, { durationMs: 8000 });
    }
  },

  onStateChange() {
    // Playlist opened from a "watch?v=X&list=Y" link: jump to video X once the list is known
    if (this.pendingStartVideo && this.inPlaylist()) {
      const target = this.pendingStartVideo;
      this.pendingStartVideo = null;
      const i = this.player.getPlaylist().indexOf(target);
      if (i > 0 && i !== this.player.getPlaylistIndex()) {
        this.player.playVideoAt(i);
        return;
      }
    }
    this.refreshMeta();
    this.pushState();
    this.updatePlaylistUI();
  },

  // Read title/channel/duration once the video's metadata is available, then load lyrics
  refreshMeta() {
    if (!this.player || !this.player.getVideoData) return;
    const vd = this.player.getVideoData() || {};
    const duration = this.player.getDuration ? this.player.getDuration() : 0;

    if (!vd.video_id || !vd.title || !duration) {
      // Metadata not ready yet (common right after cueing) — try again shortly
      clearTimeout(this.metaRetryTimer);
      this.metaRetryTimer = setTimeout(() => this.refreshMeta(), 500);
      return;
    }
    if (this.meta && this.meta.videoId === vd.video_id) return;

    this.videoId = vd.video_id;
    this.saveLocation();
    const parsed = this.parseTitle(vd.title, vd.author || '');
    this.meta = { videoId: vd.video_id, rawTitle: vd.title, channel: vd.author || '', ...parsed };

    const titleInput = document.getElementById('yt-title-input');
    const artistInput = document.getElementById('yt-artist-input');
    if (titleInput) titleInput.value = parsed.title;
    if (artistInput) artistInput.value = parsed.artist;
    const raw = document.getElementById('yt-raw-title');
    if (raw) raw.textContent = `${vd.title} · ${vd.author || ''}`;

    this.pushState();
    this.updatePlaylistUI();
  },

  buildTrackData() {
    const p = this.player;
    const state = p && p.getPlayerState ? p.getPlayerState() : -1;
    const artist = this.meta ? this.meta.artist : '';
    return {
      id: `yt:${this.videoId}`,
      title: this.meta ? this.meta.title : 'Loading...',
      artist,
      primaryArtist: artist.split(/\s*,\s*/)[0] || artist,
      albumArt: '',
      durationMs: Math.round((p && p.getDuration ? p.getDuration() : 0) * 1000),
      progressMs: this.getCurrentTimeMs(),
      // Treat buffering as playing so the lyrics clock doesn't stutter
      isPlaying: state === 1 || state === 3
    };
  },

  // Hand the current player state to APP (updates UI, timer, and loads lyrics on a new video)
  pushState() {
    if (!this.meta || !this.player) return;
    // While a playlist switches videos, wait until the new video's metadata is read
    const vd = this.player.getVideoData ? this.player.getVideoData() : null;
    if (vd && vd.video_id && vd.video_id !== this.meta.videoId) return;
    APP.handlePlaybackState(this.buildTrackData());
  },

  updatePlaylistUI() {
    const active = this.inPlaylist();
    document.getElementById('ctrl-prev')?.classList.toggle('hidden', !active);
    document.getElementById('ctrl-next')?.classList.toggle('hidden', !active);
    const info = document.getElementById('yt-playlist-info');
    if (info) {
      if (active) {
        const list = this.player.getPlaylist();
        info.textContent = `Playlist · ${this.player.getPlaylistIndex() + 1} / ${list.length}`;
        info.classList.remove('hidden');
      } else {
        info.classList.add('hidden');
      }
    }
  },

  getCurrentTimeMs() {
    return this.player && this.player.getCurrentTime ? Math.round(this.player.getCurrentTime() * 1000) : 0;
  },

  control(action, seekTarget) {
    const p = this.player;
    if (!p || !p.getPlayerState) return;
    if (action === 'toggle') {
      const state = p.getPlayerState();
      if (state === 1 || state === 3) p.pauseVideo(); else p.playVideo();
      return; // onStateChange will update the UI
    }
    if (action === 'next' || action === 'previous') {
      if (!this.inPlaylist()) return;
      clearTimeout(this.skipTimer);
      if (action === 'next') p.nextVideo(); else p.previousVideo();
      return;
    }
    if (seekTarget !== null && seekTarget !== undefined) {
      p.seekTo(seekTarget / 1000, true);
      APP.currentProgressMs = seekTarget;
      APP.applyLocalPlaybackChange();
    }
  },

  // ---------- search by title (YouTube Data API via /api/ytsearch) ----------

  async search(query) {
    const box = document.getElementById('yt-search-results');
    if (!box) return;
    box.classList.remove('hidden');
    box.innerHTML = '<p class="yt-search-status">Searching YouTube...</p>';

    let data = null;
    try {
      const res = await fetch(`/api/ytsearch?q=${encodeURIComponent(query)}`);
      data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data && data.error === 'not_configured'
          ? 'Title search isn\'t set up yet (YOUTUBE_API_KEY missing on the server). You can still paste a link.'
          : (data && data.error) || `Search failed (HTTP ${res.status}).`;
        box.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'yt-search-status';
        p.textContent = msg;
        box.appendChild(p);
        return;
      }
    } catch (e) {
      box.innerHTML = '<p class="yt-search-status">Search is unavailable here. Paste a YouTube link instead.</p>';
      return;
    }

    const items = (data && data.items) || [];
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = '<p class="yt-search-status">No videos found.</p>';
      return;
    }
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'yt-result';
      const img = document.createElement('img');
      img.src = item.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      const text = document.createElement('span');
      text.className = 'yt-result-text';
      const t = document.createElement('span');
      t.className = 'yt-result-title';
      t.textContent = item.title;
      const c = document.createElement('span');
      c.className = 'yt-result-channel';
      c.textContent = item.kind === 'playlist' ? `Playlist · ${item.channel}` : item.channel;
      text.append(t, c);
      btn.append(img, text);
      btn.addEventListener('click', () => {
        this.hideSearchResults();
        const target = item.kind === 'playlist' ? { listId: item.id } : { videoId: item.id };
        const input = document.getElementById('yt-url-input');
        if (input) input.value = this.buildUrl(target);
        this.load(target, true);
      });
      box.appendChild(btn);
    }
  },

  hideSearchResults() {
    const box = document.getElementById('yt-search-results');
    if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
  },

  searchWithEditedMeta() {
    if (!this.meta) return;
    const title = (document.getElementById('yt-title-input')?.value || '').trim();
    const artist = (document.getElementById('yt-artist-input')?.value || '').trim();
    if (!title) return;
    this.meta.title = title;
    this.meta.artist = artist;
    const data = this.buildTrackData();
    APP.handlePlaybackState(data);
    // Same video, corrected song info: skip the cache and search again (result overwrites the cache)
    APP.loadLyricsForTrack(data, { skipCache: true });
  },

  // ---------- title parsing ----------

  cleanChannel(author) {
    return (author || '')
      .replace(/\s*-\s*topic$/i, '')
      .replace(/\b(official|公式)\b(\s*(youtube|yt))?(\s*channel)?/gi, '')
      .replace(/ちゃんねる|チャンネル|\bchannel\b|\bch\.?$/gi, '')
      .replace(/vevo$/i, '')
      .replace(/[\s\-_|・/]+$/g, '')
      .replace(/^[\s\-_|・/]+/g, '')
      .trim();
  },

  /**
   * Guess { title, artist } from a YouTube video title.
   * Handles common layouts: "Artist - Title", "Title / Artist", "Artist「Title」",
   * "【歌ってみた】Title / Singer", "Title【Producer】" and "Artist - Topic" channels.
   */
  parseTitle(rawTitle, author) {
    const channel = this.cleanChannel(author);
    let t = (rawTitle || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const leftovers = [];

    // Drop bracketed tags about the upload; remember other bracketed text (often the artist)
    t = t.replace(/[【\[\(（〔]([^】\]\)）〕]*)[】\]\)）〕]/g, (m, inner) => {
      if (this.TAG_RE.test(inner)) return ' ';
      if (/^[【\[]/.test(m)) { leftovers.push(inner.trim()); return ' '; }
      return m; // keep "(Rumor)"-style subtitles in parentheses; LYRICS.cleanTitle handles them
    });
    t = t.replace(/\s*[|｜].*$/, '')        // "Title | Anime OP" → "Title"
      .replace(/\s+(?:feat\.|ft\.|feat\s).*$/i, '')
      .replace(/\s+/g, ' ').trim();

    let title = t;
    let artist = '';

    const quote = t.match(/^(.*?)\s*[「『](.+?)[」』]\s*(.*)$/);
    const dash = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    const slash = t.match(/^(.+?)\s*\/\s*(.+)$/);

    const sameAsChannel = (s) => channel && LYRICS.normKey(s) && (
      LYRICS.normKey(s).includes(LYRICS.normKey(channel)) || LYRICS.normKey(channel).includes(LYRICS.normKey(s))
    );

    if (quote) {
      title = quote[2];
      artist = quote[1] || quote[3] || '';
    } else if (dash) {
      // YouTube convention is "Artist - Title"; swap if the right side is the channel
      [artist, title] = sameAsChannel(dash[2]) && !sameAsChannel(dash[1]) ? [dash[2], dash[1]] : [dash[1], dash[2]];
    } else if (slash) {
      // Japanese convention is "Title / Artist"; swap if the left side is the channel
      [title, artist] = sameAsChannel(slash[1]) && !sameAsChannel(slash[2]) ? [slash[2], slash[1]] : [slash[1], slash[2]];
    }

    if (!artist && leftovers.length) artist = leftovers[0];
    if (!artist) artist = channel;

    title = title.replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '').trim() || t;
    artist = artist.replace(/\s+(?:feat\.|ft\.|feat\s).*$/i, '').replace(/\s+(?:x|×)\s.*$/i, '').replace(/\s+(?:mv|pv|m\/v|official.*|music video)$/i, '').replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '').trim();

    // Also try the channel name as an artist (covers, "Topic" channels, producers)
    const artists = [artist];
    if (channel && !sameAsChannel(artist)) artists.push(channel);
    return { title, artist: artists.filter(Boolean).join(', ') };
  }
};
