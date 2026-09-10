import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, ExternalLink, FileImage, FileVideo, Loader2, Play, Search, Trash2 } from 'lucide-react';

type FileKind = 'video' | 'image' | 'unknown';

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
};

type ResolveResponse =
  | { kind: 'file'; file: ResolvedFile }
  | { kind: 'album'; pages: string[]; count: number };

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

async function resolveUrl(url: string): Promise<ResolveResponse> {
  const response = await fetch('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Falha ao resolver: HTTP ${response.status}`);
  return data;
}

export default function AppFixed() {
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<ResolvedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState<'all' | FileKind>('all');

  const visibleFiles = useMemo(
    () => files.filter((file) => filter === 'all' || file.type === filter),
    [files, filter],
  );

  async function runSearch(target = url) {
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
        setStatus('Arquivo resolvido com sucesso.');
        return;
      }

      const uniquePages = [...new Set(first.pages)];
      setStatus(`Álbum detectado. Resolvendo ${uniquePages.length} arquivos...`);

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
      setStatus(`${resolved.length} arquivo(s) resolvido(s).`);
    } catch (err: any) {
      setError(err?.message || 'Erro inesperado ao resolver o link.');
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  function directDownload(file: ResolvedFile) {
    const a = document.createElement('a');
    a.href = file.downloadUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadAll() {
    visibleFiles.forEach((file, index) => {
      window.setTimeout(() => directDownload(file), index * 700);
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Bunkr DL</h1>
              <p className="text-xs text-slate-400">Resolver atual por fileId, sem depender do player antigo</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onPaste={(e) => {
                  const value = e.clipboardData.getData('text').trim();
                  if (value.startsWith('http')) {
                    setUrl(value);
                    window.setTimeout(() => runSearch(value), 0);
                  }
                }}
                placeholder="Cole um link /f/... ou /a/... do Bunkr"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-3 outline-none focus:border-blue-500"
              />
            </div>
            <button
              disabled={loading || !url.trim()}
              className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
              {loading ? 'Resolvendo' : 'Buscar'}
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
                  onClick={() => {
                    setFiles([]);
                    setStatus('');
                    setError('');
                  }}
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
                  <div className="aspect-video bg-black">
                    {file.type === 'video' ? (
                      <video
                        controls
                        preload="metadata"
                        poster={file.thumbnail || undefined}
                        src={file.streamUrl}
                        className="h-full w-full object-contain"
                      />
                    ) : file.thumbnail || file.type === 'image' ? (
                      <img
                        src={file.type === 'image' ? file.streamUrl : file.thumbnail || ''}
                        alt={file.name}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-slate-600">
                        <Play className="h-10 w-10" />
                      </div>
                    )}
                  </div>

                  <div className="p-4">
                    <div className="mb-3 flex items-start gap-2">
                      {file.type === 'video' ? <FileVideo className="mt-0.5 h-4 w-4 text-blue-400" /> : <FileImage className="mt-0.5 h-4 w-4 text-emerald-400" />}
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold" title={file.name}>{file.name}</h2>
                        <p className="text-xs text-slate-500">ID {file.fileId} • {formatBytes(file.size)}</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => directDownload(file)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500"
                      >
                        <Download className="h-4 w-4" /> Baixar
                      </button>
                      <a
                        href={file.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="grid place-items-center rounded-lg bg-slate-800 px-3 hover:bg-slate-700"
                        title="Abrir página original"
                      >
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
          <div className="mx-auto mt-14 max-w-md text-center text-slate-500">
            <CheckCircle2 className="mx-auto mb-3 h-9 w-9 text-slate-700" />
            <p className="text-sm">Cole um link atual do Bunkr. O backend extrai o fileId e transmite o arquivo por uma rota própria com suporte a Range.</p>
          </div>
        )}
      </main>
    </div>
  );
}
