# TeraBox API

Node.js/Express API for TeraBox downloads using the same approach as the Trauso desktop app.

## Endpoints

### `GET /info?url=TERABOX_URL`
Get file list and metadata.

**Response:**
```json
{
  "status": "success",
  "shareid": 123,
  "uk": 456,
  "sign": "xxx",
  "timestamp": 1234567890,
  "total_files": 1,
  "files": [
    {
      "fs_id": "868719768277188",
      "name": "video.mp4",
      "size": 296581573,
      "size_formatted": "282.84 MB",
      "file_type": "video",
      "is_dir": false
    }
  ]
}
```

---

### `GET /link?url=TERABOX_URL&fsid=FS_ID`
Get direct download link as JSON. `fsid` is optional (uses first file).

**Response:**
```json
{
  "status": "success",
  "filename": "video.mp4",
  "size": "282.84 MB",
  "download_link": "https://cdn.terabox.com/..."
}
```

---

### `GET /download?url=TERABOX_URL&fsid=FS_ID`
302 redirect to direct download. Best for browser/app download buttons.

---

### `POST /get-download-link`
Get fresh link when you already have metadata from `/info`.

**Body:**
```json
{
  "shareid": 123,
  "uk": 456,
  "sign": "xxx",
  "timestamp": 1234567890,
  "fs_id": "868719768277188"
}
```

---

## Setup

```bash
npm install
npm start
```

## Deploy to Vercel

```bash
vercel deploy
```

## Usage in Android App

```kotlin
// Step 1: Get info
val info = api.getInfo("https://teraboxlink.com/s/XXXX")

// Step 2: Get download link for specific file
val link = api.getLink(url = teraboxUrl, fsid = file.fs_id)

// Step 3: Open download_link directly
```
