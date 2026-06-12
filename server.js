const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Config ──────────────────────────────────────────────────────────────────
// Your existing Cloudflare Worker proxy (already working for resolve)
const WORKER_BASE = process.env.WORKER_URL || "https://tbx-proxy.shakir-ansarii075.workers.dev";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

function extractSurl(url) {
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
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"].some((e) => n.endsWith(e))) return "image";
  if ([".mp3", ".aac", ".wav", ".flac", ".m4a"].some((e) => n.endsWith(e))) return "audio";
  if ([".zip", ".rar", ".7z", ".tar"].some((e) => n.endsWith(e))) return "archive";
  return "other";
}

// ─── Core: resolve share via your existing worker ────────────────────────────
// Worker already handles TeraBox auth — no bot detection on Cloudflare IPs
async function resolveShare(surl, pwd = "") {
  const params = new URLSearchParams({ mode: "resolve", surl, raw: "1" });
  if (pwd) params.set("pwd", pwd);

  const res = await fetch(`${WORKER_BASE}/?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) throw new Error(`Worker returned HTTP ${res.status}`);

  const json = await res.json();
  if (json.error) throw new Error(json.error);

  // Worker returns either:
  // {source:"live", upstream:{...terabox list response...}}
  // {source:"d1",   data:{uk, shareid, list:[...]}}
  let list = [];
  let uk = "", shareid = "";

  if (json.upstream) {
    // Live format
    const up = json.upstream;
    uk = String(up.uk || up.share_uk || "");
    shareid = String(up.shareid || "");
    list = up.list || [];
  } else if (json.data?.list) {
    // D1 cached format
    uk = String(json.data.uk || "");
    shareid = String(json.data.shareid || "");
    list = json.data.list || [];
  } else {
    throw new Error("Unexpected worker response format");
  }

  return { uk, shareid, list };
}

// ─── Get fresh dlink for a specific file via worker ──────────────────────────
// Worker's mode=resolve fetches a brand new dlink each time (called on-demand)
async function getFreshDlink(surl, fsid, pwd = "") {
  // Re-resolve to get fresh dlink — worker fetches new signed URL every call
  const { list } = await resolveShare(surl, pwd);

  const file = fsid
    ? list.find((f) => String(f.fs_id) === String(fsid))
    : list.find((f) => !f.isdir) || list[0];

  if (!file) throw new Error("File not found in share");
  if (!file.dlink) throw new Error("No dlink in worker response");

  return { dlink: file.dlink, file };
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { status: "error", message: "Too many requests" },
}));

// ══════════════════════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// GET /info?url=...
app.get("/info", async (req, res) => {
  const { url, pwd } = req.query;
  if (!url) return res.status(400).json({ status: "error", message: "Missing ?url=" });

  const surl = extractSurl(url);
  if (!surl) return res.status(400).json({ status: "error", message: "Invalid TeraBox URL" });

  const start = Date.now();
  try {
    const { uk, shareid, list } = await resolveShare(surl, pwd || "");

    const files = list.map((item) => ({
      fs_id: String(item.fs_id),
      name: item.server_filename,
      size: parseInt(item.size) || 0,
      size_formatted: formatBytes(parseInt(item.size) || 0),
      is_dir: item.isdir === "1" || item.isdir === 1,
      file_type: getFileType(item.server_filename),
      thumbnail: item.thumbs?.url3 || item.thumbs?.url1 || "",
    }));

    return res.json({
      status: "success",
      response_time: `${((Date.now() - start) / 1000).toFixed(3)}s`,
      shorturl: surl,
      uk,
      shareid,
      total_files: files.length,
      files,
    });
  } catch (e) {
    return res.status(502).json({ status: "error", message: e.message });
  }
});

// GET /link?url=...&fsid=...
// Returns fresh download link as JSON — called on-demand so link is always fresh
app.get("/link", async (req, res) => {
  const { url, fsid, pwd } = req.query;
  if (!url) return res.status(400).json({ status: "error", message: "Missing ?url=" });

  const surl = extractSurl(url);
  if (!surl) return res.status(400).json({ status: "error", message: "Invalid TeraBox URL" });

  const start = Date.now();
  try {
    const { dlink, file } = await getFreshDlink(surl, fsid, pwd || "");

    return res.json({
      status: "success",
      response_time: `${((Date.now() - start) / 1000).toFixed(3)}s`,
      filename: file.server_filename,
      size: formatBytes(parseInt(file.size) || 0),
      size_bytes: parseInt(file.size) || 0,
      file_type: getFileType(file.server_filename),
      download_link: dlink,
    });
  } catch (e) {
    return res.status(502).json({ status: "error", message: e.message });
  }
});

// GET /download?url=...&fsid=...
// 302 redirect to fresh dlink — browser downloads directly from TeraBox CDN
app.get("/download", async (req, res) => {
  const { url, fsid, pwd } = req.query;
  if (!url) return res.status(400).json({ status: "error", message: "Missing ?url=" });

  const surl = extractSurl(url);
  if (!surl) return res.status(400).json({ status: "error", message: "Invalid TeraBox URL" });

  try {
    const { dlink } = await getFreshDlink(surl, fsid, pwd || "");
    return res.redirect(302, dlink);
  } catch (e) {
    return res.status(502).json({ status: "error", message: e.message });
  }
});

// GET /health
app.get("/health", (_, res) =>
  res.json({ status: "ok", worker: WORKER_BASE, timestamp: new Date().toISOString() })
);

// GET /
app.get("/", (_, res) =>
  res.json({
    name: "TeraBox API",
    version: "3.0.0",
    endpoints: {
      "GET /info?url=TERABOX_URL": "File list + metadata",
      "GET /link?url=TERABOX_URL&fsid=FS_ID": "Fresh download link (JSON)",
      "GET /download?url=TERABOX_URL&fsid=FS_ID": "Direct download (302 redirect, no buffering)",
    },
    optional_params: { fsid: "Specific file. Omit for first file.", pwd: "Share password." },
    env: { WORKER_URL: "Your Cloudflare Worker URL (default: tbx-proxy worker)" },
  })
);

app.listen(PORT, () => console.log(`TeraBox API v3 on http://localhost:${PORT}`));
