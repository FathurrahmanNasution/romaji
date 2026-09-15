/**
 * LRCLIB Lyrics Fetcher and LRC Parser
 */

const LYRICS = {
  async fetchLyrics(trackName, artistName, durationMs) {
    const durationSec = Math.round((durationMs || 0) / 1000);
    
    // Clean track title (remove feat., remaster tags, live tags, etc.)
    const cleanTrack = trackName
      .replace(/\s*[\(\[\{]feat\..*?[\)\]\}]/gi, '')
      .replace(/\s*[\(\[\{]with.*?[\)\]\}]/gi, '')
      .replace(/\s*-.*?(remaster|live|mix|edit).*/gi, '')
      .trim();

    // Primary artist (first artist before comma, feat, etc.)
    const primaryArtist = (artistName || '')
      .split(/,|\bfeat\b|\bft\b|&/i)[0]
      .trim();

    const queryAttempts = [
      // 1. Exact track & full artist name
      `https://lrclib.net/api/get?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}&duration=${durationSec}`,
      // 2. Clean track & primary artist name
      `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTrack)}&artist_name=${encodeURIComponent(primaryArtist)}&duration=${durationSec}`,
      // 3. Search by clean track & primary artist
      `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTrack)}&artist_name=${encodeURIComponent(primaryArtist)}`,
      // 4. Free text query search
      `https://lrclib.net/api/search?q=${encodeURIComponent(cleanTrack + ' ' + primaryArtist)}`
    ];

    for (let i = 0; i < queryAttempts.length; i++) {
      try {
        const url = queryAttempts[i];
        const response = await fetch(url);

        if (!response.ok) continue;

        const data = await response.json();

        if (Array.isArray(data)) {
          if (data.length > 0) {
            // Find closest duration match within 15 seconds
            let bestMatch = null;
            let minDiff = 999;

            for (const item of data) {
              const diff = Math.abs((item.duration || 0) - durationSec);
              if (diff < minDiff) {
                minDiff = diff;
                bestMatch = item;
              }
            }

            if (bestMatch && minDiff <= 20) {
              const processed = this.processLyricData(bestMatch);
              if (processed.found) return processed;
            }
          }
        } else if (data && (data.syncedLyrics || data.plainLyrics)) {
          const processed = this.processLyricData(data);
          if (processed.found) return processed;
        }
      } catch (err) {
        console.warn(`Lyric query attempt ${i + 1} failed:`, err);
      }
    }

    return { found: false, message: 'Lyrics not found in LRCLIB database' };
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
