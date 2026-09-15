/**
 * Kuroshiro + Kuromoji Japanese to Romaji Converter
 */

const ROMAJI = {
  kuroshiro: null,
  isInitializing: false,
  isReady: false,
  conversionCache: new Map(),

  async init() {
    if (this.isReady) return true;
    if (this.isInitializing) {
      // Wait for existing initialization to finish
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.isReady;
    }

    this.isInitializing = true;

    try {
      if (typeof Kuroshiro === 'undefined' || typeof KuromojiAnalyzer === 'undefined') {
        console.warn('Kuroshiro or Kuromoji CDN scripts not loaded');
        this.isInitializing = false;
        return false;
      }

      this.kuroshiro = new Kuroshiro.default ? new Kuroshiro.default() : new Kuroshiro();
      const analyzer = new KuromojiAnalyzer({
        dictPath: CONFIG.KUROMOJI_DICT_PATH
      });

      await this.kuroshiro.init(analyzer);
      this.isReady = true;
      this.isInitializing = false;
      console.log('Kuroshiro + Kuromoji initialized successfully');
      return true;
    } catch (err) {
      console.error('Kuroshiro initialization error:', err);
      this.isInitializing = false;
      return false;
    }
  },

  containsJapanese(text) {
    if (!text) return false;
    // Hiragana, Katakana, CJK Unified Ideographs (Kanji)
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
  },

  async convertText(text) {
    if (!text || !this.containsJapanese(text)) {
      return text;
    }

    if (this.conversionCache.has(text)) {
      return this.conversionCache.get(text);
    }

    if (!this.isReady) {
      await this.init();
    }

    if (!this.isReady || !this.kuroshiro) {
      return text;
    }

    try {
      const romaji = await this.kuroshiro.convert(text, {
        to: 'romaji',
        mode: 'spaced'
      });
      this.conversionCache.set(text, romaji);
      return romaji;
    } catch (err) {
      console.error('Romaji conversion error:', err);
      return text;
    }
  },

  async convertLyrics(lines, onProgressCallback) {
    if (!lines || lines.length === 0) return lines;

    const hasJapanese = lines.some(l => this.containsJapanese(l.text));
    if (!hasJapanese) {
      return lines.map(l => ({ ...l, romaji: null, isJapanese: false }));
    }

    if (!this.isReady) {
      if (onProgressCallback) onProgressCallback('Loading Japanese dictionary...');
      await this.init();
    }

    const converted = [];
    let completedCount = 0;

    for (const line of lines) {
      if (this.containsJapanese(line.text) && this.isReady) {
        const romajiText = await this.convertText(line.text);
        converted.push({
          ...line,
          romaji: romajiText,
          isJapanese: true
        });
      } else {
        converted.push({
          ...line,
          romaji: null,
          isJapanese: false
        });
      }

      completedCount++;
      if (onProgressCallback && completedCount % 5 === 0) {
        onProgressCallback(`Converting lyrics to Romaji (${completedCount}/${lines.length})...`);
      }
    }

    return converted;
  }
};
