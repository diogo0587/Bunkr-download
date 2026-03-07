import express from 'express';
import { createServer as createViteServer } from 'vite';
import fetch from 'node-fetch';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API route to proxy Bunkr requests
  app.post('/api/bunkr', async (req, res) => {
    try {
      const { slug } = req.body;
      if (!slug) {
        return res.status(400).json({ error: 'Slug is required' });
      }

      const response = await fetch('https://bunkr.cr/api/vs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://bunkr.cr',
          'Referer': `https://bunkr.cr/v/${slug}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({ slug })
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch from Bunkr' });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Error proxying to Bunkr:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
