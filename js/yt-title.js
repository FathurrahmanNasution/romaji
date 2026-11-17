/**
 * Guess song title + artist from a YouTube video title and channel name.
 * Shared by the YouTube page (youtube.html) and the Chrome extension.
 * Depends on LYRICS.normKey (js/lyrics.js).
 */

const YT_TITLE = {
  // Bracketed tags that describe the upload, not the song
  TAG_RE: /\bmv\b|m\/v|\bpv\b|official|公式|music ?video|lyrics?\b|歌詞|\baudio\b|\bfull\b|\bhd\b|4k|歌ってみた|うたってみた|cover|カバー|弾いてみた|叩いてみた|踊ってみた|\blive\b|ライブ|\bshorts?\b|teaser|animated|アニメ|vocaloid|ボカロ|オリジナル|\boriginal\b|新曲|初音ミク|鏡音|巡音|\bgumi\b|\bkafu\b|可不|重音テト|feat|ft\.|\bver\b|version|remaster|\bop\b|\bed\b|主題歌|tie-?up|nightcore|sped up|slowed|romaji|english|\bsubs?\b|字幕/i,


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
