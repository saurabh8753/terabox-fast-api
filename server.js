const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Constants ──────────────────────────────────────────────────────────────
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TERABOX_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.terabox.com/",
  Origin: "https://www.terabox.com",
};

// Cookie from env (ndus=xxx format or just value)
function getCookies() {
  const raw = process.env.TERABOX_COOKIE || "";
  if (!raw) return {};
  // Support both "ndus=xxx" and plain value
  if (raw.includes("=")) {
    const obj = {};
    raw.split(";").forEach((pair) => {
      const [k, ...v] = pair.trim().split("=");
      if (k) obj[k.trim()] = v.join("=").trim();
    });
    return obj;
  }
  return { ndus: raw };
}

function cookieString() {
  return Object.entries(getCookies())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ─── URL helpers ─────────────────────────────────────────────────────────────
const SHORTURL_PATTERNS = [
  /terabox\.com\/s\/([^/?&]+)/,
  /1024tera\.com\/s\/([^/?&]+)/,
  /1024terabox\.com\/s\/([^/?&]+)/,
  /4funbox\.com\/s\/([^/?&]+)/,
  /mirrobox\.com\/s\/([^/?&]+)/,
  /teraboxapp\.com\/s\/([^/?&]+)/,
  /terabox\.app\/s\/([^/?&]+)/,
  /terasharefile\.com\/s\/([^/?&]+)/,
  /teraboxlink\.com\/s\/([^/?&]+)/,
  /surl=([^&]+)/,
  /\/s\/([^/?&]+)/,
];
const SHORTURL_DIRECT = /^[a-zA-Z0-9_-]{10,25}$/;

function extractShorturl(url) {
  for (const p of SHORTURL_PATTERNS) {
    const m = url.match(p);
    if (m) return m[1];
  }
  if (SHORTURL_DIRECT.test(url)) return url;
  return null;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function getFileType(name) {
  const n = (name || "").toLowerCase();
  if ([".mp4", ".mov", ".m4v", ".mkv", ".avi", ".wmv", ".3gp", ".flv"].some((e) => n.endsWith(e))) return "video";
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"].some((e) => n.endsWith(e))) return "image";
  if ([".mp3", ".aac", ".wav", ".flac", ".ogg", ".m4a"].some((e) => n.endsWith(e))) return "audio";
  if ([".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".txt"].some((e) => n.endsWith(e))) return "document";
  if ([".zip", ".rar", ".7z", ".tar", ".gz"].some((e) => n.endsWith(e))) return "archive";
  return "other";
}

// ─── Step 1: Get jsToken + bdstoken from TeraBox share page ──────────────────
async function getTokens(surl) {
  const url = `https://www.terabox.com/sharing/link?surl=${surl}`;
  const res = await fetch(url, {
    headers: {
      ...TERABOX_HEADERS,
      Cookie: cookieString(),
    },
    redirect: "follow",
  });
  const html = await res.text();

  const jsTokenMatch = html.match(/window\.jsToken\s*=\s*["']([^"']+)["']/);
  const bdstokenMatch = html.match(/bdstoken["']?\s*[:=]\s*["']([^"']+)["']/);
  const logidMatch = html.match(/dp-logid["']?\s*[:=]\s*["']([^"']+)["']/);

  return {
    jsToken: jsTokenMatch ? jsTokenMatch[1] : null,
    bdstoken: bdstokenMatch ? bdstokenMatch[1] : null,
    logid: logidMatch ? logidMatch[1] : null,
  };
}

// ─── Step 2: Get share file list ─────────────────────────────────────────────
async function getShareList(surl, pwd = "") {
  // First try without tokens (public shares)
  const params = new URLSearchParams({
    app_id: "250528",
    shorturl: surl,
    root: "1",
    ...(pwd ? { pwd } : {}),
  });

  const res = await fetch(
    `https://www.terabox.com/api/shorturlinfo?${params}`,
    {
      headers: {
        ...TERABOX_HEADERS,
        Cookie: cookieString(),
      },
    }
  );

  if (!res.ok) throw new Error(`HTTP ${res.status} from shorturlinfo`);
  const data = await res.json();

  if (data.errno !== 0) {
    // Try alternate endpoint
    const params2 = new URLSearchParams({
      app_id: "250528",
      shorturl: surl,
      root: "1",
      channel: "dubox",
      web: "1",
      ...(pwd ? { pwd } : {}),
    });

    const res2 = await fetch(
      `https://www.1024tera.com/api/shorturlinfo?${params2}`,
      { headers: TERABOX_HEADERS }
    );
    if (!res2.ok) throw new Error(`HTTP ${res2.status} from 1024tera shorturlinfo`);
    const data2 = await res2.json();
    if (data2.errno !== 0) throw new Error(`TeraBox errno ${data2.errno}: ${data2.errmsg || "Unknown error"}`);
    return data2;
  }

  return data;
}

// ─── Step 3: Get fresh dlink via filemetas ───────────────────────────────────
async function getFreshDlink({ fsid, uk, shareid, sign, timestamp }) {
  const params = new URLSearchParams({
    app_id: "250528",
    fsids: `[${fsid}]`,
    dlink: "1",
    uk: String(uk),
    shareid: String(shareid),
    sign: String(sign),
    timestamp: String(timestamp),
    channel: "dubox",
    web: "1",
  });

  const res = await fetch(
    `https://www.terabox.com/api/filemetas?${params}`,
    {
      headers: {
        ...TERABOX_HEADERS,
        Cookie: cookieString(),
      },
    }
  );

  if (!res.ok) throw new Error(`HTTP ${res.status} from filemetas`);
  const data = await res.json();

  if (data.errno !== 0) throw new Error(`filemetas errno ${data.errno}`);
  const dlink = data.info?.[0]?.dlink;
  if (!dlink) throw new Error("No dlink in filemetas response");
  return dlink;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { status: "error", message: "Too many requests" },
  })
);

// ══════════════════════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// GET /info?url=...
app.get("/info", async (req, res) => {
  const { url, pwd } = req.query;
  if (!url) return res.status(400).json({ status: "error", message: "Missing ?url=" });

  const surl = extractShorturl(url);
  if (!surl) return res.status(400).json({ status: "error", message: "Invalid TeraBox URL" });

  const start = Date.now();
  try {
    const data = await getShareList(surl, pwd || "");

    const ukVal = data.uk || data.share_uk;
    const shareidVal = data.shareid;
    const signVal = data.sign;
    const timestampVal = data.timestamp;

    const files = (data.list || []).map((item) => ({
      fs_id: String(item.fs_id),
      name: item.server_filename,
      size: parseInt(item.size) || 0,
      size_formatted: formatBytes(parseInt(item.size) || 0),
      is_dir: item.isdir === "1" || item.isdir === 1,
      file_type: getFileType(item.server_filename),
      thumbnail: item.thumbs?.url3 || item.thumbs?.url1 || "",
      create_time: item.server_ctime || null,
    }));

    return res.json({
      status: "success",
      response_time: `${((Date.now() - start) / 1000).toFixed(3)}s`,
      shorturl: surl,
      title: data.title || "",
      uk: ukVal,
      shareid: shareidVal,
      sign: signVal,
      timestamp: timestampVal,
      total_files: files.length,
      files,
    });
  } catch (e) {
    return res.status(502).json({ status: "error", message: e.message });
  }
});

// GET /link?url=...&fsid=...
// Returns fresh download link as JSON
app.get("/link", async (req, res) => {
  const { url, fsid, pwd } = req.query;
  if (!url) return res.status(400).json({ status: "error", message: "Missing ?url=" });

  const surl = extractShorturl(url);
  if (!surl) return res.status(400).json({ status: "error", message: "Invalid TeraBox URL" });

  const start = Date.now();
  try {
    // Step 1: get share info
    const data = await getShareList(surl, pwd || "");
    const uk = data.uk || data.share_uk;
    const shareid = data.shareid;
    const sign = data.sign;
    const timestamp = data.timestamp;

    // Pick file
    const list = data.list || [];
    const targetFile = fsid
      ? list.find((f) => String(f.fs_id) === String(fsid))
      : list.find((f) => f.isdir !== "1" && f.isdir !== 1) || list[0];

    if (!targetFile) return res.status(404).json({ status: "error", message: "File not found" });

    // Step 2: get fresh dlink
    const dlink = await getFreshDlink({
      fsid: targetFile.fs_id,
      uk,
      shareid,
      sign,
      timestamp,
    });

    return res.json({
      status: "success",
      response_time: `${((Date.now() - start) / 1000).toFixed(3)}s`,
      filename: targetFile.server_filename,
      size: formatBytes(parseInt(targetFile.size) || 0),
      size_bytes: parseInt(targetFile.size) || 0,
      file_type: getFileType(targetFile.server_filename),
      download_link: dlink,
    });
  } catch (e) {
    return res.status(502).json({ status: "error", message: e.message });
  }
});

// GET /download?url=...&fsid=...
// 302 redirect to direct CDN download — no buffering
app.get("/download", async (req, res) => {
  const { url, fsid, pwd } = req.query;
  if (!url) return res.status(400).json({ status: "error", message: "Missing ?url=" });

  const surl = extractShorturl(url);
  if (!surl) return res.status(400).json({ status: "error", message: "Invalid TeraBox URL" });

  try {
    const data = await getShareList(surl, pwd || "");
    const uk = data.uk || data.share_uk;
    const shareid = data.shareid;
    const sign = data.sign;
    const timestamp = data.timestamp;

    const list = data.list || [];
    const targetFile = fsid
      ? list.find((f) => String(f.fs_id) === String(fsid))
      : list.find((f) => f.isdir !== "1" && f.isdir !== 1) || list[0];

    if (!targetFile) return res.status(404).json({ status: "error", message: "File not found" });

    const dlink = await getFreshDlink({
      fsid: targetFile.fs_id,
      uk,
      shareid,
      sign,
      timestamp,
    });

    // Direct redirect — browser hits TeraBox CDN directly
    return res.redirect(302, dlink);
  } catch (e) {
    return res.status(502).json({ status: "error", message: e.message });
  }
});

// GET /health
app.get("/health", (_, res) =>
  res.json({ status: "ok", timestamp: new Date().toISOString() })
);

// GET /
app.get("/", (_, res) =>
  res.json({
    name: "TeraBox API",
    version: "2.0.0",
    note: "Direct TeraBox API — no third-party worker dependency",
    endpoints: {
      "GET /info?url=TERABOX_URL": "File list + metadata",
      "GET /link?url=TERABOX_URL&fsid=FS_ID": "Fresh download link (JSON)",
      "GET /download?url=TERABOX_URL&fsid=FS_ID": "Direct download (302 redirect)",
      "GET /health": "Health check",
    },
    optional_params: {
      fsid: "Specific file fs_id. Omit to use first file.",
      pwd: "Password for protected shares.",
    },
    env: {
      TERABOX_COOKIE: "Your ndus cookie value (required for filemetas)",
      PORT: "Server port (default 3000)",
    },
  })
);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`TeraBox API v2 running on http://localhost:${PORT}`);
  if (!process.env.TERABOX_COOKIE) {
    console.warn("WARNING: TERABOX_COOKIE not set — filemetas may fail for some files");
  }
});
