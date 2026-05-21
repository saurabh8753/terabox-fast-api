export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const { url } = req.query;

    if (!url) {
      return res.json({
        success: true,
        message: "API working",
        usage: "/api/download?url=https://terabox.com/s/xxxx"
      });
    }

    // 1. Fetch share page HTML
    const htmlRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const html = await htmlRes.text();

    // 2. Extract shorturl
    const shortMatch = url.match(/\/s\/([^/?]+)/);
    if (!shortMatch) {
      throw new Error("Short URL not found");
    }

    const shorturl = shortMatch[1];

    // 3. Extract jsToken
    const jsTokenMatch = html.match(/"jsToken":"(.*?)"/);
    const jsToken = jsTokenMatch ? jsTokenMatch[1] : "";

    // 4. Extract uk
    const ukMatch = html.match(/"uk":(\d+)/);
    const uk = ukMatch ? ukMatch[1] : "";

    // 5. Extract shareid
    const shareidMatch = html.match(/"shareid":(\d+)/);
    const shareid = shareidMatch ? shareidMatch[1] : "";

    // 6. Call share/list
    const apiUrl =
      `https://www.terabox.com/share/list?app_id=250528` +
      `&shorturl=${shorturl}` +
      `&root=1` +
      `&jsToken=${jsToken}` +
      `&uk=${uk}` +
      `&shareid=${shareid}`;

    const apiRes = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    });

    const data = await apiRes.json();

    if (!data.list || data.list.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No files found",
        debug: {
          shorturl,
          uk,
          shareid,
          jsToken
        }
      });
    }

    const files = data.list.map(file => ({
      name: file.server_filename,
      size: file.size,
      thumbnail: file.thumb,
      download: file.dlink
    }));

    return res.json({
      success: true,
      count: files.length,
      files
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}
