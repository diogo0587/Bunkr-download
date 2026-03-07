import express from 'express';
import { createServer as createViteServer } from 'vite';
import fetch from 'node-fetch';
import { Readable } from 'stream';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API route to proxy HTML requests
  app.post('/api/fetch', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch' });
      }

      const text = await response.text();
      res.send(text);
    } catch (error) {
      console.error('Error fetching URL:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

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

  // API route to proxy file downloads
  app.get('/api/download', async (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) return res.status(400).send('URL required');
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://bunkr.cr/'
        }
      });

      if (!response.ok) return res.status(response.status).send('Failed to fetch');

      res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
      
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition) {
        res.setHeader('Content-Disposition', contentDisposition);
      } else {
        const filename = url.split('/').pop() || 'download';
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }

      if (response.body) {
        Readable.fromWeb(response.body as any).pipe(res);
      } else {
        res.status(500).send('No response body');
      }
    } catch (error) {
      console.error('Download error:', error);
      res.status(500).send('Internal server error');
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
