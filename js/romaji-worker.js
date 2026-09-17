importScripts(
  'https://cdn.jsdelivr.net/npm/kuroshiro@1.2.0/dist/kuroshiro.min.js',
  'https://cdn.jsdelivr.net/npm/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js'
);

let kuroshiro = null;
let isReady = false;
let initPromise = null;

async function init() {
  if (isReady) return true;
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    try {
      const KuroshiroClass = typeof Kuroshiro.default !== 'undefined' ? Kuroshiro.default : Kuroshiro;
      kuroshiro = new KuroshiroClass();
      const analyzer = new KuromojiAnalyzer({ 
        dictPath: "https://cdn.jsdelivr.net/gh/takuyaa/kuromoji.js@gh-pages/demo/kuromoji/dict/" 
      });
      await kuroshiro.init(analyzer);
      isReady = true;
      return true;
    } catch (e) {
      console.error("Worker Kuroshiro init failed:", e);
      return false;
    }
  })();
  
  return initPromise;
}

self.addEventListener('message', async (e) => {
  const { id, type, payload } = e.data;
  
  if (type === 'INIT') {
    const success = await init();
    self.postMessage({ id, type: 'INIT_RESULT', success });
    return;
  }
  
  if (type === 'CONVERT') {
    const success = await init();
    if (!success || !isReady) {
      self.postMessage({ id, type: 'CONVERT_RESULT', error: 'Init failed', result: null });
      return;
    }
    
    try {
      const lines = payload;
      const result = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/.test(line.text)) {
          try {
            const romaji = await kuroshiro.convert(line.text, { to: 'romaji', mode: 'spaced' });
            result.push({ ...line, romaji: romaji, isJapanese: true });
          } catch(err) {
            result.push({ ...line, romaji: null, isJapanese: true });
          }
        } else {
          result.push({ ...line, romaji: null, isJapanese: false });
        }
      }
      self.postMessage({ id, type: 'CONVERT_RESULT', result });
    } catch (err) {
      self.postMessage({ id, type: 'CONVERT_RESULT', error: err.message, result: null });
    }
  }
});
