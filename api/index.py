from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import requests
import re
import json
import os

app = FastAPI(
    title="TeraBox Direct API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_cookies():
    cookies = {}
    if os.path.exists("cookies.txt"):
        with open("cookies.txt", "r", encoding="utf-8") as f:
            content = f.read()

        for line in content.splitlines():
            if line.startswith("#") or not line.strip():
                continue

            parts = line.split("\t")
            if len(parts) >= 7:
                cookies[parts[5]] = parts[6]

    return cookies



def human_size(size_bytes):
    try:
        size_bytes = int(size_bytes)
    except:
        return "Unknown"

    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(size_bytes)

    for unit in units:
        if size < 1024:
            return f"{size:.2f} {unit}"
        size /= 1024

    return f"{size:.2f} PB"



def extract_json_from_html(html: str):
    patterns = [
        r'window\\.__INITIAL_STATE__\\s*=\\s*(\\{.*?\\})\\s*;',
        r'window\\.__INITIAL_STATE__=(\\{.*?\\});',
        r'__INITIAL_STATE__\\s*=\\s*(\\{.*?\\})\\s*;'
    ]

    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except:
                pass

    return None



def deep_find_file(obj):
    if isinstance(obj, dict):
        if "server_filename" in obj:
            return obj
        for value in obj.values():
            result = deep_find_file(value)
            if result:
                return result

    elif isinstance(obj, list):
        for item in obj:
            result = deep_find_file(item)
            if result:
                return result

    return None



def get_terabox_info(url: str):
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.terabox.com/"
    }

    try:
        response = requests.get(
            url,
            headers=headers,
            cookies=load_cookies(),
            timeout=30,
            allow_redirects=True
        )
        response.raise_for_status()
    except Exception as e:
        return {
            "success": False,
            "message": str(e)
        }

    data = extract_json_from_html(response.text)

    if not data:
        return {
            "success": False,
            "message": "Unable to extract page data"
        }

    file_info = deep_find_file(data)

    if not file_info:
        return {
            "success": False,
            "message": "File info not found"
        }

    title = file_info.get("server_filename", "Unknown File")
    size_bytes = file_info.get("size", 0)
    dlink = file_info.get("dlink")

    thumbs = file_info.get("thumbs", {})
    thumbnail = thumbs.get("url3") if isinstance(thumbs, dict) else None

    return {
        "success": True,
        "data": {
            "title": title,
            "size_bytes": size_bytes,
            "size": human_size(size_bytes),
            "thumbnail": thumbnail,
            "download_link": dlink,
            "stream_link": dlink,
            "raw": file_info
        }
    }


@app.get("/")
def root():
    return {
        "name": "TeraBox Direct API",
        "version": "1.0.0",
        "usage": "/api?url=https://terabox.com/s/xxxxxxxx"
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api")
def api(url: str = Query(..., description="TeraBox share URL")):
    return get_terabox_info(url)
