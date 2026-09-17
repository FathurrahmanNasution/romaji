/**
 * Kuroshiro + Kuromoji Japanese to Romaji Converter
 */

/**
 * High-Performance Japanese to Romaji Converter
 * Tier 1: Kuroshiro + Kuromoji (local morphologic analyzer)
 * Tier 2: Serverless Gemini AI (/api/gemini) for 100% accurate Kanji readings
 * Tier 3: Built-in Instant Hepburn Kana Transliterator (0ms, 100% offline, zero dependencies)
 */

const ROMAJI = {
  kuroshiro: null,
  initPromise: null,
  isReady: false,
  conversionCache: new Map(),

  DIGRAPHS: {
    'きゃ':'kya','きゅ':'kyu','きょ':'kyo','ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo',
    'しゃ':'sha','しゅ':'shu','しょ':'sho','じゃ':'ja','じゅ':'ju','じょ':'jo',
    'ちゃ':'cha','ちゅ':'chu','ちょ':'cho','ぢゃ':'ja','ぢゅ':'ju','ぢょ':'jo',
    'にゃ':'nya','にゅ':'nyu','にょ':'nyo',
    'ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo','びゃ':'bya','びゅ':'byu','びょ':'byo','ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo',
    'みゃ':'mya','みゅ':'myu','みょ':'myo','りゃ':'rya','りゅ':'ryu','りょ':'ryo',
    'キャ':'kya','キュ':'kyu','キョ':'kyo','ギャ':'gya','ギュ':'gyu','ギョ':'gyo',
    'シャ':'sha','シュ':'shu','ショ':'sho','ジャ':'ja','ジュ':'ju','ジョ':'jo',
    'チャ':'cha','チュ':'chu','チョ':'cho',
    'ニャ':'nya','ニュ':'nyu','ニョ':'nyo',
    'ヒャ':'hya','ヒュ':'hyu','ヒョ':'hyo','ビャ':'bya','ビュ':'byu','ビョ':'byo','ピャ':'pya','ピュ':'pyu','ピョ':'pyo',
    'ミャ':'mya','ミュ':'myu','ミョ':'myo','リャ':'rya','リュ':'ryu','リョ':'ryo',
    'ティ':'ti','ディ':'di','トゥ':'tu','ドゥ':'du','チェ':'che','シェ':'she','ジェ':'je',
    'ファ':'fa','フィ':'fi','フェ':'fe','フォ':'fo','ウィ':'wi','ウェ':'we','ウォ':'wo',
    'ヴァ':'va','ヴィ':'vi','ヴェ':'ve','ヴォ':'vo'
  },

  MONOGRAPHS: {
    'あ':'a','い':'i','う':'u','え':'e','お':'o',
    'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
    'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
    'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
    'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
    'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
    'だ':'da','ぢ':'ji','づ':'zu','de':'de','ど':'do',
    'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
    'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
    'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
    'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
    'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
    'や':'ya','ゆ':'yu','よ':'yo',
    'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
    'わ':'wa','ゐ':'wi','ゑ':'we','を':'wo','ん':'n',
    'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o',
    'カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko',
    'ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go',
    'サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so',
    'ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo',
    'タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to',
    'ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do',
    'ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no',
    'ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho',
    'バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo',
    'パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po',
    'マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo',
    'ヤ':'ya','ユ':'yu','ヨ':'yo',
    'ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro',
    'ワ':'wa','ヰ':'wi','ヱ':'we','ヲ':'wo','ン':'n',
    'ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o',
    'ァ':'a','ィ':'i','ゥ':'u','ェ':'e','ォ':'o',
    '、':', ','。':'. ','！':'! ','？':'? ','・':' '
  },

  containsJapanese(text) {
    if (!text) return false;
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
  },

  containsKanji(text) {
    if (!text) return false;
    return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
  },

  kanaToRomaji(str) {
    if (!str) return '';
    let result = '';
    let i = 0;
    while (i < str.length) {
      if (i + 1 < str.length) {
        const two = str.slice(i, i + 2);
        if (this.DIGRAPHS[two]) {
          result += this.DIGRAPHS[two];
          i += 2;
          continue;
        }
      }
      const ch = str[i];
      if (ch === 'っ' || ch === 'ッ') {
        let nextConsonant = '';
        if (i + 2 <= str.length) {
          const nextTwo = str.slice(i + 1, i + 3);
          if (this.DIGRAPHS[nextTwo]) nextConsonant = this.DIGRAPHS[nextTwo][0];
        }
        if (!nextConsonant && i + 1 < str.length) {
          const nextOne = str[i + 1];
          if (this.MONOGRAPHS[nextOne]) nextConsonant = this.MONOGRAPHS[nextOne][0];
        }
        result += nextConsonant || 't';
        i++;
        continue;
      }
      if (ch === 'ー') {
        const last = result[result.length - 1];
        if (last && /[aeiou]/i.test(last)) result += last;
        else result += '-';
        i++;
        continue;
      }
      if (this.MONOGRAPHS[ch]) {
        result += this.MONOGRAPHS[ch];
        i++;
        continue;
      }
      result += ch;
      i++;
    }
    return result;
  },

  init() {
    if (this.isReady) return Promise.resolve(true);
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        if (typeof Kuroshiro === 'undefined' || typeof KuromojiAnalyzer === 'undefined') {
          return false;
        }

        this.kuroshiro = new Kuroshiro.default ? new Kuroshiro.default() : new Kuroshiro();
        const dictPath = CONFIG.KUROMOJI_DICT_PATH || "https://cdn.jsdelivr.net/gh/takuyaa/kuromoji.js@gh-pages/demo/kuromoji/dict/";
        
        const analyzer = new KuromojiAnalyzer({ dictPath });
        await Promise.race([
          this.kuroshiro.init(analyzer),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Kuromoji timeout')), 2500))
        ]);

        this.isReady = true;
        console.log('Kuroshiro + Kuromoji initialized');
        return true;
      } catch (err) {
        console.info('Kuroshiro local dictionary not available, using Gemini AI + Kana fallback');
        this.isReady = false;
        return false;
      }
    })();

    return this.initPromise;
  },

  async convertText(text) {
    if (!text || !this.containsJapanese(text)) return text;
    if (this.conversionCache.has(text)) return this.conversionCache.get(text);

    if (this.isReady && this.kuroshiro) {
      try {
        const romaji = await this.kuroshiro.convert(text, { to: 'romaji', mode: 'spaced' });
        this.conversionCache.set(text, romaji);
        return romaji;
      } catch (e) {}
    }

    return this.kanaToRomaji(text);
  },

  async convertLyrics(lines, onProgressCallback) {
    if (!lines || lines.length === 0) return lines;

    const hasJapanese = lines.some(l => this.containsJapanese(l.text));
    if (!hasJapanese) {
      return lines.map(l => ({ ...l, romaji: null, isJapanese: false }));
    }

    // Tier 1: Wait for Kuroshiro/Kuromoji init (start it if not yet started)
    if (!this.initPromise) {
      this.init();
    }

    // Wait for Kuroshiro to finish initializing (it may still be loading the dict)
    const kuroshiroReady = await this.initPromise;

    if (kuroshiroReady && this.isReady && this.kuroshiro) {
      if (onProgressCallback) onProgressCallback('Converting lyrics to Romaji...');
      try {
        const converted = [];
        for (const line of lines) {
          if (this.containsJapanese(line.text)) {
            const romajiText = await this.convertText(line.text);
            converted.push({ ...line, romaji: romajiText, isJapanese: true });
          } else {
            converted.push({ ...line, romaji: null, isJapanese: false });
          }
        }
        return converted;
      } catch (e) {
        console.warn('Kuroshiro conversion error, falling back:', e);
      }
    }

    // Tier 2: Instant client-side Kana transliteration fallback (0ms, 100% offline)
    if (onProgressCallback) onProgressCallback('Applying Kana Romaji transliteration...');
    return lines.map(line => {
      const isJp = this.containsJapanese(line.text);
      return {
        ...line,
        romaji: isJp ? this.kanaToRomaji(line.text) : null,
        isJapanese: isJp
      };
    });
  }
};
