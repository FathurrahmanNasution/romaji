/**
 * Vercel Serverless Function: /api/qqlyrics?title=&artist=&duration=
 * Fallback lyrics source for songs LRCLIB doesn't have (many Vocaloid, VTuber
 * and utaite releases). QQ Music's endpoints need a Referer header and don't
 * allow browser CORS, so they're proxied here.
 *
 * Response: { found, syncedLyrics?, plainLyrics?, trackName, artistName }
 */

const QQ_HEADERS = {
  'Referer': 'https://y.qq.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
};

// Credit / metadata lines QQ puts at the top of lyrics
const CREDIT_RE = /^(作词|作詞|作曲|编曲|編曲|词|詞|曲|制作人|監修|混音|母带|和声|吉他|贝斯|鼓|vocal|lyrics?|music|composer|compose|arrange(r|ment)?|mix(ed)?|master(ing)?|illust|movie|op|sp)\s*(by)?\s*[:：]/i;

function cleanTitle(title) {
  return (title || '')
    .normalize('NFKC')
    .replace(/\s*[\(\[\{【（][^\)\]\}】）]*[\)\]\}】）]/g, ' ')
    .replace(/\s+(?:feat\.|ft\.|feat\s|ft\s|with\s).*$/i, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim() || (title || '').trim();
}

function normKey(str) {
  return (str || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

// Prefix matching only when the artist matches too (avoids "MIRROR" ~ "Mirror Mirror")
function titleMatches(a, b, allowPrefix) {
  const x = normKey(cleanTitle(a));
  const y = normKey(cleanTitle(b));
  if (!x || !y) return false;
  if (x === y) return true;
  return allowPrefix && Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x));
}

const VERSION_RE = /instrumental|\binst\b|off ?vocal|karaoke|カラオケ|remix|english ver|eng\.? ver|\blive\b|acoustic|nightcore|sped up|slowed|伴奏/i;
const JP_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

function artistMatches(candidateArtists, wantedArtists) {
  const cands = candidateArtists.map(normKey).filter(Boolean);
  return wantedArtists.some(w => {
    const k = normKey(w);
    return k.length >= 2 && cands.some(c => c.includes(k) || k.includes(c));
  });
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&#(\d+);/g, (m, c) => String.fromCodePoint(Number(c)))
    .replace(/&#x([0-9a-f]+);/gi, (m, c) => String.fromCodePoint(parseInt(c, 16)))
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Remove [ti:]/[ar:] tags, credit lines and the "Title - Artist" header line
function cleanLyrics(raw, title) {
  const titleKey = normKey(cleanTitle(title));
  const out = [];
  for (const line of decodeEntities(raw).replace(/\r/g, '').split('\n')) {
    if (/^\[[a-z]+:.*\]$/i.test(line.trim())) continue; // metadata tags
    const m = line.match(/^((?:\[\d{2}:\d{2}[.:]\d{2,3}\])*)(.*)$/);
    const stamp = m[1].replace(/\[(\d{2}):(\d{2}):(\d{2,3})\]/g, '[$1:$2.$3]');
    const text = m[2].trim();
    if (CREDIT_RE.test(text)) continue;
    // Header like "オーバーライド - 吉田夜世" in the first lines
    if (out.length < 3 && text.includes(' - ') && titleKey && normKey(text).startsWith(titleKey)) continue;
    if (/^此歌曲为没有填词的纯音乐/.test(text) || /^纯音乐，请欣赏/.test(text)) return '';
    out.push(stamp + text);
  }
  return out.join('\n').trim();
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: QQ_HEADERS, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

async function searchSongs(keyword) {
  const url = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&p=1&n=10&w=' + encodeURIComponent(keyword);
  const res = await fetchWithTimeout(url, 6000);
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return (data && data.data && data.data.song && data.data.song.list) || [];
}

async function fetchLyric(songmid) {
  const url = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?format=json&nobase64=1&g_tk=5381&songmid=' + encodeURIComponent(songmid);
  const res = await fetchWithTimeout(url, 6000);
  if (!res.ok) return '';
  const text = await res.text();
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1); // strip JSONP wrapper if present
  try {
    return JSON.parse(json).lyric || '';
  } catch (e) {
    return '';
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const title = String(req.query.title || '').trim().slice(0, 300);
  const artist = String(req.query.artist || '').trim().slice(0, 300);
  const durationSec = parseInt(req.query.duration, 10) || 0;
  if (!title) return res.status(400).json({ error: 'Missing title' });

  const artists = artist.split(/\s*,\s*/).filter(Boolean);
  const coreTitle = cleanTitle(title);

  try {
    // Title + each of the first two artists, then title alone (covers / romanized artist
    // names). Candidates from all searches are pooled; stop early once a same-artist hit exists.
    const keywords = [...new Set([
      ...artists.slice(0, 2).map(a => `${coreTitle} ${a}`),
      coreTitle
    ])];
    const pool = new Map();
    for (const keyword of keywords) {
      const list = await searchSongs(keyword);
      for (const s of list) {
        if (pool.has(s.songmid)) continue;
        const singers = (s.singer || []).map(x => x.name);
        if (VERSION_RE.test(s.songname || '') && !VERSION_RE.test(title)) continue;
        const artistOk = artistMatches(singers, artists);
        if (!titleMatches(s.songname, title, artistOk)) continue;
        const diff = durationSec && s.interval ? Math.abs(s.interval - durationSec) : (artistOk ? 0 : 999);
        if (artistOk ? diff > 20 : diff > 6) continue;
        pool.set(s.songmid, { s, singers, artistOk, score: (artistOk ? 40 : 0) - diff * 4 });
      }
      if ([...pool.values()].some(c => c.artistOk)) break;
    }
    const candidates = [...pool.values()].sort((a, b) => b.score - a.score);

    // Try the best few candidates until one actually has lyrics; prefer timestamped ones
    let plainFallback = null;
    for (const c of candidates.slice(0, 4)) {
      const lyric = cleanLyrics(await fetchLyric(c.s.songmid), title);
      if (!lyric) continue;
      // Different artist + no Japanese text = almost certainly an unrelated same-title song
      if (!c.artistOk && !JP_RE.test(lyric)) continue;
      const isSynced = (lyric.match(/^\[\d{2}:\d{2}\.\d{2,3}\]/gm) || []).length >= 3;
      const result = {
        found: true,
        trackName: c.s.songname,
        artistName: c.singers.join(', '),
        ...(isSynced ? { syncedLyrics: lyric } : { plainLyrics: lyric })
      };
      if (isSynced) {
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
        return res.status(200).json(result);
      }
      if (!plainFallback) plainFallback = result;
    }

    if (plainFallback) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).json(plainFallback);
    }
    return res.status(200).json({ found: false });
  } catch (err) {
    return res.status(502).json({ found: false, error: err.message });
  }
}
