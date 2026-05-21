import express from 'express';
import cors from 'cors';
import { getDownloadLink } from 'terabox-api';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Terabox API Server is running successfully!');
});

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

// Vercel serverless ke liye bina module.exports ke seedha default export chalega
export default app;
