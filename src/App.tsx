import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Download, Copy, Trash2, Archive, CheckCircle2, 
  AlertCircle, Loader2, FileVideo, FileImage, ExternalLink,
  PlayCircle
} from 'lucide-react';
import JSZip from 'jszip';

// Types
interface MediaFile {
  id: string;
  url: string;
  name: string;
  type: 'video' | 'image' | 'unknown';
  extension: string;
  size?: number;
  status: 'idle' | 'downloading' | 'success' | 'error';
  progress: number;
}

const SUPPORTED_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.jpg', '.jpeg', '.png', '.gif', '.webp'];

const decryptBunkrUrl = (encryptedUrl: string, timestamp: number): string => {
  const atob = (str: string) => window.atob(str);
  
  const _0x555dd1 = (_0x3c475f: string) => {
    const _0x4d77ad = atob(_0x3c475f);
    const _0x36a886 = new Uint8Array(_0x4d77ad.length);
    for (let _0x2e440c = 0; _0x2e440c < _0x4d77ad.length; _0x2e440c++) {
      _0x36a886[_0x2e440c] = _0x4d77ad.charCodeAt(_0x2e440c);
    }
    return _0x36a886;
  };

  const _0x3c5a5b = (_0x1497e5: Uint8Array, _0x2adf11: string) => {
    const _0x5bbd19 = new TextEncoder().encode(_0x2adf11);
    const _0x311ecf = new Uint8Array(_0x1497e5.length);
    for (let _0x5ed4f4 = 0; _0x5ed4f4 < _0x1497e5.length; _0x5ed4f4++) {
      _0x311ecf[_0x5ed4f4] = _0x1497e5[_0x5ed4f4] ^ _0x5bbd19[_0x5ed4f4 % _0x5bbd19.length];
    }
    return new TextDecoder().decode(_0x311ecf);
  };

  const key = 'SECRET_KEY_' + Math.floor(timestamp / 3600);
  const decoded = _0x555dd1(encryptedUrl);
  return _0x3c5a5b(decoded, key);
};

export default function App() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [error, setError] = useState('');
  const [globalProgress, setGlobalProgress] = useState(0);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'video' | 'image'>('all');

  const fetchWithProxies = async (targetUrl: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      });
      if (res.ok) {
        return await res.text();
      }
    } catch (e) {
      console.warn('Backend proxy failed, falling back to public proxies...', e);
    }

    const proxies = [
      `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
    ];

    for (const proxyUrl of proxies) {
      try {
        const response = await fetch(proxyUrl);
        if (response.ok) {
          if (proxyUrl.includes('allorigins')) {
            const data = await response.json();
            return data.contents;
          } else {
            return await response.text();
          }
        }
      } catch (e) {
        console.warn(`Proxy ${proxyUrl} failed, trying next...`);
      }
    }
    return null;
  };

  const extractLinks = (html: string, baseUrl: string): MediaFile[] => {
    const extractedFiles: Map<string, MediaFile> = new Map();
    
    // Unescape JSON slashes (e.g., https:\/\/cdn... -> https://cdn...)
    const cleanHtml = html.replace(/\\\//g, '/');
    
    // Aggressive Regex to find any media URL
    const urlRegex = /https?:\/\/[^\s"'<>]+?\.(?:mp4|webm|mkv|jpg|jpeg|png|gif|webp)(?:\?[^\s"'<>]*)?/gi;
    const matches = cleanHtml.match(urlRegex) || [];
    
    matches.forEach(url => {
      try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname.toLowerCase();
        const ext = SUPPORTED_EXTENSIONS.find(e => pathname.endsWith(e));
        if (ext) {
          const type = ['.mp4', '.webm', '.mkv'].includes(ext) ? 'video' : 'image';
          const name = pathname.split('/').pop() || `file${ext}`;
          
          // Ignore common UI images
          if (type === 'image' && (pathname.includes('avatar') || pathname.includes('icon') || pathname.includes('logo') || pathname.includes('favicon'))) {
            return;
          }

          if (!extractedFiles.has(url)) {
            extractedFiles.set(url, {
              id: Math.random().toString(36).substring(7),
              url: url,
              name: decodeURIComponent(name),
              type,
              extension: ext,
              status: 'idle',
              progress: 0
            });
          }
        }
      } catch(e) {}
    });

    // DOM Parsing fallback
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const mediaTags = Array.from(doc.querySelectorAll('video source, img, a'));
    
    mediaTags.forEach(tag => {
      let src = tag.getAttribute('src') || tag.getAttribute('href');
      if (!src) return;
      
      try {
        const absoluteUrl = new URL(src, baseUrl).href;
        const urlObj = new URL(absoluteUrl);
        const pathname = urlObj.pathname.toLowerCase();
        
        const ext = SUPPORTED_EXTENSIONS.find(e => pathname.endsWith(e));
        if (ext && !extractedFiles.has(absoluteUrl)) {
          const type = ['.mp4', '.webm', '.mkv'].includes(ext) ? 'video' : 'image';
          const name = pathname.split('/').pop() || `file${ext}`;
          
          if (type === 'image' && (pathname.includes('avatar') || pathname.includes('icon') || pathname.includes('logo') || pathname.includes('favicon'))) {
            return;
          }

          extractedFiles.set(absoluteUrl, {
            id: Math.random().toString(36).substring(7),
            url: absoluteUrl,
            name: decodeURIComponent(name),
            type,
            extension: ext,
            status: 'idle',
            progress: 0
          });
        }
      } catch (e) {}
    });

    return Array.from(extractedFiles.values());
  };

  const extractBunkrPageLinks = (html: string, baseUrl: string): string[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a'));
    const pageUrls = new Set<string>();
    
    links.forEach(link => {
      let href = link.getAttribute('href');
      if (!href) return;
      try {
        const absoluteUrl = new URL(href, baseUrl).href;
        const urlObj = new URL(absoluteUrl);
        // Match Bunkr specific paths: /v/ (video), /i/ (image), /d/ (download)
        if (urlObj.pathname.match(/^\/[vid]\/[a-zA-Z0-9_-]+/)) {
          pageUrls.add(absoluteUrl);
        }
      } catch (e) {}
    });
    return Array.from(pageUrls);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    try {
      new URL(url);
    } catch {
      setError('URL inválida. Por favor, insira um link válido.');
      return;
    }

    setIsLoading(true);
    setError('');
    setFiles([]);
    setGlobalProgress(0);
    setStatus('Buscando arquivos...');

    try {
      const htmlContent = await fetchWithProxies(url);
      
      if (!htmlContent) {
        throw new Error('Falha ao acessar a página. O site pode estar bloqueando o acesso ou estar temporariamente indisponível.');
      }
      
      setStatus('Analisando página...');
      
      let extractedFiles: MediaFile[] = [];
      const urlObj = new URL(url);
      
      // Check if it's a single video page
      const videoMatch = urlObj.pathname.match(/^\/v\/([a-zA-Z0-9_-]+)/);
      if (videoMatch) {
        const slug = videoMatch[1];
        try {
          const res = await fetch('/api/bunkr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.url && data.timestamp) {
              const videoUrl = decryptBunkrUrl(data.url, data.timestamp);
              const name = videoUrl.split('/').pop() || `video-${slug}.mp4`;
              extractedFiles.push({
                id: Math.random().toString(36).substring(7),
                url: videoUrl,
                name: decodeURIComponent(name),
                type: 'video',
                extension: '.mp4',
                status: 'idle',
                progress: 0
              });
            }
          } else {
             console.warn('Backend returned error for single video');
          }
        } catch (e) {
          console.warn('Failed to fetch single video', e);
        }
      } else {
        // It's likely an album page or other page
        const pageLinks = extractBunkrPageLinks(htmlContent, url);
        
        if (pageLinks.length > 0) {
          setStatus(`Encontrados ${pageLinks.length} links. Extraindo mídias (isso pode levar um momento)...`);
          
          let processed = 0;
          const batchSize = 3; // Process 3 at a time to avoid overwhelming proxies
          
          for (let i = 0; i < pageLinks.length; i += batchSize) {
            const batch = pageLinks.slice(i, i + batchSize);
            const promises = batch.map(async (pageUrl) => {
              try {
                const pageUrlObj = new URL(pageUrl);
                const match = pageUrlObj.pathname.match(/^\/v\/([a-zA-Z0-9_-]+)/);
                if (match) {
                  const slug = match[1];
                  const res = await fetch('/api/bunkr', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ slug })
                  });
                  if (res.ok) {
                    const data = await res.json();
                    if (data.url && data.timestamp) {
                      const videoUrl = decryptBunkrUrl(data.url, data.timestamp);
                      const name = videoUrl.split('/').pop() || `video-${slug}.mp4`;
                      return {
                        id: Math.random().toString(36).substring(7),
                        url: videoUrl,
                        name: decodeURIComponent(name),
                        type: 'video' as const,
                        extension: '.mp4',
                        status: 'idle' as const,
                        progress: 0
                      };
                    }
                  }
                } else if (pageUrlObj.pathname.match(/^\/i\/([a-zA-Z0-9_-]+)/)) {
                  // It's an image page, we need to fetch it to get the real image URL
                  const pageHtml = await fetchWithProxies(pageUrl);
                  if (pageHtml) {
                    const pageFiles = extractLinks(pageHtml, pageUrl);
                    // Filter out thumbs, we want the full image
                    const fullImages = pageFiles.filter(f => f.type === 'image' && !f.url.includes('/thumbs/'));
                    return fullImages[0] || pageFiles[0];
                  }
                }
              } catch (e) {
                console.warn(`Failed to process link ${pageUrl}`, e);
              }

              // Fallback to old method if not a recognized Bunkr page
              try {
                const pageHtml = await fetchWithProxies(pageUrl);
                if (pageHtml) {
                  const pageFiles = extractLinks(pageHtml, pageUrl);
                  // Prefer video over image, and filter out thumbs
                  const validFiles = pageFiles.filter(f => !f.url.includes('/thumbs/'));
                  return validFiles.find(f => f.type === 'video') || validFiles.find(f => f.type === 'image');
                }
              } catch (e) {
                 console.warn(`Fallback extraction failed for ${pageUrl}`, e);
              }
              return null;
            });
            
            const results = await Promise.all(promises);
            results.forEach(res => {
              if (res && !extractedFiles.some(f => f.url === res.url)) {
                extractedFiles.push(res);
              }
            });
            
            processed += batch.length;
            setGlobalProgress(Math.round((processed / pageLinks.length) * 100));
            setStatus(`Analisando mídias... ${processed}/${pageLinks.length}`);
          }
          setGlobalProgress(0);
        } else {
          // Fallback to basic extraction if no Bunkr page links found
          extractedFiles = extractLinks(htmlContent, url);
          // Filter out thumbnails
          extractedFiles = extractedFiles.filter(f => !f.url.includes('/thumbs/'));
        }
      }
      
      if (extractedFiles.length === 0) {
        setError('Nenhum arquivo de mídia encontrado. Verifique se o link é válido e se o álbum não está vazio.');
        setStatus('');
      } else {
        // Remove thumbnails if we have the actual video with the same name
        // Bunkr often has video.mp4 and video.mp4.jpg
        const finalFiles = extractedFiles.filter(file => {
          if (file.type === 'image') {
            const videoExists = extractedFiles.some(v => v.type === 'video' && (v.name.includes(file.name.replace(/\.[^/.]+$/, "")) || file.name.includes(v.name.replace(/\.[^/.]+$/, ""))));
            if (videoExists) return false; // Skip this image as it's likely a thumbnail for the video
          }
          return true;
        });

        setFiles(finalFiles);
        setStatus(`${finalFiles.length} arquivos encontrados com sucesso.`);
      }
    } catch (err: any) {
      console.error('Search error:', err);
      if (err.message && err.message.includes('Falha ao acessar')) {
        setError(err.message);
      } else {
        setError('Ocorreu um erro inesperado ao buscar a página. Por favor, verifique sua conexão e tente novamente.');
      }
      setStatus('');
    } finally {
      setIsLoading(false);
    }
  };

  const downloadFile = async (file: MediaFile): Promise<boolean> => {
    try {
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'downloading', progress: 0 } : f));
      
      let response;
      try {
        response = await fetch(`/api/download?url=${encodeURIComponent(file.url)}`);
        if (!response.ok) throw new Error('Backend proxy failed');
      } catch (e) {
        console.warn('Backend download failed, falling back to new tab.', e);
        throw new Error('PROXY_FAILED');
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          if (value) {
            chunks.push(value);
            loaded += value.length;
            if (total) {
              const progress = Math.round((loaded / total) * 100);
              setFiles(prev => prev.map(f => f.id === file.id ? { ...f, progress } : f));
            }
          }
        }
      }

      const blob = new Blob(chunks);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'success', progress: 100 } : f));
      return true;
    } catch (err: any) {
      // If proxy failed, fallback to opening in a new tab
      if (err.message === 'PROXY_FAILED' || err.name === 'TypeError') {
        setToast(`Download direto de ${file.name} bloqueado. Abrindo em nova aba...`);
        const a = document.createElement('a');
        a.href = file.url;
        a.download = file.name;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'success', progress: 100 } : f));
        return true;
      }

      setToast(`Erro ao baixar ${file.name}. Tente novamente.`);
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'error', progress: 0 } : f));
      return false;
    }
  };

  const handleDownloadSingle = async (file: MediaFile) => {
    await downloadFile(file);
  };

  const handleDownloadAll = async () => {
    const filesToDownload = files.filter(file => filterType === 'all' || file.type === filterType);
    if (filesToDownload.length === 0 || isProcessingBatch) return;
    
    setIsProcessingBatch(true);
    setStatus('Iniciando download em lote...');
    
    let completed = 0;
    for (const file of filesToDownload) {
      if (file.status !== 'success') {
        await downloadFile(file);
        // Add a small delay between downloads to prevent browser blocking multiple popups
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      completed++;
      setGlobalProgress(Math.round((completed / filesToDownload.length) * 100));
    }
    
    setStatus('Download em lote concluído!');
    setIsProcessingBatch(false);
    setTimeout(() => setGlobalProgress(0), 3000);
  };

  const handleGenerateZip = async () => {
    const filesToZip = files.filter(file => filterType === 'all' || file.type === filterType);
    if (filesToZip.length === 0 || isProcessingBatch) return;
    
    setIsProcessingBatch(true);
    setStatus('Preparando para gerar arquivo ZIP...');
    setGlobalProgress(0);
    
    const zip = new JSZip();
    let completed = 0;

    for (const file of filesToZip) {
      setStatus(`Baixando ${file.name} para o ZIP...`);
      
      // For ZIP, we MUST fetch the blob. We can't use the fallback.
      try {
        let response;
        response = await fetch(`/api/download?url=${encodeURIComponent(file.url)}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const blob = await response.blob();
        zip.file(file.name, blob);
      } catch (err) {
        console.warn(`Failed to add ${file.name} to ZIP`, err);
        setToast(`Aviso: Não foi possível incluir ${file.name} no ZIP devido a restrições de acesso.`);
      }

      completed++;
      setGlobalProgress(Math.round((completed / filesToZip.length) * 50)); // First 50% is downloading
    }

    setStatus('Compactando arquivos... Isso pode levar alguns minutos dependendo do tamanho.');
    
    try {
      const content = await zip.generateAsync({ 
        type: 'blob',
        compression: 'STORE', // Faster, no compression needed for media
      }, (metadata) => {
        setGlobalProgress(50 + Math.round(metadata.percent / 2)); // Last 50% is zipping
      });

      const url = window.URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bunkr_album.zip';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setStatus('Arquivo ZIP gerado e download iniciado com sucesso!');
    } catch (err) {
      console.error('Error generating ZIP:', err);
      setError('Erro ao gerar arquivo ZIP. O arquivo pode ser muito grande para a memória do navegador.');
      setStatus('');
    } finally {
      setIsProcessingBatch(false);
      setTimeout(() => setGlobalProgress(0), 4000);
    }
  };

  const [toast, setToast] = useState('');

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setToast('Link copiado!');
    setTimeout(() => setToast(''), 3000);
  };

  const clearList = () => {
    setFiles([]);
    setStatus('');
    setError('');
    setUrl('');
    setGlobalProgress(0);
  };

  const filteredFiles = files.filter(file => filterType === 'all' || file.type === filterType);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30 pb-20">
      {/* Header */}
      <header className="bg-slate-900/50 border-b border-slate-800 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 md:py-6 flex flex-col items-center">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Download className="text-white w-6 h-6" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              Bunkr DL
            </h1>
          </div>
          <p className="text-slate-400 text-sm md:text-base text-center">
            Smart Album Downloader
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 relative">
        {/* Toast Notification */}
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-slate-200 px-4 py-2 rounded-full shadow-xl border border-slate-700 font-medium text-sm z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
            {toast}
          </div>
        )}

        {/* Search Section */}
        <div className="bg-slate-900 rounded-2xl p-4 md:p-6 shadow-xl border border-slate-800 mb-8">
          <form onSubmit={handleSearch} className="flex flex-col gap-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-slate-500" />
              </div>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Cole o link do álbum aqui (ex: https://bunkr.ru/a/...)"
                className="block w-full pl-11 pr-4 py-4 bg-slate-950 border border-slate-700 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-base md:text-lg"
                required
                disabled={isLoading || isProcessingBatch}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || isProcessingBatch || !url}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl font-semibold text-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20 active:scale-[0.98]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search className="w-6 h-6" />
                  Buscar Arquivos
                </>
              )}
            </button>
          </form>

          {/* Status Messages */}
          {error && (
            <div className="mt-4 p-4 bg-red-900/20 border border-red-900/50 rounded-xl flex items-start gap-3 text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}
          
          {status && !error && (
            <div className="mt-4 text-center text-slate-400 font-medium animate-pulse">
              {status}
            </div>
          )}

          {/* Global Progress */}
          {globalProgress > 0 && (
            <div className="mt-4">
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-300 ease-out"
                  style={{ width: `${globalProgress}%` }}
                />
              </div>
              <p className="text-right text-xs text-slate-500 mt-1">{globalProgress}%</p>
            </div>
          )}
        </div>

        {/* Actions Bar */}
        {files.length > 0 && (
          <div className="flex flex-col gap-4 mb-6 bg-slate-900 p-4 rounded-2xl border border-slate-800 sticky top-[88px] z-10 backdrop-blur-md bg-slate-900/80">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-slate-300 font-medium">
                <span className="text-blue-400 font-bold text-lg">{filteredFiles.length}</span> arquivos
              </div>
              
              {/* Filter Controls */}
              <div className="flex bg-slate-950 rounded-lg p-1 border border-slate-800">
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filterType === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setFilterType('video')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${filterType === 'video' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  <FileVideo className="w-4 h-4" /> Vídeos
                </button>
                <button
                  onClick={() => setFilterType('image')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${filterType === 'image' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  <FileImage className="w-4 h-4" /> Imagens
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 w-full">
              <button
                onClick={handleDownloadAll}
                disabled={isProcessingBatch || filteredFiles.length === 0}
                className="flex-1 sm:flex-none px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Baixar Visíveis
              </button>
              <button
                onClick={handleGenerateZip}
                disabled={isProcessingBatch || filteredFiles.length === 0}
                className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2"
              >
                <Archive className="w-4 h-4" />
                ZIP Visíveis
              </button>
              <button
                onClick={clearList}
                disabled={isProcessingBatch}
                className="px-4 py-2.5 bg-slate-800 hover:bg-red-900/50 hover:text-red-400 disabled:opacity-50 text-slate-300 rounded-lg font-medium transition-all flex items-center justify-center"
                title="Limpar lista"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Files Grid */}
        {filteredFiles.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredFiles.map((file) => (
              <div 
                key={file.id} 
                className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 hover:border-slate-700 transition-all group flex flex-col"
              >
                {/* Preview Area */}
                <div className="aspect-video bg-slate-950 relative flex items-center justify-center overflow-hidden border-b border-slate-800">
                  {file.type === 'image' ? (
                    <img 
                      src={file.url} 
                      alt={file.name} 
                      className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="relative w-full h-full flex items-center justify-center bg-slate-900">
                      <PlayCircle className="w-12 h-12 text-slate-600" />
                      {/* We could try to load a video thumbnail, but it might be heavy. Keeping it simple. */}
                    </div>
                  )}
                  
                  {/* Type Badge */}
                  <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-md text-xs font-medium flex items-center gap-1 text-slate-200">
                    {file.type === 'video' ? <FileVideo className="w-3 h-3" /> : <FileImage className="w-3 h-3" />}
                    {file.extension.toUpperCase().replace('.', '')}
                  </div>
                </div>

                {/* Info & Actions */}
                <div className="p-4 flex flex-col flex-1">
                  <h3 className="text-sm font-medium text-slate-200 truncate mb-3" title={file.name}>
                    {file.name}
                  </h3>
                  
                  <div className="mt-auto space-y-3">
                    {/* Progress Bar for individual file */}
                    {(file.status === 'downloading' || file.progress > 0) && (
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-300 ${file.status === 'error' ? 'bg-red-500' : file.status === 'success' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                          style={{ width: `${file.progress}%` }}
                        />
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownloadSingle(file)}
                        disabled={file.status === 'downloading' || file.status === 'success' || isProcessingBatch}
                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all
                          ${file.status === 'success' 
                            ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-900/50' 
                            : file.status === 'error'
                            ? 'bg-red-900/30 text-red-400 border border-red-900/50'
                            : 'bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-900/50'
                          } disabled:opacity-50`}
                      >
                        {file.status === 'downloading' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : file.status === 'success' ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        {file.status === 'success' ? 'Baixado' : 'Baixar'}
                      </button>
                      
                      <button
                        onClick={() => copyToClipboard(file.url)}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
                        title="Copiar link"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
                        title="Abrir em nova aba"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : files.length > 0 ? (
          <div className="text-center py-12 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed">
            <p className="text-slate-400">Nenhum arquivo encontrado para este filtro.</p>
          </div>
        ) : null}
      </main>
    </div>
  );
}

