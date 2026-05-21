const TERABOX_DOMAINS = [
  "terabox.com",
  "www.terabox.com",
  "teraboxapp.com",
  "www.teraboxapp.com",
  "1024tera.com",
  "www.1024tera.com",
  "nephobox.com",
  "www.nephobox.com",
  "4funbox.com",
  "www.4funbox.com"
];

function extractShorturl(inputUrl) {
  const url = new URL(inputUrl);

  if (!TERABOX_DOMAINS.includes(url.hostname)) {
    throw new Error("Unsupported TeraBox domain");
  }

  const pathMatch = url.pathname.match(/\/s\/([^/?]+)/);
  if (pathMatch) return pathMatch[1];

  const surl = url.searchParams.get("surl");
  if (surl) return surl;

  throw new Error("Could not extract shorturl");
}

async function getTeraBoxData(inputUrl) {
  const shorturl = extractShorturl(inputUrl);

  const apiUrl =
    `https://www.terabox.com/share/list?app_id=250528&shorturl=${encodeURIComponent(shorturl)}&root=1`;

  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json"
    }
  });

  const data = await response.json();

  if (!data.list || !Array.isArray(data.list)) {
    throw new Error("No files found");
  }

  const files = data.list.map(file => ({
    name: file.server_filename,
    size: file.size,
    category: file.category,
    fs_id: file.fs_id,
    is_dir: file.isdir === 1,
    thumbnail: file.thumb || file.image || null,
    download: file.dlink || null
  }));

  return {
    shorturl,
    count: files.length,
    files
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { url } = req.query;

    if (!url) {
      return res.status(200).json({
        success: true,
        message: "TeraBox API is working.",
        usage: "/api/download?url=https://terabox.com/s/xxxxxxxx"
      });
    }

    const result = await getTeraBoxData(url);

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}
