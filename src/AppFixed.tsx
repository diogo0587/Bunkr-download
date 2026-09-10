import React, { useMemo, useState } from 'react';
import {
  AlertCircle, Database, Download, ExternalLink, FileImage, FileVideo,
  Link2, Loader2, Play, Search, Trash2, X
} from 'lucide-react';

type FileKind = 'video' | 'image' | 'unknown';
type SearchMode = 'term' | 'url';

type ResolvedFile = {
  fileId: string;
  name: string;
  size: number | null;
  extension: string;
  type: FileKind;
  thumbnail: string | null;
  sourceUrl: string;
  downloadUrl: string;
  streamUrl: string;
  albumTitle?: string | null;
  albumUrl?: string | null;
};

type ResolveResponse =
  | { kind: 'file'; file: ResolvedFile }
  | { kind: 'album'; pages: string[]; count: number; title?: string };

const API_BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const apiUrl = (value: string) => `${API_BASE}${value.startsWith('/') ? value : `/${value}`}`;

function formatBytes(bytes: number | null) {
  if (!bytes) return 'Tamanho não informado';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function resolveUrl(url: string): Promise<ResolveResponse> {
  return readJson(await fetch(apiUrl('/api/resolve'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }));
}

export default function AppFixed() {
  const [mode, setMode] = useState<SearchMode>('term');
  const [term, setTerm] = useState('');
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<ResolvedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState<'all' | FileKind>('all');
  const [player, setPlayer] = useState<ResolvedFile | null>(null);

  const visibleFiles = useMemo(
    () => files.filter((file) => filter === 'all' || file.type === filter),
    [files, filter],
  );

  function resetMessages() {
    setError('');
    setStatus('');
  }

  async function runTermSearch() {
    const q = term.trim();
    if (q.length < 2 || loading) return;

    setLoading(true);
    setFiles([]);
    setError('');
    setStatus('Consultando o índice próprio e descobrindo novos álbuns...');

    try {
      const data = await readJson(await fetch(apiUrl(`/api/search?q=${encodeURIComponent(q)}&limit=80`)));
      setFiles(data.results || []);
      if (!data.results?.length) {
        setStatus('Nenhum resultado ainda. O índice cresce conforme novos álbuns são descobertos e abertos.');
      } else {
        const suffix = data.discovered ? ` • ${data.discovered} novo(s) álbum(ns) descoberto(s)` : '';
        setStatus(`${data.results.length} arquivo(s) encontrado(s)${suffix}.`);
      }
    } catch (err: any) {
      setError(err?.message || 'Falha ao pesquisar no índice.');
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  async function runUrlSearch(target = url) {
    const trimmed = target.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError('');
    setStatus('Lendo a página do Bunkr...');
    setFiles([]);

    try {
      const first = await resolveUrl(trimmed);
      if (first.kind === 'file') {
        setFiles([first.file]);
        setStatus('Arquivo resolvido e adicionado ao índice.');
        return;
      }

      const uniquePages = [...new Set(first.pages)];
      setStatus(`Álbum detectado. Resolvendo ${uniquePages.length} arquivo(s)...`);

      // Alimenta o catálogo próprio com o álbum completo em segundo plano.
      fetch(apiUrl('/api/index'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      }).catch(() => undefined);

      const resolved: ResolvedFile[] = [];
      const concurrency = 5;
      for (let i = 0; i < uniquePages.length; i += concurrency) {
        const batch = uniquePages.slice(i, i + concurrency);
        const results = await Promise.allSettled(batch.map(resolveUrl));
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.kind === 'file') {
            const file = result.value.file;
            if (!resolved.some((item) => item.fileId === file.fileId)) resolved.push(file);
          }
        }
        setFiles([...resolved]);
        setStatus(`Resolvendo álbum... ${Math.min(i + concurrency, uniquePages.length)}/${uniquePages.length}`);
      }

      if (!resolved.length) throw new Error('O álbum foi encontrado, mas nenhum arquivo pôde ser resolvido.');
      setStatus(`${resolved.length} arquivo(s) resolvido(s) e indexação iniciada.`);
    } catch (err: any) {
      setError(err?.message || 'Erro inesperado ao resolver o link.');
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  function directDownload(file: ResolvedFile) {
    const a = document.createElement('a');
    a.href = apiUrl(file.downloadUrl);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadAll() {
    visibleFiles.forEach((file, index) => {
      window.setTimeout(() => directDownload(file), index * 800);
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'term') runTermSearch();
    else runUrlSearch();
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Bunkr DL</h1>
                <p className="text-xs text-slate-400">Busca própria • player • download por fileId</p>
              </div>
            </div>
            <div className="hidden items-center gap-1.5 rounded-full border border-emerald-900/60 bg-emerald-950/40 px-3 py-1.5 text-xs text-emerald-300 sm:flex">
              <Database className="h-3.5 w-3.5" /> índice próprio
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
          <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-950 p-1">
            <button
              type="button"
              onClick={() => { setMode('term'); resetMessages(); }}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${mode === 'term' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              <Search className="h-4 w-4" /> Buscar termo
            </button>
            <button
              type="button"
              onClick={() => { setMode('url'); resetMessages(); }}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${mode === 'url' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              <Link2 className="h-4 w-4" /> Abrir URL
            </button>
          </div>

          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={submit}>
            <div className="relative flex-1">
              {mode === 'term' ? <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" /> : <Link2 className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />}
              <input
                value={mode === 'term' ? term : url}
                onChange={(e) => mode === 'term' ? setTerm(e.target.value) : setUrl(e.target.value)}
                onPaste={(e) => {
                  if (mode !== 'url') return;
                  const value = e.clipboardData.getData('text').trim();
                  if (value.startsWith('http')) {
                    setUrl(value);
                    window.setTimeout(() => runUrlSearch(value), 0);
                  }
                }}
                placeholder={mode === 'term' ? 'Nome, título ou parte do nome do arquivo...' : 'Cole um link /f/... ou /a/... do Bunkr'}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-3 outline-none focus:border-blue-500"
              />
            </div>
            <button
              disabled={loading || (mode === 'term' ? term.trim().length < 2 : !url.trim())}
              className="flex min-w-32 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
              {loading ? 'Buscando' : 'Buscar'}
            </button>
          </form>

          {status && !error && <p className="mt-3 text-sm text-slate-400">{status}</p>}
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </section>

        {files.length > 0 && (
          <section className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {(['all', 'video', 'image', 'unknown'] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    className={`rounded-lg px-3 py-2 text-sm ${filter === value ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'}`}
                  >
                    {value === 'all' ? 'Todos' : value === 'video' ? 'Vídeos' : value === 'image' ? 'Imagens' : 'Outros'}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={downloadAll} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500">
                  Baixar visíveis
                </button>
                <button
                  onClick={() => { setFiles([]); setStatus(''); setError(''); }}
                  className="grid place-items-center rounded-lg bg-slate-800 px-3 text-slate-300 hover:bg-slate-700"
                  title="Limpar"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleFiles.map((file) => (
                <article key={file.fileId} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setPlayer(file)}
                    className="group relative block aspect-video w-full overflow-hidden bg-black text-left"
                    title={file.type === 'video' ? 'Reproduzir' : 'Visualizar'}
                  >
                    {file.thumbnail ? (
                      <img src={file.thumbnail} alt="" className="h-full w-full object-cover opacity-80 transition group-hover:opacity-100" loading="lazy" referrerPolicy="no-referrer" />
                    ) : file.type === 'image' ? (
                      <img src={apiUrl(file.streamUrl)} alt="" className="h-full w-full object-contain" loading="lazy" />
                    ) : (
                      <div className="h-full w-full bg-slate-950" />
                    )}
                    <div className="absolute inset-0 grid place-items-center bg-black/20 transition group-hover:bg-black/10">
                      <span className="grid h-14 w-14 place-items-center rounded-full bg-black/65 backdrop-blur">
                        <Play className="h-7 w-7 fill-white text-white" />
                      </span>
                    </div>
                  </button>

                  <div className="p-4">
                    <div className="mb-3 flex items-start gap-2">
                      {file.type === 'video' ? <FileVideo className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" /> : <FileImage className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold" title={file.name}>{file.name}</h2>
                        {file.albumTitle && <p className="truncate text-xs text-slate-400">{file.albumTitle}</p>}
                        <p className="text-xs text-slate-500">ID {file.fileId} • {formatBytes(file.size)}</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button onClick={() => setPlayer(file)} className="grid place-items-center rounded-lg bg-slate-800 px-3 hover:bg-slate-700" title="Player">
                        <Play className="h-4 w-4" />
                      </button>
                      <button onClick={() => directDownload(file)} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500">
                        <Download className="h-4 w-4" /> Baixar
                      </button>
                      <a href={file.sourceUrl} target="_blank" rel="noreferrer" className="grid place-items-center rounded-lg bg-slate-800 px-3 hover:bg-slate-700" title="Abrir origem">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {!loading && files.length === 0 && !error && (
          <div className="mx-auto mt-14 max-w-lg text-center text-slate-500">
            <Database className="mx-auto mb-3 h-9 w-9 text-slate-700" />
            <p className="text-sm">A busca usa um catálogo próprio. Links abertos são indexados automaticamente e novas buscas podem descobrir e incorporar novos álbuns ao catálogo.</p>
          </div>
        )}
      </main>

      {player && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 sm:p-6" onClick={() => setPlayer(null)}>
          <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{player.name}</p>
                <p className="text-xs text-slate-500">{formatBytes(player.size)}</p>
              </div>
              <button onClick={() => setPlayer(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-800 hover:bg-slate-700" aria-label="Fechar player">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex min-h-[240px] items-center justify-center bg-black sm:min-h-[480px]">
              {player.type === 'video' ? (
                <video key={player.fileId} controls autoPlay playsInline preload="metadata" poster={player.thumbnail || undefined} src={apiUrl(player.streamUrl)} className="max-h-[75vh] w-full object-contain" />
              ) : (
                <img src={apiUrl(player.streamUrl)} alt={player.name} className="max-h-[75vh] max-w-full object-contain" />
              )}
            </div>

            <div className="flex gap-2 p-3">
              <button onClick={() => directDownload(player)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold hover:bg-blue-500">
                <Download className="h-5 w-5" /> Baixar
              </button>
              <a href={player.sourceUrl} target="_blank" rel="noreferrer" className="grid place-items-center rounded-xl bg-slate-800 px-4 hover:bg-slate-700" title="Abrir origem">
                <ExternalLink className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
