import { getTeraBoxData } from "../lib/terabox.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const url = req.query.url;

    if (!url) {
      return res.status(200).json({
        success: true,
        message: "TeraBox API is working.",
        usage:
          "/api/download?url=https://terabox.com/s/xxxxxxxx"
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
      error: error.message,
      stack:
        process.env.NODE_ENV === "development"
          ? error.stack
          : undefined
    });
  }
}
