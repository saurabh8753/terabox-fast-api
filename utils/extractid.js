function extractShortUrl(url) {
  const match = url.match(/\/s\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("Invalid Terabox URL");
  return match[1];
}

module.exports = extractShortUrl;
