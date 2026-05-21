const { Terabox } = require("terabox-api");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const url = req.query.url;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "Missing URL"
      });
    }

    const terabox = new Terabox();

    const data = await terabox.getDownloadLink(url);

    return res.status(200).json({
      success: true,
      data
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
