export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "Missing URL parameter"
      });
    }

    // ESM import
    const module = await import("terabox-api");

    const Terabox = module.Terabox || module.default;

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
