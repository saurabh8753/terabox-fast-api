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

export function extractShorturl(inputUrl) {
  const url = new URL(inputUrl);

  if (!TERABOX_DOMAINS.includes(url.hostname)) {
    throw new Error("Unsupported TeraBox domain");
  }

  // https://terabox.com/s/1AbCdEfGh
  const pathMatch = url.pathname.match(/\/s\/([^/?]+)/);
  if (pathMatch) return pathMatch[1];

  // https://terabox.com/share/init?surl=xxxxx
  const surl = url.searchParams.get("surl");
  if (surl) return surl;

  throw new Error("Could not extract shorturl");
}

export async function getTeraBoxData(inputUrl) {
  const shorturl = extractShorturl(inputUrl);

  const endpoint =
    `https://www.terabox.com/share/list?app_id=250528&shorturl=${encodeURIComponent(shorturl)}&root=1`;

  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`TeraBox API error: ${response.status}`);
  }

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
    thumbnail:
      file.thumb ||
      file.image ||
      file.video_info?.thumbnail ||
      null,
    download: file.dlink || null
  }));

  return {
    shorturl,
    count: files.length,
    files,
    raw: data
  };
}
