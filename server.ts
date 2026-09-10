import express from 'express';
import { createServer as createViteServer } from 'vite';
import fetch from 'node-fetch';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const USER_AGENT = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'bunkr-index.db'));

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS albums (
    url TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    indexed_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS files (
    file_id TEXT PRIMARY KEY,
    album_url TEXT,
    name TEXT NOT NULL,
    size INTEGER,
    extension TEXT,
    type TEXT NOT NULL,
    thumbnail TEXT,
    source_url TEXT NOT NULL,
    indexed_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
  CREATE INDEX IF NOT EXISTS idx_files_album ON files(album_url);
  CREATE INDEX IF NOT EXISTS idx_albums_title ON albums(title);
`);

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

function pickTitle(html: string) {
  const raw =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    'Bunkr';
  return stripTags(raw).replace(/\s*\|\s*Bunkr\s*$/i, '').trim();
}

function pickFileId(html: string) {
  const patterns = [
    /data-file-id=["'](\d+)["']/i,
    /get\.bunkrr\.su\/file\/(\d+)/i,
    /\/api\/file\/stats\/(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function pickMeta(html: string, targetUrl: string) {
  const fileId = pickFileId(html);
  const title = pickTitle(html);
  const thumbnail = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
  const debug = html.match(/Debug:\s*Original=([^,]+),\s*Size=(\d+)/i);
  const name = stripTags(debug?.[1] || title) || `file-${fileId || 'unknown'}`;
  const size = debug?.[2] ? Number(debug[2]) : null;
  const ext = (name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
  const videoExts = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v']);
  const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);
  const type = videoExts.has(ext) ? 'video' : imageExts.has(ext) ? 'image' : 'unknown';

  return {
    fileId,
    name,
    size,
    extension: ext ? `.${ext}` : '',
    type,
    thumbnail,
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
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`Bunkr returned HTTP ${response.status}`);
  return { html: await response.text(), finalUrl: response.url || url };
}

function saveAlbum(url: string, title: string) {
  db.prepare(`
    INSERT INTO albums(url, title, indexed_at) VALUES (?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET title=excluded.title, indexed_at=excluded.indexed_at
  `).run(url, title || 'Bunkr album', Date.now());
}

function saveFile(file: ReturnType<typeof pickMeta>, albumUrl: string | null = null) {
  if (!file.fileId) return;
  db.prepare(`
    INSERT INTO files(file_id, album_url, name, size, extension, type, thumbnail, source_url, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET
      album_url=COALESCE(excluded.album_url, files.album_url),
      name=excluded.name,
      size=excluded.size,
      extension=excluded.extension,
      type=excluded.type,
      thumbnail=excluded.thumbnail,
      source_url=excluded.source_url,
      indexed_at=excluded.indexed_at
  `).run(file.fileId, albumUrl, file.name, file.size, file.extension, file.type, file.thumbnail, file.sourceUrl, Date.now());
}

function searchCatalog(term: string, limit = 60) {
  const needle = `%${term.toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT f.file_id AS fileId, f.name, f.size, f.extension, f.type, f.thumbnail,
           f.source_url AS sourceUrl, f.album_url AS albumUrl, a.title AS albumTitle
    FROM files f
    LEFT JOIN albums a ON a.url = f.album_url
    WHERE lower(f.name) LIKE ? OR lower(COALESCE(a.title, '')) LIKE ?
    ORDER BY f.indexed_at DESC
    LIMIT ?
  `).all(needle, needle, limit) as any[];

  return rows.map((row) => ({
    ...row,
    downloadUrl: `/api/media/${row.fileId}?download=1`,
    streamUrl: `/api/media/${row.fileId}`,
  }));
}

function normalizeDiscoveredUrl(raw: string) {
  try {
    let candidate = decodeHtml(raw);
    if (candidate.startsWith('//duckduckgo.com/l/?')) candidate = `https:${candidate}`;
    const parsed = new URL(candidate, 'https://html.duckduckgo.com/');
    if (parsed.hostname.includes('duckduckgo.com') && parsed.searchParams.get('uddg')) {
      candidate = decodeURIComponent(parsed.searchParams.get('uddg') || '');
    }
    const url = new URL(candidate);
    if (!isAllowedBunkrUrl(url.href)) return null;
    if (!url.pathname.match(/^\/a\/[A-Za-z0-9_-]+/)) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function discoverAlbums(term: string, maxResults = 8) {
  const query = `site:bunkr.ph/a/ ${term}`;
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
  });
  if (!response.ok) return [];
  const html = await response.text();
  const urls = new Set<string>();
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html))) {
    const normalized = normalizeDiscoveredUrl(match[1]);
    if (normalized) urls.add(normalized);
    if (urls.size >= maxResults) break;
  }
  return [...urls];
}

async function indexAlbum(albumUrl: string) {
  const { html, finalUrl } = await getPage(albumUrl);
  const title = pickTitle(html);
  saveAlbum(finalUrl, title);
  const pages = extractFilePages(html, finalUrl).slice(0, 120);
  let indexed = 0;

  const concurrency = 5;
  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(async (pageUrl) => {
      const page = await getPage(pageUrl);
      const meta = pickMeta(page.html, page.finalUrl);
      saveFile(meta, finalUrl);
      return meta;
    }));
    indexed += results.filter((result) => result.status === 'fulfilled' && result.value.fileId).length;
  }

  return { url: finalUrl, title, indexed, pages: pages.length };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = new Set([
      'https://diogo0587.github.io',
      'http://localhost:3000',
      'http://localhost:5173',
      ...(process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',').map((v) => v.trim()) : []),
    ]);
    if (origin && allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    const files = Number((db.prepare('SELECT COUNT(*) AS n FROM files').get() as any).n || 0);
    const albums = Number((db.prepare('SELECT COUNT(*) AS n FROM albums').get() as any).n || 0);
    res.json({ ok: true, resolver: 'bunkr-current', version: 3, index: { files, albums } });
  });

  app.get('/api/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const limit = Math.min(Math.max(Number(req.query.limit || 60), 1), 100);
      if (q.length < 2) return res.status(400).json({ error: 'Digite pelo menos 2 caracteres' });

      let results = searchCatalog(q, limit);
      let discovered: string[] = [];

      if (results.length < 10 && req.query.discover !== '0') {
        discovered = await discoverAlbums(q, 6);
        for (const albumUrl of discovered.slice(0, 4)) {
          try {
            await indexAlbum(albumUrl);
          } catch {
            // discovery is best-effort; keep searching the local catalog
          }
        }
        results = searchCatalog(q, limit);
      }

      res.json({ query: q, count: results.length, discovered: discovered.length, results });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Falha na busca' });
    }
  });

  app.post('/api/index', async (req, res) => {
    try {
      const url = String(req.body?.url || '');
      if (!url || !isAllowedBunkrUrl(url)) return res.status(400).json({ error: 'URL Bunkr inválida' });
      const result = await indexAlbum(url);
      res.json({ ok: true, ...result });
    } catch (error: any) {
      res.status(502).json({ error: error?.message || 'Falha ao indexar álbum' });
    }
  });

  app.post('/api/resolve', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || !isAllowedBunkrUrl(url)) return res.status(400).json({ error: 'Informe uma URL válida do Bunkr' });

      const { html, finalUrl } = await getPage(url);
      const meta = pickMeta(html, finalUrl);
      if (meta.fileId) {
        saveFile(meta);
        return res.json({ kind: 'file', file: meta });
      }

      const pages = extractFilePages(html, finalUrl);
      if (pages.length) {
        saveAlbum(finalUrl, pickTitle(html));
        return res.json({ kind: 'album', pages: pages.slice(0, 250), count: pages.length, title: pickTitle(html) });
      }

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
          Accept: '*/*',
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

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        return res.sendFile(path.resolve('dist/index.html'));
      }
      next();
    });
  }

  app.listen(PORT, '0.0.0.0', () => console.log(`Bunkr DL running on http://0.0.0.0:${PORT}`));
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
