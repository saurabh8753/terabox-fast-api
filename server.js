const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Constants (same as Trauso) ────────────────────────────────────────────
const HNN_BASE = "https://terabox.hnn.workers.dev";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

const HNN_HEADERS = {
  Accept: "*/*",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "sec-ch-ua": `"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"`,
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": `"Windows"`,
  Priority: "u=1, i",
  Referer: `${HNN_BASE}/`,
  Origin: HNN_BASE,
  "User-Agent": USER_AGENT,
};

// ─── Supported URL patterns (same as Trauso) ───────────────────────────────
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
  for (const pattern of SHORTURL_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
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
  const n = name.toLowerCase();
  if ([".mp4", ".mov", ".m4v", ".mkv", ".avi", ".wmv", ".3gp", ".flv"].some((e) => n.endsWith(e))) return "video";
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"].some((e) => n.endsWith(e))) return "image";
  if ([".pdf", ".docx", ".doc", ".xlsx", ".zip", ".rar", ".7z"].some((e) => n.endsWith(e))) return "file";
  return "other";
}

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 30,
  message: { status: "error", message: "Too many requests, slow down." },
});
app.use(limiter);

// ─── Step 1: Get file info (shareid, uk, sign, timestamp, file list) ───────
async function getInfo(shorturl) {
  const endpoints = ["/api/get-info-new", "/api/get-info"];
  let lastError = "Unknown error";

  for (const endpoint of endpoints) {
    try {
      const url = `${HNN_BASE}${endpoint}?shorturl=${encodeURIComponent(shorturl)}&pwd=`;
      const res = await fetch(url, { headers: HNN_HEADERS });

      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${endpoint}`;
        continue;
      }

      const data = await res.json();

      if (data.ok) {
        return {
          ok: true,
          shareid: data.shareid,
          uk: data.uk,
          sign: data.sign,
          timestamp: data.timestamp,
          title: data.title || "",
          list: (data.list || []).map((item) => ({
            fs_id: String(item.fs_id),
            name: item.filename,
            size: parseInt(item.size) || 0,
            size_formatted: formatBytes(parseInt(item.size) || 0),
            is_dir: item.is_dir === "1" || item.is_dir === 1,
            file_type: getFileType(item.filename),
            category: item.category || null,
            create_time: item.create_time ? parseInt(item.create_time) : null,
          })),
        };
      }

      lastError = data.message || `${endpoint} returned ok=false`;
    } catch (e) {
      lastError = `${endpoint} error: ${e.message}`;
    }
  }

  return { ok: false, message: lastError };
}

// ─── Step 2: Get fresh download link (POST to hnn) ─────────────────────────
async function getDownloadLink({ shareid, uk, sign, timestamp, fs_id, mode = 2 }) {
  // mode 1 = get-download first, mode 2 = get-downloadp first (more stable)
  const order =
    mode === 1
      ? ["/api/get-download", "/api/get-downloadp"]
      : ["/api/get-downloadp", "/api/get-download"];

  let lastError = "Unknown error";

  for (const endpoint of order) {
    try {
      const res = await fetch(`${HNN_BASE}${endpoint}`, {
        method: "POST",
        headers: { ...HNN_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          shareid: Number(shareid),
          uk: Number(uk),
          sign: String(sign),
          timestamp: Number(timestamp),
          fs_id: String(fs_id),
        }),
      });

      const data = await res.json();

      if (data.ok && data.downloadLink) {
        return { ok: true, download_link: data.downloadLink };
      }

      lastError = data.message || `${endpoint} returned ok=false`;
    } catch (e) {
      lastError = `${endpoint} error: ${e.message}`;
    }
  }

  return { ok: false, message: lastError };
}

// ══════════════════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════════════════

// GET /info?url=...
// Returns: file list + shareid/uk/sign/timestamp needed for /download
app.get("/info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ status: "error", message: "Missing ?url= parameter" });

  const shorturl = extractShorturl(url);
  if (!shorturl) return res.status(400).json({ status: "error", message: "Invalid TeraBox URL" });

  const start = Date.now();
  const result = await getInfo(shorturl);

  if (!result.ok) {
    return res.status(502).json({ status: "error", message: result.message });
  }

  return res.json({
    status: "success",
    response_time: `${((Date.now() - start) / 1000).toFixed(3)}s`,
    shorturl,
    title: result.title,
    shareid: result.shareid,
    uk: result.uk,
    sign: result.sign,
    timestamp: result.timestamp,
    total_files: result.list.length,
    files: result.list,
  });
});

// GET /download?url=...&fsid=...
// One-shot: info + download link in single call, then 302 redirect
app.get("/download", async (req, res) => {
  const { url, fsid, mode } = req.query;
  if (!url) return res.status(400).json({ status: "error", message: "Missing ?url= parameter" });

  const shorturl = extractShorturl(url);
  if (!shorturl) return res.status(400).json({ status: "error", message: "Invalid TeraBox URL" });

  // Step 1: get info
  const info = await getInfo(shorturl);
  if (!info.ok) return res.status(502).json({ status: "error", message: info.message });

  // Pick file — fsid param se ya first file
  const targetFile = fsid
    ? info.list.find((f) => f.fs_id === String(fsid))
    : info.list[0];

  if (!targetFile) return res.status(404).json({ status: "error", message: "File not found" });
  if (targetFile.is_dir) return res.status(400).json({ status: "error", message: "Target is a folder, use /info to list files" });

  // Step 2: get fresh download link
  const linkResult = await getDownloadLink({
    shareid: info.shareid,
    uk: info.uk,
    sign: info.sign,
    timestamp: info.timestamp,
    fs_id: targetFile.fs_id,
    mode: mode ? parseInt(mode) : 2,
  });

  if (!linkResult.ok) return res.status(502).json({ status: "error", message: linkResult.message });

  // 302 redirect — browser directly hits CDN, no buffering
  return res.redirect(302, linkResult.download_link);
});

// GET /link?url=...&fsid=...
// Same as /download but returns JSON (for apps/frontend)
app.get("/link", async (req, res) => {
  const { url, fsid, mode } = req.query;
  if (!url) return res.status(400).json({ status: "error", message: "Missing ?url= parameter" });

  const shorturl = extractShorturl(url);
  if (!shorturl) return res.status(400).json({ status: "error", message: "Invalid TeraBox URL" });

  const start = Date.now();

  const info = await getInfo(shorturl);
  if (!info.ok) return res.status(502).json({ status: "error", message: info.message });

  const targetFile = fsid
    ? info.list.find((f) => f.fs_id === String(fsid))
    : info.list[0];

  if (!targetFile) return res.status(404).json({ status: "error", message: "File not found" });

  const linkResult = await getDownloadLink({
    shareid: info.shareid,
    uk: info.uk,
    sign: info.sign,
    timestamp: info.timestamp,
    fs_id: targetFile.fs_id,
    mode: mode ? parseInt(mode) : 2,
  });

  if (!linkResult.ok) return res.status(502).json({ status: "error", message: linkResult.message });

  return res.json({
    status: "success",
    response_time: `${((Date.now() - start) / 1000).toFixed(3)}s`,
    filename: targetFile.name,
    size: targetFile.size_formatted,
    size_bytes: targetFile.size,
    file_type: targetFile.file_type,
    download_link: linkResult.download_link,
  });
});

// POST /get-download-link
// Direct: accepts shareid/uk/sign/timestamp/fs_id, returns fresh link
app.post("/get-download-link", async (req, res) => {
  const { shareid, uk, sign, timestamp, fs_id, mode } = req.body;

  if (!shareid || !uk || !sign || !timestamp || !fs_id) {
    return res.status(400).json({
      status: "error",
      message: "Missing required fields: shareid, uk, sign, timestamp, fs_id",
    });
  }

  const result = await getDownloadLink({ shareid, uk, sign, timestamp, fs_id, mode });

  if (!result.ok) return res.status(502).json({ status: "error", message: result.message });

  return res.json({ status: "success", download_link: result.download_link });
});

// GET /health
app.get("/health", (_, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// GET / — API docs
app.get("/", (_, res) => {
  res.json({
    name: "TeraBox API",
    version: "1.0.0",
    endpoints: {
      "GET /info?url=TERABOX_URL": "Get file list + metadata",
      "GET /link?url=TERABOX_URL&fsid=FS_ID": "Get direct download link (JSON)",
      "GET /download?url=TERABOX_URL&fsid=FS_ID": "Download redirect (302)",
      "POST /get-download-link": "Get fresh link with shareid/uk/sign/timestamp/fs_id",
      "GET /health": "Health check",
    },
    notes: {
      fsid: "Optional. If omitted, first file is used.",
      mode: "1 or 2 (default 2). Download server preference.",
    },
  });
});

// ─── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`TeraBox API running on http://localhost:${PORT}`);
});
