const axios = require("axios");
const extractShortUrl = require("../utils/extractId");

async function fetchList(shortId, dir = "") {

  const res = await axios.get(
    "https://www.terabox.com/share/list",
    {
      params: {
        shorturl: shortId,
        dir: dir,
        num: 100,
        page: 1,
        root: dir ? 0 : 1
      },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    }
  );

  return res.data.list || [];
}

async function crawlFolder(shortId, dir = "") {

  const items = await fetchList(shortId, dir);

  let results = [];

  for (const item of items) {

    if (item.isdir === 1) {

      const sub = await crawlFolder(shortId, item.path);

      results = results.concat(sub);

    } else {

      results.push({
        name: item.server_filename,
        size: item.size,
        path: item.path,
        thumbnail: item.thumbs?.url3 || null,
        stream: item.dlink,
        download: item.dlink
      });

    }
  }

  return results;
}

async function getTeraboxData(url) {

  const shortId = extractShortUrl(url);

  const files = await crawlFolder(shortId);

  return {
    total_files: files.length,
    files
  };
}

module.exports = { getTeraboxData };
