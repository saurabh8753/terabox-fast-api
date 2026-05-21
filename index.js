const express = require('express');
const cors = require('cors');
const { getDownloadLink } = require('terabox-api');

const app = express();
app.use(cors());

app.get('/api/download', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        const data = await getDownloadLink(url);
        return res.json({ success: true, download_url: data.download_url });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = app;
