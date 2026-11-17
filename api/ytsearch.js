/**
 * Vercel Serverless Function: /api/ytsearch?q=
 * Searches YouTube by reading the public search results page (no API key).
 * The page embeds its results as JSON in `var ytInitialData = {...};`.
 * Note: this relies on YouTube's page structure and may need updating if it changes.
 *
 * Response: { items: [{ kind: 'video'|'playlist', id, title, channel, duration, thumbnail }] }
 */

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'ja,en;q=0.8'
};

const text = (node) => {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.simpleText) return node.simpleText;
  if (node.content) return node.content;
  if (Array.isArray(node.runs)) return node.runs.map(r => r.text).join('');
  return '';
};

function extractInitialData(html) {
  const marker = 'var ytInitialData = ';
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const end = html.indexOf(';</script>', start);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(start + marker.length, end));
  } catch (e) {
    return null;
  }
}

function parseResults(data) {
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const items = [];

  for (const section of sections) {
    for (const it of section?.itemSectionRenderer?.contents || []) {
      const v = it.videoRenderer;
      if (v && v.videoId) {
        // Skip live streams / upcoming premieres (no length)
        if (!v.lengthText) continue;
        const thumbs = v.thumbnail?.thumbnails || [];
        items.push({
          kind: 'video',
          id: v.videoId,
          title: text(v.title),
          channel: text(v.ownerText) || text(v.longBylineText),
          duration: text(v.lengthText),
          thumbnail: (thumbs[0] && thumbs[0].url) || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`
        });
        continue;
      }

      // Playlists are rendered as "lockup" view models in the current layout
      const l = it.lockupViewModel;
      if (l && l.contentId && /PLAYLIST/i.test(l.contentType || '')) {
        const meta = l.metadata?.lockupMetadataViewModel;
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const channel = rows.flatMap(r => (r.metadataParts || []).map(p => text(p.text))).find(Boolean) || '';
        const src = l.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources || [];
        items.push({
          kind: 'playlist',
          id: l.contentId,
          title: text(meta?.title),
          channel,
          duration: '',
          thumbnail: (src[0] && src[0].url) || ''
        });
        continue;
      }

      // Older playlist layout
      const p = it.playlistRenderer;
      if (p && p.playlistId) {
        const thumb = p.thumbnails?.[0]?.thumbnails?.[0]?.url || '';
        items.push({
          kind: 'playlist',
          id: p.playlistId,
          title: text(p.title),
          channel: text(p.shortBylineText),
          duration: '',
          thumbnail: thumb
        });
      }
    }
  }
  return items;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Missing q' });

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const page = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
      headers: HEADERS,
      signal: ctrl.signal
    });
    if (!page.ok) return res.status(502).json({ error: `YouTube returned HTTP ${page.status}` });

    const data = extractInitialData(await page.text());
    if (!data) return res.status(502).json({ error: 'Could not read YouTube search results (page format changed?)' });

    const items = parseResults(data).slice(0, 12);
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ items });
  } catch (err) {
    return res.status(502).json({ error: err.name === 'AbortError' ? 'YouTube search timed out' : err.message });
  } finally {
    clearTimeout(tid);
  }
}
