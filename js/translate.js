/**
 * Lyrics → English translator.
 * Uses Google Translate's public web endpoint directly from the browser (CORS enabled,
 * no API key). Lines are batched with "\n" separators so a whole song is 1–2 requests.
 */

const TRANSLATE = {
  ENDPOINT: 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t',
  MAX_CHUNK_CHARS: 3500,

  async translateBatch(texts, target, source) {
    const url = `${this.ENDPOINT}&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'q=' + encodeURIComponent(texts.join('\n')),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`Translate HTTP ${res.status}`);
      const data = await res.json();
      const joined = (data && data[0] ? data[0] : []).map(seg => (seg && seg[0]) || '').join('');
      return joined.split('\n').map(s => s.trim());
    } finally {
      clearTimeout(tid);
    }
  },

  /**
   * Translate an array of strings. Returns an array of the same length
   * (null where a line could not be translated).
   */
  async translateLines(texts, target = 'en', source = 'auto') {
    const results = new Array(texts.length).fill(null);

    // Group consecutive lines into chunks under the size limit
    const chunks = [];
    let current = [];
    let size = 0;
    texts.forEach((text, index) => {
      const len = text.length + 1;
      if (current.length && size + len > this.MAX_CHUNK_CHARS) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(index);
      size += len;
    });
    if (current.length) chunks.push(current);

    for (const chunk of chunks) {
      const chunkTexts = chunk.map(i => texts[i]);
      let translated = await this.translateBatch(chunkTexts, target, source);

      // If the translator merged/split lines, fall back to one request per line
      if (translated.length !== chunkTexts.length) {
        translated = await Promise.all(chunkTexts.map(t =>
          this.translateBatch([t], target, source).then(r => r.join(' ')).catch(() => null)
        ));
      }
      chunk.forEach((lineIndex, j) => { results[lineIndex] = translated[j] || null; });
    }
    return results;
  }
};
