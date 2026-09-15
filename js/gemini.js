/**
 * Gemini AI Lyrics Finder & Romaji Generator (with Vercel API support)
 */

const GEMINI = {
  getCachedLyrics(title, artist) {
    try {
      const key = `gemini_lyrics_${encodeURIComponent(title)}_${encodeURIComponent(artist)}`;
      const cached = localStorage.getItem(key);
      return cached ? JSON.parse(cached) : null;
    } catch (e) {
      return null;
    }
  },

  setCachedLyrics(title, artist, data) {
    try {
      const key = `gemini_lyrics_${encodeURIComponent(title)}_${encodeURIComponent(artist)}`;
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to cache lyrics:', e);
    }
  },

  async fetchLyrics(trackTitle, artistName, apiKey) {
    // 1. Check local cache first (saves quota!)
    const cached = this.getCachedLyrics(trackTitle, artistName);
    if (cached && cached.lines && cached.lines.length > 0) {
      return cached;
    }

    // 2. Try secure Vercel Serverless Function (/api/gemini)
    try {
      const apiRes = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackTitle, artistName })
      });

      if (apiRes.ok) {
        const data = await apiRes.json();
        if (data.found && Array.isArray(data.lines) && data.lines.length > 0) {
          const formattedLines = data.lines.map(item => {
            const text = item.original || item.text || '';
            const romaji = item.romaji || null;
            const containsJp = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);

            return {
              timeMs: null,
              text: text,
              romaji: romaji,
              isJapanese: containsJp || !!romaji
            };
          });

          const finalResult = {
            found: true,
            isSynced: false,
            lines: formattedLines,
            source: `Gemini AI (${data.model || 'Serverless'})`
          };

          this.setCachedLyrics(trackTitle, artistName, finalResult);
          return finalResult;
        }

        if (data.found === false) {
          return { found: false, message: data.message || 'Lyrics not found by Gemini AI' };
        }
      }
    } catch (apiErr) {
      // /api/gemini not available, proceed to direct client fallback
    }

    // 3. Direct Client Fallback (if user entered key in localStorage or config)
    const key = apiKey || CONFIG.GEMINI_API_KEY || localStorage.getItem('gemini_api_key');
    if (!key || key.includes('PASTE_GEMINI_API_KEY')) {
      return { found: false, message: 'Gemini API not configured' };
    }

    const models = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.8-flash'
    ];
    
    const promptText = `Provide the full lyrics for the song titled "${trackTitle}" by "${artistName}".
If the song is in Japanese, translate each line into Romaji transliteration line-by-line.
Return ONLY valid JSON matching this exact structure:
{
  "found": true,
  "lines": [
    { "original": "Japanese line 1", "romaji": "Romaji line 1" },
    { "original": "Japanese line 2", "romaji": "Romaji line 2" }
  ]
}
If you know the song, always return "found": true with the lines array.`;

    let lastError = null;

    for (const model of models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
            })
          });

          if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            lastError = errJson.error?.message || `HTTP ${response.status}`;

            if ((response.status === 503 || response.status === 429) && attempt < 2) {
              await new Promise(res => setTimeout(res, 1200));
              continue;
            }
            break;
          }

          const result = await response.json();
          const parts = result.candidates?.[0]?.content?.parts || [];
          
          let candidate = '';
          for (const part of parts) {
            if (part.text && (part.text.includes('{') || part.text.includes('found') || part.text.includes('lines'))) {
              candidate = part.text;
              break;
            }
          }
          if (!candidate && parts.length > 0) {
            candidate = parts[parts.length - 1].text || '';
          }
          
          if (!candidate) break;

          let jsonStr = candidate.trim();
          jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

          let parsed;
          try {
            parsed = JSON.parse(jsonStr);
          } catch (jsonErr) {
            break;
          }

          if (parsed.found && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
            const formattedLines = parsed.lines.map(item => {
              const text = item.original || item.text || '';
              const romaji = item.romaji || null;
              const containsJp = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);

              return {
                timeMs: null,
                text: text,
                romaji: romaji,
                isJapanese: containsJp || !!romaji
              };
            });

            const finalResult = {
              found: true,
              isSynced: false,
              lines: formattedLines,
              source: `Gemini AI (${model})`
            };

            this.setCachedLyrics(trackTitle, artistName, finalResult);
            return finalResult;
          }

          if (parsed.found === false) {
            return { found: false, message: parsed.message || 'Lyrics not found by Gemini AI' };
          }

        } catch (err) {
          lastError = err.message;
          break;
        }
      }
    }

    return { found: false, message: lastError || 'Gemini AI search temporarily busy' };
  }
};
