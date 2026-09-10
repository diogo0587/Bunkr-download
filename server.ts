import express from 'express';
import { createServer as createViteServer } from 'vite';
import fetch from 'node-fetch';

const USER_AGENT = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

function isAllowedBunkrUrl(value: string) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return host.includes('bunkr') && host !== 'localhost' && host !== '127.0.0.1';
  } catch {
    return false;
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
}

function pickFileId(html: string) {
  const patterns = [
    /data-file-id=["'](\d+)["']/i,
    /get\.bunkrr\.su\/file\/(\d+)/i,
    /\/api\/file\/stats\/(\d+)/i,
    /Debug:\s*Original=.*?Size=\d+[\s\S]{0,2000}?data-file-id=["'](\d+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function pickMeta(html: string, targetUrl: string) {
  const fileId = pickFileId(html);
  const title =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    'arquivo';

  const thumbnail = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
  const debug = html.match(/Debug:\s*Original=([^,]+),\s*Size=(\d+)/i);
  const name = stripTags(debug?.[1] || title).replace(/\s*\|\s*Bunkr\s*$/i, '') || `file-${fileId || 'unknown'}`;
  const size = debug?.[2] ? Number(debug[2]) : null;
  const ext = (name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
  const videoExts = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v']);
  const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);
  const type = videoExts.has(ext) ? 'video' : imageExts.has(ext) ? 'image' : 'unknown';
  const jsSlug = html.match(/(?:var|let|const)\s+jsSlug\s*=\s*["']([^"']+)["']/i)?.[1] || null;

  return {
    fileId,
    name,
    size,
    extension: ext ? `.${ext}` : '',
    type,
    thumbnail,
    jsSlug,
    sourceUrl: targetUrl,
    downloadUrl: fileId ? `/api/media/${fileId}?download=1` : null,
    streamUrl: fileId ? `/api/media/${fileId}` : null,
  };
}

function extractFilePages(html: string, baseUrl: string) {
  const out = new Set<string>();
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html))) {
    try {
      const absolute = new URL(decodeHtml(match[1]), baseUrl);
      if (absolute.pathname.match(/^\/f\/[A-Za-z0-9_-]+/)) out.add(absolute.href);
    } catch {
      // ignore malformed links
    }
  }
  return [...out];
}

async function getPage(url: string) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`Bunkr returned HTTP ${response.status}`);
  return { html: await response.text(), finalUrl: response.url || url };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, resolver: 'bunkr-current', version: 2 });
  });

  app.post('/api/fetch', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || !isAllowedBunkrUrl(url)) return res.status(400).json({ error: 'URL Bunkr inválida' });
      const { html } = await getPage(url);
      res.type('html').send(html);
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Falha ao acessar Bunkr' });
    }
  });

  app.post('/api/resolve', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || !isAllowedBunkrUrl(url)) return res.status(400).json({ error: 'Informe uma URL válida do Bunkr' });

      const { html, finalUrl } = await getPage(url);
      const meta = pickMeta(html, finalUrl);
      if (meta.fileId) return res.json({ kind: 'file', file: meta });

      const pages = extractFilePages(html, finalUrl);
      if (pages.length) return res.json({ kind: 'album', pages: pages.slice(0, 250), count: pages.length });

      return res.status(404).json({ error: 'Não encontrei fileId nem links /f/ nesta página', diagnostics: { finalUrl } });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Falha ao resolver página do Bunkr' });
    }
  });

  app.get('/api/media/:fileId', async (req, res) => {
    try {
      const fileId = String(req.params.fileId || '');
      if (!/^\d+$/.test(fileId)) return res.status(400).send('fileId inválido');

      const upstream = await fetch(`https://get.bunkrr.su/file/${fileId}`, {
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': '*/*',
          ...(req.headers.range ? { Range: req.headers.range } : {}),
        },
      });

      if (!upstream.ok && upstream.status !== 206) {
        return res.status(upstream.status).send(`Falha no servidor de mídia: HTTP ${upstream.status}`);
      }

      res.status(upstream.status);
      for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const value = upstream.headers.get(header);
        if (value) res.setHeader(header, value);
      }

      const disposition = upstream.headers.get('content-disposition');
      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', disposition || `attachment; filename="bunkr-${fileId}"`);
      } else {
        res.setHeader('Content-Disposition', 'inline');
      }
      res.setHeader('Cache-Control', 'private, max-age=300');

      if (!upstream.body) return res.status(502).send('Resposta sem corpo');
      (upstream.body as any).pipe(res);
    } catch (error: any) {
      if (!res.headersSent) res.status(502).send(error?.message || 'Erro ao transmitir mídia');
      else res.end();
    }
  });

  app.post('/api/bunkr', (_req, res) => {
    res.status(410).json({ error: 'Endpoint legado. Use /api/resolve.' });
  });

  app.get('/api/download', async (req, res) => {
    try {
      const url = String(req.query.url || '');
      if (!url || !isAllowedBunkrUrl(url)) return res.status(400).send('URL Bunkr inválida');
      const upstream = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*' } });
      if (!upstream.ok) return res.status(upstream.status).send('Falha ao baixar');
      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
      const len = upstream.headers.get('content-length');
      if (len) res.setHeader('Content-Length', len);
      res.setHeader('Content-Disposition', upstream.headers.get('content-disposition') || 'attachment');
      if (!upstream.body) return res.status(502).send('Resposta sem corpo');
      (upstream.body as any).pipe(res);
    } catch (error: any) {
      res.status(502).send(error?.message || 'Erro interno');
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => res.sendFile('index.html', { root: 'dist' }));
  }

  app.listen(PORT, '0.0.0.0', () => console.log(`Bunkr DL running on http://0.0.0.0:${PORT}`));
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
