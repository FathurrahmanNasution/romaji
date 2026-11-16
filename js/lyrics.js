/**
 * Lyrics Fetcher (LRCLIB + QQ Music fallback) and LRC Parser
 *
 * Vocaloid / utaite songs are often stored on LRCLIB under a different artist
 * (the original producer, a Project Sekai unit, a romanized name...). So besides
 * title+artist queries we also search by title alone and pick the best candidate
 * by normalized title, duration and artist similarity.
 */

const LYRICS = {
  // ---------- matching helpers ----------

  // Strip "feat." credits, bracketed notes ("(Rumor)", "【MV】", "(feat. GUMI)") and " - Remaster" suffixes
  cleanTitle(title) {
    return (title || '')
      .normalize('NFKC')
      .replace(/\s*[\(\[\{【（][^\)\]\}】）]*[\)\]\}】）]/g, ' ')
      .replace(/\s+(?:feat\.|ft\.|feat\s|ft\s|with\s).*$/i, '')
      .replace(/\s+-\s+.*$/, '')
      .replace(/\s+/g, ' ')
      .trim() || (title || '').trim();
  },

  // Comparison key: NFKC, lowercase, no spaces/punctuation
  normKey(str) {
    return (str || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '');
  },

  // allowPrefix: also accept "ルーマー" vs "ルーマーrumor" style decorations. Only safe when the
  // artist matches too — otherwise "MIRROR" would match an unrelated "Mirror Mirror".
  titleMatches(candidateTitle, wantedTitle, allowPrefix = false) {
    const a = this.normKey(this.cleanTitle(candidateTitle));
    const b = this.normKey(this.cleanTitle(wantedTitle));
    if (!a || !b) return false;
    if (a === b) return true;
    return allowPrefix && Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a));
  },

  // Alternate versions we shouldn't substitute for the original (unless that's what's playing)
  VERSION_RE: /instrumental|\binst\b|off ?vocal|karaoke|カラオケ|remix|english ver|eng\.? ver|\blive\b|acoustic|nightcore|sped up|slowed/i,

  // Kana, not just kanji: Chinese lyrics share the Han range but never use hiragana/katakana.
  // Require a few kana so a stray credit line can't qualify a Chinese/Korean song.
  hasJapanese(text) {
    return ((text || '').match(/[\u3041-\u3096\u30a1-\u30fa]/g) || []).length >= 5;
  },

  artistMatches(candidateArtist, wantedArtists) {
    const cand = this.normKey(candidateArtist);
    if (!cand) return false;
    return wantedArtists.some(a => {
      const k = this.normKey(a);
      return k.length >= 2 && (cand.includes(k) || k.includes(cand));
    });
  },

  /**
   * Score a candidate. Returns null if it shouldn't be used at all.
   * Same artist: allow up to 20s duration difference (different masters/edits).
   * Different artist (cover / other release): require a close duration so we don't
   * grab an unrelated song that happens to share the title.
   */
  scoreCandidate(c, wanted) {
    if (!c || !(c.syncedLyrics || c.plainLyrics)) return null;
    if (c.instrumental) return null;
    const candTitle = c.trackName || c.name || '';
    if (this.VERSION_RE.test(candTitle) && !this.VERSION_RE.test(wanted.title)) return null;

    const artistOk = this.artistMatches(c.artistName, wanted.artists);
    if (!this.titleMatches(candTitle, wanted.title, artistOk)) return null;
    // A different artist with the same title is only plausible as a cover of a Japanese song
    if (!artistOk && !this.hasJapanese(c.syncedLyrics || c.plainLyrics)) return null;

    const hasDuration = wanted.durationSec > 0 && c.duration > 0;
    const diff = hasDuration ? Math.abs(c.duration - wanted.durationSec) : (artistOk ? 0 : 999);

    if (artistOk ? diff > 20 : diff > 6) return null;

    let score = 0;
    if (c.syncedLyrics) score += 100;
    if (artistOk) score += 40;
    score -= diff * 4;
    return { candidate: c, score, diff, artistOk };
  },

  async lrclibQuery(path) {
    try {
      const res = await fetch(`https://lrclib.net${path}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data ? [data] : []);
    } catch (e) {
      return [];
    }
  },

  // ---------- main entry ----------

  async fetchLyrics(trackName, artistName, durationMs) {
    const durationSec = Math.round((durationMs || 0) / 1000);
    const artists = (artistName || '').split(/\s*,\s*/).filter(Boolean);
    const primaryArtist = (artists[0] || '').split(/\bfeat\b|\bft\b|&/i)[0].trim();
    const cleanTrack = this.cleanTitle(trackName);
    const wanted = { title: trackName, artists, durationSec };

    const enc = encodeURIComponent;
    const queries = [
      `/api/get?track_name=${enc(trackName)}&artist_name=${enc(primaryArtist)}&duration=${durationSec}`,
      `/api/search?track_name=${enc(cleanTrack)}&artist_name=${enc(primaryArtist)}`,
      // Title only: finds originals for covers and songs filed under another artist name
      `/api/search?track_name=${enc(cleanTrack)}`,
      `/api/search?q=${enc(cleanTrack + ' ' + primaryArtist)}`
    ];

    const seen = new Set();
    let best = null;

    for (const path of queries) {
      const results = await this.lrclibQuery(path);
      for (const c of results) {
        if (c.id && seen.has(c.id)) continue;
        if (c.id) seen.add(c.id);
        const scored = this.scoreCandidate(c, wanted);
        if (scored && (!best || scored.score > best.score)) best = scored;
      }
      // Good enough: synced and timing within 3s — stop querying (be nice to LRCLIB)
      if (best && best.candidate.syncedLyrics && best.diff <= 3) break;
    }

    if (best) {
      const processed = this.processLyricData(best.candidate);
      if (processed.found) {
        processed.source = {
          provider: 'LRCLIB',
          track: best.candidate.trackName,
          artist: best.candidate.artistName
        };
        return processed;
      }
    }

    // Fallback: QQ Music via our serverless proxy (has many Vocaloid / VTuber / utaite songs)
    const qq = await this.fetchFromQQ(trackName, artistName, durationSec);
    if (qq) return qq;

    // Fallback: UtaiteDB / VocaDB community databases (official public API, CORS enabled).
    // Plain lyrics only, but they cover many utaite / VTuber / Vocaloid songs nobody else has.
    for (const site of this.VOCADB_SITES) {
      const vdb = await this.fetchFromVocaDB(site, wanted);
      if (vdb) return vdb;
    }

    return { found: false, message: 'Lyrics not found in LRCLIB, QQ Music, UtaiteDB or VocaDB' };
  },

  VOCADB_SITES: [
    { name: 'UtaiteDB', base: 'https://utaitedb.net' },
    { name: 'VocaDB', base: 'https://vocadb.net' }
  ],

  async fetchFromVocaDB(site, wanted) {
    try {
      const params = new URLSearchParams({
        query: this.cleanTitle(wanted.title),
        maxResults: '10',
        nameMatchMode: 'Auto',
        fields: 'Lyrics,Names,Artists',
        lang: 'Default'
      });
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${site.base}/api/songs?${params}`, {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal
      });
      clearTimeout(tid);
      if (!res.ok) return null;
      const data = await res.json();

      let best = null;
      for (const song of (data && data.items) || []) {
        const original = (song.lyrics || []).find(l => l.translationType === 'Original' && l.value);
        if (!original) continue;

        // Artist names in every form the DB knows (e.g. "ｲﾄｸﾞﾙﾏ" + "Itoguruma")
        const artistNames = [song.artistString || ''];
        for (const a of song.artists || []) {
          artistNames.push(a.name || '');
          if (a.artist && a.artist.additionalNames) artistNames.push(...a.artist.additionalNames.split(/\s*,\s*/));
        }
        const artistOk = artistNames.some(n => this.artistMatches(n, wanted.artists));

        // Spotify often uses the English/romanized title ("Lunatic Crazy" vs "ルナティッククレイジー")
        const titles = [song.name, song.defaultName, ...((song.names || []).map(n => n.value))].filter(Boolean);
        if (titles.some(t => this.VERSION_RE.test(t)) && !this.VERSION_RE.test(wanted.title)) continue;
        if (!titles.some(t => this.titleMatches(t, wanted.title, artistOk))) continue;

        const hasDuration = wanted.durationSec > 0 && song.lengthSeconds > 0;
        const diff = hasDuration ? Math.abs(song.lengthSeconds - wanted.durationSec) : (artistOk ? 0 : 999);
        if (artistOk ? diff > 20 : diff > 6) continue;
        if (!artistOk && !this.hasJapanese(original.value)) continue;

        const score = (artistOk ? 40 : 0) - diff * 4;
        if (!best || score > best.score) best = { song, original, score };
      }
      if (!best) return null;

      const processed = this.processLyricData({ plainLyrics: best.original.value });
      if (!processed.found) return null;
      processed.source = { provider: site.name, track: best.song.name, artist: best.song.artistString };
      return processed;
    } catch (e) {
      return null;
    }
  },

  async fetchFromQQ(trackName, artistName, durationSec) {
    try {
      const params = new URLSearchParams({ title: trackName, artist: artistName || '', duration: String(durationSec || 0) });
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(`/api/qqlyrics?${params}`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.found) return null;

      const processed = this.processLyricData(data);
      if (!processed.found) return null;
      processed.source = { provider: 'QQ Music', track: data.trackName, artist: data.artistName };
      return processed;
    } catch (e) {
      return null; // /api not available locally, or QQ unreachable
    }
  },

  processLyricData(data) {
    if (!data) return { found: false, message: 'Lyrics not found' };

    if (data.syncedLyrics) {
      const parsedLines = this.parseLRC(data.syncedLyrics);
      if (parsedLines.length > 0) {
        return {
          found: true,
          isSynced: true,
          lines: parsedLines,
          plainText: data.plainLyrics || ''
        };
      }
    }

    if (data.plainLyrics) {
      const lines = data.plainLyrics
        .split('\n')
        .map(text => text.trim())
        .filter(text => text.length > 0)
        .map(text => ({
          timeMs: null,
          text: text
        }));

      if (lines.length > 0) {
        return {
          found: true,
          isSynced: false,
          lines: lines,
          plainText: data.plainLyrics
        };
      }
    }

    return { found: false, message: 'No lyrics available' };
  },

  // Parse LRC text into array of { timeMs, text }
  parseLRC(lrcText) {
    if (!lrcText) return [];

    const lines = lrcText.split('\n');
    const result = [];
    // Matches [mm:ss.xx] or [mm:ss.xxx]
    const timestampRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    for (let rawLine of lines) {
      const match = timestampRegex.exec(rawLine);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        let msStr = match[3];
        if (msStr.length === 2) msStr += '0';
        const milliseconds = parseInt(msStr, 10);

        const totalTimeMs = (minutes * 60 + seconds) * 1000 + milliseconds;
        const text = rawLine.replace(timestampRegex, '').trim();

        if (text) {
          result.push({
            timeMs: totalTimeMs,
            text: text
          });
        }
      }
    }

    result.sort((a, b) => a.timeMs - b.timeMs);
    return result;
  },

  // Parse manually pasted lyrics (supports plain text or LRC format)
  parseCustomLyrics(text) {
    if (!text || !text.trim()) return null;

    const hasTimestamps = /\[\d{2}:\d{2}\.\d{2,3}\]/.test(text);
    if (hasTimestamps) {
      const parsedLines = this.parseLRC(text);
      return {
        found: true,
        isSynced: true,
        lines: parsedLines,
        plainText: text
      };
    } else {
      const lines = text
        .split('\n')
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .map(t => ({ timeMs: null, text: t }));

      return {
        found: true,
        isSynced: false,
        lines: lines,
        plainText: text
      };
    }
  }
};
