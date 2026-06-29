import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Download, Upload, FileText, Trash2, Wand2, Plus, CheckCircle2, Circle, FolderDown, FileUp, FileDown, Code, Eye, ListTree, GitCompare, BarChart3, Sun, Moon } from 'lucide-react';
import { useFeatureFlag, fetchRemoteFlags } from './featureFlags.js';
import { initEmbedApi } from './embedApi.js';
import { splitMdBlocks, joinMdBlocks, parseBlockToHtml, formatMarkdown } from './lib/markdown.js';
import { injectMarksToMd } from './lib/marks.js';
import { safeDownload, createZip, safeDownloadBlob } from './lib/download.js';
import { InlineBlock } from './components/Block.jsx';
import { MarkPopup } from './components/MarkPopup.jsx';
import { AddFileModal } from './components/AddFileModal.jsx';
import { FloatingToc, extractTocEntries } from './components/FloatingToc.jsx';
import { DiffViewer, SourceEditor } from './components/DiffViewer.jsx';
import { DashboardOverview, useDashboardStats } from './components/Dashboard.jsx';


/* ===== THEME HELPERS ===== */
function getInitialTheme() {
  try {
    const saved = localStorage.getItem('md-reviewer-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* localStorage unavailable */ }
  return 'light';
}

/* ===== LOCAL STORAGE PERSISTENCE ===== */
const FILES_STORAGE_KEY = 'md-reviewer-files';
const FILES_MAX_BYTES = 4 * 1024 * 1024; // 4MB — skip saving above this to avoid QuotaExceeded

/** Restore files array from localStorage. Returns [] on any failure. */
function restoreFilesFromStorage() {
  try {
    const raw = localStorage.getItem(FILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const uid = () => crypto.randomUUID?.() || ('f-' + Math.random().toString(36).slice(2, 10));
    return parsed.map(f => ({
      id: uid(),
      name: f.name,
      content: f.content || '',
      originalContent: f.originalContent || f.content || '',
      marks: f.marks || [],
      status: f.status || 'pending',
      updatedAt: f.updatedAt || new Date().toISOString(),
    }));
  } catch { /* corrupt or unavailable */ return []; }
}

/* ===== MAIN ===== */
export default function MdReviewer() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [files, setFiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [popup, setPopup] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingBlock, setEditingBlock] = useState(null);
  const [viewMode, setViewMode] = useState('preview');
  const [showDashboard, setShowDashboard] = useState(false);
  const [mermaidReady, setMermaidReady] = useState(false);
  const [mermaidThemeVer, setMermaidThemeVer] = useState(0);
  const [showToc, setShowToc] = useState(false);
  const [tocWidth, setTocWidth] = useState(220);
  const tocDragRef = useRef(null);
  const importRef = useRef(null);

  // Feature Flags
  const flagDarkMode = useFeatureFlag('dark-mode');
  const flagDashboard = useFeatureFlag('dashboard');
  const flagEmbedApi = useFeatureFlag('embed-api');

  // Fetch remote flags once on mount
  useEffect(() => { fetchRemoteFlags(); }, []);

  // === Shared file import helper ===
  const importFiles = useCallback((incomingFiles) => {
    const uid = () => crypto.randomUUID?.() || ('f-' + Math.random().toString(36).slice(2, 10));
    const now = new Date().toISOString();
    const imp = incomingFiles.map(f => ({
      id: uid(),
      name: f.name,
      content: f.content,
      originalContent: f.originalContent || f.content,
      marks: [],
      status: 'pending',
      updatedAt: now,
    }));
    setFiles(imp);
    setActiveId(imp[0]?.id || null);
  }, []);

  // === P0: window.mdReviewer global API (works for same-origin iframe, no flag needed) ===
  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);

  // === localStorage 自動保存：掛載時還原（非 embed 模式且目前無檔案才還原）===
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isEmbed = params.get('mode') === 'embed' || params.get('mode') === 'readonly';
    if (isEmbed) return;
    if (filesRef.current.length > 0) return;
    const restored = restoreFilesFromStorage();
    if (restored.length > 0) {
      setFiles(restored);
      setActiveId(restored[0]?.id || null);
    }
  }, []);

  // === localStorage 自動保存：files 變動時 debounce 寫回（>4MB 略過避免 QuotaExceeded）===
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const payload = JSON.stringify(files.map(f => ({
          name: f.name,
          content: f.content,
          originalContent: f.originalContent,
          marks: f.marks,
          status: f.status,
          updatedAt: f.updatedAt,
        })));
        if (payload.length > FILES_MAX_BYTES) {
          console.warn('[md-reviewer] 檔案內容超過 4MB，略過 localStorage 儲存以避免 QuotaExceeded');
          return;
        }
        localStorage.setItem(FILES_STORAGE_KEY, payload);
      } catch (err) {
        console.warn('[md-reviewer] localStorage 儲存失敗', err);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [files]);
  useEffect(() => {
    window.mdReviewer = {
      loadFiles: (files) => importFiles(files),
      getState: () => ({
        files: filesRef.current.map(f => ({
          name: f.name, content: f.content,
          originalContent: f.originalContent,
          status: f.status, marks: f.marks,
        })),
      }),
      setTheme: (t) => { if (t === 'dark' || t === 'light') setTheme(t); },
      version: '1.1.0',
    };
    return () => { delete window.mdReviewer; };
  }, [importFiles]);

  // === P1: URL param support (?theme=dark&mode=embed) ===
  const [embedMode, setEmbedMode] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('theme') === 'dark') setTheme('dark');
    if (params.get('mode') === 'embed' || params.get('mode') === 'readonly') setEmbedMode(true);
  }, []);

  // === Embed API: postMessage listener for cross-origin iframe ===
  useEffect(() => {
    if (!flagEmbedApi) return;
    if (window.parent === window) return; // standalone mode
    const cleanup = initEmbedApi({
      instanceId: 'md-reviewer-' + Date.now(),
      onSetFiles: importFiles,
      onGetState: () => ({
        files: filesRef.current.map(f => ({
          name: f.name, content: f.content,
          originalContent: f.originalContent,
          status: f.status, marks: f.marks,
        })),
      }),
    });
    return cleanup;
  }, [flagEmbedApi, importFiles]);

  // When dark-mode flag is OFF, force light theme (prevent localStorage leak from canary)
  useEffect(() => {
    if (!flagDarkMode && theme !== 'light') setTheme('light');
  }, [flagDarkMode]);

  // Sync theme to <html> element and localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (flagDarkMode) {
      try { localStorage.setItem('md-reviewer-theme', theme); } catch { /* ignore */ }
    }
  }, [theme, flagDarkMode]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  }, []);

  // Mermaid config — adapt theme to app theme
  const mmConfig = useMemo(() => {
    const shared = { startOnLoad: false, suppressErrorRendering: true, flowchart: { curve: 'basis', padding: 12 }, sequence: { actorMargin: 30, mirrorActors: false } };
    const font = { fontFamily: '"Noto Sans TC", system-ui, sans-serif', fontSize: '13px' };
    if (theme === 'dark') return { ...shared, theme: 'dark', themeVariables: { ...font, primaryColor: '#374151', primaryTextColor: '#e5e7eb', primaryBorderColor: '#60a5fa', lineColor: '#9ca3af', secondaryColor: '#1f2937', tertiaryColor: '#4b5563' } };
    return { ...shared, theme: 'neutral', themeVariables: { ...font, primaryColor: '#dbeafe', primaryTextColor: '#1e3a5f', primaryBorderColor: '#3b82f6', lineColor: '#64748b', secondaryColor: '#f0fdf4', tertiaryColor: '#fef3c7' } };
  }, [theme]);

  // Load Mermaid.js from CDN
  useEffect(() => {
    if (window.mermaid) {
      window.mermaid.initialize(mmConfig);
      setMermaidReady(true);
      setMermaidThemeVer(v => v + 1);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js';
    script.onload = () => {
      window.mermaid.initialize(mmConfig);
      setMermaidReady(true);
    };
    document.head.appendChild(script);
  }, [mmConfig]);

  const activeFile = files.find(f => f.id === activeId);
  const { allStats: dashStats, computing: dashComputing } = useDashboardStats(files, flagDashboard && showDashboard);
  const sortedFiles = useMemo(() => [...files.filter(f => f.status === 'pending'), ...files.filter(f => f.status === 'done')], [files]);
  const doneCount = files.filter(f => f.status === 'done').length;
  const blocks = useMemo(() => activeFile ? splitMdBlocks(activeFile.content) : [], [activeFile?.content]);
  const blockHtmls = useMemo(() => blocks.map(b => parseBlockToHtml(b)), [blocks]);
  const tocEntries = useMemo(() => extractTocEntries(blocks), [blocks]);

  const addFile = useCallback((name, content) => {
    const id = 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    setFiles(prev => [...prev, { id, name, content, originalContent: content, marks: [], status: 'pending', updatedAt: new Date().toISOString() }]);
    setActiveId(id); setShowAdd(false);
  }, []);
  const batchAddFile = useCallback((newFilesList) => {
    const newEntries = newFilesList.map(f => ({
      id: 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      name: f.name,
      content: f.content,
      originalContent: f.content,
      marks: [],
      status: 'pending',
      updatedAt: new Date().toISOString()
    }));
    setFiles(prev => [...prev, ...newEntries]);
    if (newEntries.length > 0) setActiveId(prev => prev || newEntries[0].id);
  }, []);
  const updateFile = useCallback((id, updates) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates, updatedAt: new Date().toISOString() } : f));
  }, []);

  // History Management (Undo/Redo)
  const pushHistory = useCallback((fileId, currentContent) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== fileId) return f;
      const lastHistory = f.history?.[f.history.length - 1];
      if (lastHistory === currentContent) return f; // skip duplicate
      const newHistory = [...(f.history || []), currentContent].slice(-5);
      return { ...f, history: newHistory, future: [] };
    }));
  }, []);

  const undo = useCallback(() => {
    if (!activeFile || !activeFile.history || activeFile.history.length === 0) return;
    const previousContent = activeFile.history[activeFile.history.length - 1];
    const newHistory = activeFile.history.slice(0, -1);
    setFiles(prev => prev.map(f => f.id === activeFile.id ? {
      ...f,
      content: previousContent,
      history: newHistory,
      future: [activeFile.content, ...(f.future || [])].slice(-5)
    } : f));
  }, [activeFile]);

  const redo = useCallback(() => {
    if (!activeFile || !activeFile.future || activeFile.future.length === 0) return;
    const nextContent = activeFile.future[0];
    const newFuture = activeFile.future.slice(1);
    setFiles(prev => prev.map(f => f.id === activeFile.id ? {
      ...f,
      content: nextContent,
      history: [...(f.history || []), activeFile.content].slice(-5),
      future: newFuture
    } : f));
  }, [activeFile]);

  // Cmd+Z / Cmd+Shift+Z keyboard shortcuts for undo/redo (ref pattern: register once)
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  useEffect(() => { undoRef.current = undo; }, [undo]);
  useEffect(() => { redoRef.current = redo; }, [redo]);
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) { redoRef.current(); } else { undoRef.current(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const toggleDone = useCallback((id) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: f.status === 'done' ? 'pending' : 'done', updatedAt: new Date().toISOString() } : f));
  }, []);
  const removeFile = useCallback((id) => { setFiles(prev => prev.filter(f => f.id !== id)); if (activeId === id) setActiveId(null); }, [activeId]);

  const onStartEdit = useCallback((blockId) => { if (popup) return; setEditingBlock(blockId); }, [popup]);
  const onFinishEdit = useCallback((blockId, newText) => {
    if (!activeFile) return;
    const idx = parseInt(blockId.replace('block-', ''));
    const cur = splitMdBlocks(activeFile.content);
    if (idx >= 0 && idx < cur.length && cur[idx] !== newText) {
      pushHistory(activeFile.id, activeFile.content);
      cur[idx] = newText; updateFile(activeFile.id, { content: joinMdBlocks(cur) });
    }
    setEditingBlock(null);
  }, [activeFile, updateFile, pushHistory]);

  const onBlockMark = useCallback((blockId, e) => {
    if (!activeFile) return;
    setPopup({ blockId, position: { x: e.clientX, y: e.clientY }, mark: activeFile.marks.find(m => m.blockId === blockId) });
    setEditingBlock(null);
  }, [activeFile]);

  const onBlockAction = useCallback((blockId, blockIdx, action) => {
    if (!activeFile) return;
    const cur = splitMdBlocks(activeFile.content);
    const idx = blockIdx;
    if (idx < 0 || idx >= cur.length) return;

    const stripPrefix = (t) => t.replace(/^#{1,6}\s+/, '').replace(/^- /, '').replace(/^> /, '').replace(/^\*\*(.+)\*\*$/, '$1').trim();

    // Push history for all actions except copy
    if (action !== 'copy') {
      pushHistory(activeFile.id, activeFile.content);
    }

    switch (action) {
      case 'addAbove': {
        cur.splice(idx, 0, '<!-- spacer -->');
        updateFile(activeFile.id, { content: joinMdBlocks(cur) });
        setTimeout(() => {
          const el = document.getElementById('block-' + idx);
          if (el) { el.classList.add('block-flash'); setTimeout(() => el.classList.remove('block-flash'), 1800); }
        }, 60);
        break;
      }
      case 'addBelow': {
        cur.splice(idx + 1, 0, '<!-- spacer -->');
        updateFile(activeFile.id, { content: joinMdBlocks(cur) });
        setTimeout(() => {
          const el = document.getElementById('block-' + (idx + 1));
          if (el) { el.classList.add('block-flash'); setTimeout(() => el.classList.remove('block-flash'), 1800); }
        }, 60);
        break;
      }
      case 'delete': {
        cur.splice(idx, 1);
        // Also remove marks for this block
        const newMarks = activeFile.marks.filter(m => m.blockId !== blockId);
        updateFile(activeFile.id, { content: joinMdBlocks(cur), marks: newMarks });
        break;
      }
      case 'copy': {
        try { navigator.clipboard.writeText(cur[idx]); } catch {}
        break;
      }
      case 'moveUp': {
        if (idx > 0) { [cur[idx - 1], cur[idx]] = [cur[idx], cur[idx - 1]]; updateFile(activeFile.id, { content: joinMdBlocks(cur) }); }
        break;
      }
      case 'moveDown': {
        if (idx < cur.length - 1) { [cur[idx], cur[idx + 1]] = [cur[idx + 1], cur[idx]]; updateFile(activeFile.id, { content: joinMdBlocks(cur) }); }
        break;
      }
      case 'toH1': { cur[idx] = '# ' + stripPrefix(cur[idx]); updateFile(activeFile.id, { content: joinMdBlocks(cur) }); break; }
      case 'toH2': { cur[idx] = '## ' + stripPrefix(cur[idx]); updateFile(activeFile.id, { content: joinMdBlocks(cur) }); break; }
      case 'toH3': { cur[idx] = '### ' + stripPrefix(cur[idx]); updateFile(activeFile.id, { content: joinMdBlocks(cur) }); break; }
      case 'toH4': { cur[idx] = '#### ' + stripPrefix(cur[idx]); updateFile(activeFile.id, { content: joinMdBlocks(cur) }); break; }
      case 'toH5': { cur[idx] = '##### ' + stripPrefix(cur[idx]); updateFile(activeFile.id, { content: joinMdBlocks(cur) }); break; }
      case 'toList': {
        const lines = cur[idx].split('\n').map(l => '- ' + stripPrefix(l));
        cur[idx] = lines.join('\n');
        updateFile(activeFile.id, { content: joinMdBlocks(cur) }); break;
      }
      case 'toQuote': {
        const lines = cur[idx].split('\n').map(l => '> ' + stripPrefix(l));
        cur[idx] = lines.join('\n');
        updateFile(activeFile.id, { content: joinMdBlocks(cur) }); break;
      }
      case 'toPlain': { cur[idx] = stripPrefix(cur[idx]); updateFile(activeFile.id, { content: joinMdBlocks(cur) }); break; }
      default: break;
    }
  }, [activeFile, updateFile, pushHistory]);

  const saveMark = useCallback((issue) => {
    if (!popup || !activeFile) return;
    const ms = [...activeFile.marks]; const idx = ms.findIndex(m => m.blockId === popup.blockId);
    if (idx >= 0) ms[idx] = { ...ms[idx], issue }; else ms.push({ blockId: popup.blockId, issue });
    updateFile(activeFile.id, { marks: ms }); setPopup(null);
  }, [popup, activeFile, updateFile]);
  const deleteMark = useCallback(() => {
    if (!popup || !activeFile) return;
    updateFile(activeFile.id, { marks: activeFile.marks.filter(m => m.blockId !== popup.blockId) }); setPopup(null);
  }, [popup, activeFile, updateFile]);

  const doFormat = () => { if (activeFile) { /* pushHistory(activeFile.id, activeFile.content); */ updateFile(activeFile.id, { content: formatMarkdown(activeFile.content) }); } };
  const doExport = () => {
    const state = { version: 1, exportedAt: new Date().toISOString(), files: files.map(f => ({ name: f.name, content: f.content, originalContent: f.originalContent, marks: f.marks, status: f.status })) };
    safeDownload(JSON.stringify(state, null, 2), '審核狀態_' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
  };
  const doImport = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { try { const s = JSON.parse(ev.target.result); if (s.files) { const imp = s.files.map((f, i) => ({ id: 'f-' + Date.now() + '-' + i, name: f.name, content: f.content, originalContent: f.originalContent || f.content, marks: (f.marks || []).map(m => m.cellId && !m.blockId ? { ...m, blockId: m.cellId } : m), status: f.status || 'pending', updatedAt: new Date().toISOString() })); setFiles(imp); setActiveId(imp[0]?.id || null); } } catch { alert('JSON 格式錯誤'); } };
    reader.readAsText(file); e.target.value = '';
  };
  const [downloadModal, setDownloadModal] = useState(null); // { file, type: 'md'|'zip' }

  // Drag and drop handlers
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    try {
      const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.md'));
      if (droppedFiles.length === 0) return;
      
      // Process dropped files
      let processed = 0;
      const newFiles = [];
      droppedFiles.forEach(file => {
        const reader = new FileReader();
        reader.onerror = () => {
          console.error('Error reading file:', file.name);
          processed++;
          if (processed === droppedFiles.length && newFiles.length > 0) {
            batchAddFile(newFiles);
          }
        };
        reader.onload = (ev) => {
          try {
            // Sanitize content: remove BOM and null characters
            let content = ev.target.result || '';
            if (content.charCodeAt(0) === 0xFEFF) {
              content = content.slice(1); // Remove UTF-8 BOM
            }
            content = content.replace(/\0/g, ''); // Remove null characters
            
            newFiles.push({ name: file.name, content });
            processed++;
            if (processed === droppedFiles.length) {
              batchAddFile(newFiles);
            }
          } catch (err) {
            console.error('Error processing file content:', file.name, err);
            processed++;
            if (processed === droppedFiles.length && newFiles.length > 0) {
              batchAddFile(newFiles);
            }
          }
        };
        reader.readAsText(file, 'UTF-8');
      });
    } catch (err) {
      console.error('Error in handleDrop:', err);
    }
  };

  const downloadFile = (f) => {
    // Show modal to allow filename editing before download
    setDownloadModal({ file: f, name: f.name, type: 'md' });
  };
  
  const confirmDownload = (name) => {
    if (!downloadModal) return;
    
    if (downloadModal.type === 'md') {
      const f = downloadModal.file;
      safeDownload(injectMarksToMd(f.content, f.marks), name, 'text/markdown;charset=utf-8');
    } else if (downloadModal.type === 'zip') {
      // Zip download logic moved here if needed, or keep separate
    }
    setDownloadModal(null);
  };

  const downloadZip = () => {
    const done = files.filter(f => f.status === 'done');
    if (!done.length) { alert('請先將檔案標記為「已完成」再下載 ZIP'); return; }
    safeDownloadBlob(createZip(done.map(f => ({ name: f.name, content: injectMarksToMd(f.content, f.marks) }))), '已審核_' + new Date().toISOString().slice(0, 10) + '.zip');
  };


  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Noto+Sans+TC:wght@400;500;600;700&display=swap');
    html,body,#root{height:100%;height:100dvh;margin:0;padding:0;overflow:hidden}
    /* CSS variables defined in index.css */
    *{box-sizing:border-box}

    .pv{line-height:1.8;color:var(--text);font-size:14.5px;font-family:var(--font);min-width:0;overflow-wrap:break-word}
    .pv h1{font-size:1.6em;font-weight:700;margin:6px 0;padding-bottom:8px;border-bottom:2px solid var(--border);letter-spacing:-.01em}
    .pv h2{font-size:1.3em;font-weight:600;margin:5px 0;color:var(--text)}
    .pv h3{font-size:1.1em;font-weight:600;margin:4px 0;color:var(--text2)}
    .pv h4{font-size:1em;font-weight:600;margin:3px 0;color:var(--text2)}
    .pv h5{font-size:.92em;font-weight:600;margin:3px 0;color:var(--text3);text-transform:uppercase;letter-spacing:.02em}
    .pv p{margin:3px 0} .pv hr{border:none;border-top:1.5px solid var(--border);margin:12px 0}
    .pv ul,.pv ol{margin:2px 0 2px 8px;padding-left:18px}
    .pv ul{list-style-type:disc}
    .pv ol{list-style-type:decimal}
    .pv li{margin:1px 0;padding-left:2px;line-height:1.7}
    .pv ul ul,.pv ol ul{list-style-type:circle}
    .pv ul ul ul,.pv ol ul ul,.pv ol ol ul{list-style-type:square}
    .pv li .cd{font-size:.82em}
    .pv .cd{background:#f1f3f5;padding:2px 6px;border-radius:4px;font-family:var(--mono);font-size:.85em;color:#e11d48;border:1px solid #e9ecef}
    .pv .img-ph{background:var(--surface2);padding:16px;text-align:center;color:var(--text3);border:1.5px dashed var(--border);margin:8px 0;border-radius:var(--radius)}
    .pv del{color:var(--text3);text-decoration:line-through}
    .pv .md-link{color:var(--accent);text-decoration:underline;text-underline-offset:3px;text-decoration-color:#93c5fd}
    .pv .md-link:hover{color:#1d4ed8;text-decoration-color:var(--accent)}
    .pv .bq{border-left:3px solid var(--accent2);padding:8px 16px;margin:8px 0;background:var(--accent-bg);color:#1e40af;border-radius:0 var(--radius-sm) var(--radius-sm) 0;font-style:italic}
    .pv .md-table{width:100%;border-collapse:collapse;margin:4px 0;font-size:13px}
    .pv .md-table th,.pv .md-table td{border:1px solid var(--border2);padding:8px 10px;text-align:left;word-break:break-word}
    .pv .md-table th{background:var(--surface2);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--text2)}
    .pv table{width:100%;border-collapse:collapse;margin:6px 0;font-size:13px;border:1px solid var(--border2);table-layout:auto}
    .pv table th,.pv table td{border:1px solid var(--border2);padding:8px 10px;text-align:left;vertical-align:top;word-break:break-word}
    .pv table th{background:var(--surface2);font-weight:600;color:var(--text2)}
    .pv table tr:nth-child(even){background:var(--surface2)}
    .pv table strong{font-weight:600;color:var(--text)}
    .table-scroll-wrap{position:relative;margin:6px 0;border-radius:var(--radius-sm);width:100%;max-width:100%;overflow:hidden}
    .table-scroll-inner{overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch;scrollbar-width:none;width:100%}
    .table-scroll-inner::-webkit-scrollbar{display:none}
    .table-scroll-wrap::before,.table-scroll-wrap::after{content:'';position:absolute;top:0;bottom:28px;width:28px;pointer-events:none;z-index:2;opacity:0;transition:opacity .25s}
    .table-scroll-wrap::before{left:0;background:linear-gradient(90deg,var(--surface) 30%,transparent)}
    .table-scroll-wrap::after{right:0;background:linear-gradient(-90deg,var(--surface) 30%,transparent)}
    .table-scroll-wrap.shadow-left::before{opacity:1}
    .table-scroll-wrap.shadow-right::after{opacity:1}
    .tscroll-bar-wrap{padding:8px 0 2px;display:none}
    .tscroll-track{position:relative;height:12px;background:var(--surface2);border-radius:6px;cursor:pointer;border:1px solid var(--border);transition:background .15s}
    .tscroll-track:hover{background:#e2e6eb}
    .tscroll-thumb{position:absolute;top:2px;left:0;height:8px;min-width:36px;background:linear-gradient(90deg,#93c5fd,#60a5fa);border-radius:4px;cursor:grab;transition:background .15s,box-shadow .15s;will-change:transform}
    .tscroll-thumb:hover{background:linear-gradient(90deg,#60a5fa,#3b82f6);box-shadow:0 0 0 3px rgba(59,130,246,.18)}
    .tscroll-thumb.tscroll-active{background:linear-gradient(90deg,#3b82f6,#2563eb);cursor:grabbing;box-shadow:0 0 0 4px rgba(59,130,246,.25)}
    .code-block{border-radius:var(--radius);overflow:hidden;margin:8px 0;border:1px solid #2e3440;background:#0d1117;box-shadow:0 4px 16px rgba(0,0,0,.2);max-width:100%}
    .code-header{padding:8px 14px;background:#161b22;color:#7d8590;font-size:11px;font-family:var(--mono);border-bottom:1px solid #21262d;display:flex;align-items:center;justify-content:space-between;gap:8px}
    .code-header::before{content:'';display:inline-flex;gap:5px;width:42px;height:10px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='42' height='10'%3E%3Ccircle cx='5' cy='5' r='4' fill='%23ff5f57'/%3E%3Ccircle cx='21' cy='5' r='4' fill='%23febc2e'/%3E%3Ccircle cx='37' cy='5' r='4' fill='%2328c840'/%3E%3C/svg%3E") no-repeat;flex-shrink:0}
    .code-lang{background:#1f6feb22;color:#58a6ff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
    .code-copy{padding:3px 10px;border-radius:4px;font-size:10px;cursor:pointer;color:#7d8590;border:1px solid #30363d;background:#21262d;transition:all .15s;user-select:none}
    .code-copy:hover{color:#e6edf3;background:#30363d;border-color:#484f58}
    .code-content{display:flex;overflow-x:auto}
    .code-lines{padding:14px 0;margin:0;text-align:right;color:#484f58;font-size:12px;line-height:1.75;font-family:var(--mono);min-width:38px;padding-right:12px;padding-left:14px;border-right:1px solid #21262d;user-select:none;flex-shrink:0}
    .code-body{padding:14px 18px;margin:0;font-size:12.5px;line-height:1.75;color:#e6edf3;font-family:var(--mono);overflow-x:auto;white-space:pre;flex:1}
    .hl-kw{color:#ff7b72;font-weight:500} .hl-str{color:#a5d6ff} .hl-cmt{color:#8b949e;font-style:italic} .hl-num{color:#79c0ff} .hl-fn{color:#d2a8ff} .hl-bi{color:#ffa657} .hl-cls{color:#7ee787} .hl-deco{color:#ffa657;font-style:italic} .hl-op{color:#ff7b72}

    .mermaid-block{border-radius:var(--radius);overflow:hidden;margin:8px 0;border:1px solid color-mix(in srgb, var(--violet) 28%, transparent);background:linear-gradient(135deg,color-mix(in srgb, var(--violet) 10%, var(--surface)) 0%,var(--surface) 100%);box-shadow:0 4px 16px rgba(124,58,237,.08)}
    .mermaid-header{padding:8px 14px;background:linear-gradient(90deg,color-mix(in srgb, var(--violet) 10%, transparent),transparent);border-bottom:1px solid color-mix(in srgb, var(--violet) 18%, var(--border));display:flex;align-items:center;justify-content:space-between}
    .mermaid-badge{font-size:11px;font-weight:700;color:var(--violet);letter-spacing:.02em;font-family:var(--font)}
    .mermaid-hint{font-size:10px;color:var(--text3);font-family:var(--font)}
    .mermaid-body{padding:20px;min-height:60px;display:flex;align-items:center;justify-content:center;background:var(--surface);margin:8px;border-radius:8px;border:1px solid var(--border);overflow:auto}
    .mermaid-body pre.mermaid-src{font-size:12px;color:var(--text2);font-family:var(--mono);white-space:pre-wrap;text-align:center}
    .mermaid-body.mermaid-rendered{padding:16px}
    .mermaid-svg-wrap{width:100%;display:flex;align-items:center;justify-content:center}
    .mermaid-svg-wrap svg{max-width:100%;height:auto;display:block}
    .mermaid-body.mermaid-error{flex-direction:column;gap:6px;padding:20px;background:var(--danger-bg);border-color:var(--danger)}
    .mm-err-icon{font-size:28px;line-height:1;opacity:.7}
    .mm-err-title{font-size:13px;font-weight:700;color:var(--danger);font-family:var(--font)}
    .mm-err-msg{font-size:11px;color:var(--danger);font-family:var(--mono);background:var(--danger-bg);padding:6px 10px;border-radius:6px;max-width:100%;overflow-x:auto;white-space:pre-wrap;word-break:break-all;border:1px solid var(--danger);line-height:1.5}
    .mm-err-hint{font-size:10.5px;color:#9ca3af;font-family:var(--font);font-style:italic}

    .preview-block{position:relative;padding:8px 12px;margin:2px 0;border-radius:var(--radius-sm);border:1.5px solid transparent;cursor:text;transition:all .15s ease;min-width:0;overflow:hidden;word-break:break-word}
    .preview-block:hover{background:var(--surface2);border-color:var(--border)}
    .preview-block.marked{border-left:3px solid var(--danger);background:var(--danger-bg)}
    .mark-badge{position:absolute;top:4px;right:4px;display:flex;align-items:center;gap:3px;padding:2px 8px;background:var(--danger);color:white;border-radius:12px;font-size:11px;font-weight:500;cursor:pointer;box-shadow:var(--shadow)}
    .edit-block{padding:4px 0}
    .edit-block textarea{width:100%;padding:12px;border:1.5px solid var(--accent-border);border-radius:var(--radius-sm);resize:none;outline:none;font-family:var(--mono);font-size:13px;line-height:1.75;background:var(--accent-bg);box-shadow:0 0 0 3px rgba(37,99,235,.08);transition:border .15s}
    .edit-block textarea:focus{border-color:var(--accent)}

    .doc-canvas{background:var(--surface);border-radius:var(--radius);border:1px solid var(--border);padding:24px clamp(16px,3%,32px);box-shadow:var(--shadow);overflow:visible;max-width:100%;box-sizing:border-box;width:100%}

    .si{transition:all .12s ease;border-radius:var(--radius-sm)} .si:hover{background:var(--surface2)} .si.act{background:var(--accent-bg);border-left:3px solid var(--accent)}
    .tbtn{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:var(--radius-sm);font-size:11.5px;font-weight:500;cursor:pointer;border:1px solid transparent;transition:all .15s ease;font-family:var(--font);white-space:nowrap;flex-shrink:0}
    .tbtn:hover:not(:disabled){transform:translateY(-1px);box-shadow:var(--shadow-lg)}
    .tbtn:active:not(:disabled){transform:translateY(0)}
    .tbtn:disabled{opacity:.3;cursor:not-allowed}
    .tbtn-violet{background:var(--violet-bg);color:var(--violet);border-color:#ddd6fe} .tbtn-violet:hover:not(:disabled){background:#ede9fe}
    .tbtn-gray{background:var(--surface2);color:var(--text2);border-color:var(--border)} .tbtn-gray:hover:not(:disabled){background:#e5e7eb}
    .tbtn-blue{background:var(--accent-bg);color:var(--accent);border-color:var(--accent-border)} .tbtn-blue:hover:not(:disabled){background:#dbeafe}
    .tbtn-green{background:var(--success);color:#fff;border-color:var(--success)} .tbtn-green:hover:not(:disabled){background:#059669}
    .source-gutter{overflow:hidden;padding:24px 0;background:#0d1117;border-right:1px solid #21262d;user-select:none;flex-shrink:0;min-width:48px}
    .source-gutter-line{font-family:var(--mono);font-size:13px;line-height:1.75;color:#484f58;text-align:right;padding:0 12px 0 12px}
    .source-editor{width:100%;height:100%;padding:24px 24px 24px 16px;font-family:var(--mono);font-size:13px;line-height:1.75;border:none;resize:none;outline:none;background:#0d1117;color:#e6edf3;min-height:0}
    .dash-container{padding:24px 32px;max-width:960px;margin:0 auto}
    .dash-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
    .dash-title{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:700;color:var(--text)}
    .dash-close{padding:6px;border-radius:6px;color:var(--text3);cursor:pointer;border:none;background:none;transition:all .15s} .dash-close:hover{background:var(--surface2);color:var(--text)}
    .dash-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
    .dash-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-top:3px solid var(--border);transition:box-shadow .15s} .dash-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .dash-card-value{font-size:22px;font-weight:700;line-height:1.2}
    .dash-card-label{font-size:11px;color:var(--text3);margin-top:4px;font-weight:500}
    .dash-card-sub{font-size:10px;margin-top:2px;font-weight:600}
    .dash-section-title{font-size:13px;font-weight:600;color:var(--text2);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)}
    .dash-ranking{display:flex;flex-direction:column;gap:2px}
    .dash-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;cursor:pointer;transition:background .12s} .dash-row:hover{background:var(--accent-bg)}
    .dash-row-rank{width:20px;text-align:center;font-size:11px;font-weight:700;color:var(--text3)}
    .dash-row-name{width:180px;font-size:12px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
    .dash-row-bar-wrap{flex:1;height:18px;background:var(--surface2);border-radius:4px;overflow:hidden;position:relative;min-width:80px}
    .dash-row-bar{height:100%;border-radius:4px;animation:dashBarIn .4s ease both}
    @keyframes dashBarIn{from{width:0!important}}
    .dash-row-pending{font-size:10px;color:var(--text3);line-height:18px;padding:0 8px}
    .dash-row-identical{font-size:10px;color:#10b981;line-height:18px;padding:0 8px;font-weight:500}
    .dash-row-pct{width:52px;text-align:right;font-size:12px;font-weight:700;font-family:var(--mono);flex-shrink:0}
    .dash-row-counts{display:flex;gap:6px;width:100px;font-size:11px;font-weight:600;font-family:var(--mono);flex-shrink:0}
    .dash-row-lines{width:48px;text-align:right;font-size:10px;color:var(--text3);flex-shrink:0}
    .dash-empty{text-align:center;padding:32px;color:var(--text3);font-size:13px}
    .dash-donut-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:16px;margin-bottom:16px}
    .dash-donut-cell{display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 8px;border-radius:12px;border:1px solid var(--border);background:var(--surface);cursor:pointer;transition:all .15s} .dash-donut-cell:hover{box-shadow:0 4px 12px rgba(0,0,0,.08);border-color:var(--accent-border);transform:translateY(-2px)}
    .dash-donut-wrap-sm{position:relative;width:100px;height:100px;flex-shrink:0}
    .dash-donut-svg{width:100%;height:100%}
    .dash-donut-seg{animation:dashDonutIn .6s ease both}
    @keyframes dashDonutIn{from{stroke-dasharray:0 239}}
    .dash-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
    .dash-donut-pct{font-size:15px;font-weight:700;line-height:1.2;font-family:var(--mono)}
    .dash-donut-fname{font-size:11px;font-weight:600;color:var(--text);max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
    .dash-donut-meta{display:flex;gap:6px;font-size:11px;font-weight:600;font-family:var(--mono)}
    .dash-donut-lines{font-size:10px;color:var(--text3)}
    .dash-legend-bar{display:flex;gap:16px;justify-content:center;margin-bottom:20px;padding:8px 0}
    .dash-legend-item{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)}
    .dash-legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .dash-row-stacked{display:flex;height:100%;border-radius:4px;overflow:hidden;animation:dashBarIn .4s ease both}
    .table-editor{border:2px solid var(--accent2);border-radius:var(--radius);overflow:hidden;background:var(--accent-bg);box-shadow:0 0 0 4px rgba(59,130,246,.08)}
    .te-scroll{overflow-x:auto;scrollbar-width:thin;scrollbar-color:var(--accent-border) var(--surface2);-webkit-overflow-scrolling:touch}
    .te-scroll::-webkit-scrollbar{height:7px}
    .te-scroll::-webkit-scrollbar-track{background:var(--surface2);border-radius:10px}
    .te-scroll::-webkit-scrollbar-thumb{background:linear-gradient(90deg,var(--accent-border),var(--border2));border-radius:10px}
    .te-scroll::-webkit-scrollbar-thumb:hover{background:linear-gradient(90deg,var(--accent2),var(--accent))}
    .table-editor table{width:100%;border-collapse:collapse;background:var(--surface);table-layout:auto}
    .table-editor th,.table-editor td{border:1px solid var(--border2);padding:0;text-align:left;vertical-align:top;font-size:12.5px;min-width:70px;position:relative}
    .table-editor th{background:var(--surface2);font-weight:600;font-size:12px}
    .te-row-ctrl{width:26px!important;min-width:26px!important;max-width:26px!important;padding:0!important;border:none!important;background:transparent!important;vertical-align:middle;text-align:center;position:relative}
    .te-add-row,.te-del-row{width:20px;height:20px;border:1.5px dashed var(--border2);border-radius:var(--radius-sm);background:var(--surface);color:var(--text3);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:all .15s;margin:1px auto}
    .table-editor tr:hover .te-add-row,.table-editor tr:hover .te-del-row{opacity:1}
    .te-add-row:hover{background:var(--accent-bg);color:var(--accent);border-color:var(--accent2);transform:scale(1.1)}
    .te-del-row{border-color:#fca5a5;color:#f87171;font-size:15px;font-weight:600}
    .te-del-row:hover{background:var(--danger-bg);color:#ef4444;border-color:#ef4444;transform:scale(1.1)}
    .te-col-btns{display:flex;padding:0 0 0 26px;gap:0}
    .te-col-btn-group{flex:1;display:flex;flex-direction:column;align-items:stretch;gap:0}
    .te-add-col{height:20px;border:none;border-bottom:1.5px dashed var(--accent-border);background:transparent;color:var(--text3);font-size:12px;cursor:pointer;opacity:0;transition:all .15s;width:100%}
    .te-add-col-last{flex:0 0 24px;width:24px}
    .te-del-col{height:18px;border:none;border-bottom:1.5px dashed #fca5a5;background:transparent;color:#f87171;font-size:14px;font-weight:600;cursor:pointer;opacity:0;transition:all .15s;width:100%}
    .te-col-btns:hover .te-add-col,.te-col-btns:hover .te-del-col{opacity:1}
    .te-add-col:hover{background:var(--accent-bg);color:var(--accent)}
    .te-del-col:hover{background:var(--danger-bg);color:#ef4444}
    .te-add-row-bottom{padding:0!important;border:none!important;background:transparent!important}
    .te-add-full{width:100%;padding:6px;border:1.5px dashed var(--border2);background:var(--surface);color:var(--text3);font-size:12px;cursor:pointer;border-radius:0 0 8px 8px;transition:all .15s;font-family:var(--font)}
    .te-add-full:hover{background:var(--accent-bg);color:var(--accent);border-color:var(--accent2)}
    .cell-normal{cursor:text;padding:7px 10px;min-height:34px;transition:background .1s}
    .cell-normal:hover{background:#e0f2fe}
    .cell-focus{padding:0;background:var(--surface);box-shadow:inset 0 0 0 2px var(--accent2)}
    .cell-input{width:100%;padding:7px 10px;border:none;outline:none;background:#fef9c3;font-size:12.5px;font-family:var(--font);box-sizing:border-box;min-height:34px;line-height:1.5;resize:vertical}
    .cell-text{display:block;min-height:1.4em}
    .table-editor-actions{display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;background:var(--accent-bg);border-top:1px solid var(--accent-border)}
    .te-btn{padding:5px 14px;border-radius:var(--radius-sm);font-size:11px;font-weight:500;cursor:pointer;border:1px solid transparent;display:inline-flex;align-items:center;gap:4px;font-family:var(--font);transition:all .15s}
    .te-cancel{background:var(--surface);color:var(--text2);border-color:var(--border)} .te-cancel:hover{background:var(--surface2)}
    .te-save{background:var(--accent);color:white;border-color:var(--accent)} .te-save:hover{background:#1d4ed8}
    .te-hint{font-size:10px;color:var(--text3);margin-right:auto;font-family:var(--font)}

    .tctx-menu{position:fixed;width:180px;background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-xl);border:1px solid var(--border);z-index:70;padding:6px;animation:hmIn .12s ease}
    .tctx-title{font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;padding:4px 10px 2px;font-family:var(--font)}
    .tctx-item{width:100%;display:flex;align-items:center;gap:8px;padding:7px 10px;border:none;background:none;cursor:pointer;border-radius:var(--radius-sm);font-size:12.5px;color:var(--text);text-align:left;font-family:var(--font);transition:background .1s}
    .tctx-item:hover{background:var(--surface2)}
    .tctx-item:disabled{opacity:.3;cursor:not-allowed}
    .tctx-ico{font-size:13px;width:18px;text-align:center}
    .tctx-danger{color:var(--danger)}
    .tctx-danger:hover{background:var(--danger-bg)}
    .tctx-divider{height:1px;background:var(--border);margin:4px 6px}

    .block-wrapper{position:relative;min-width:0}
    .block-flash .preview-block{animation:borderFlash 1.8s ease forwards;border-radius:var(--radius-sm)}
    @keyframes borderFlash{0%{box-shadow:0 0 0 2px #3b82f6,0 0 12px 2px #3b82f680}15%{box-shadow:0 0 0 2px #8b5cf6,0 0 16px 3px #8b5cf680}30%{box-shadow:0 0 0 2px #ec4899,0 0 16px 3px #ec489980}50%{box-shadow:0 0 0 2px #3b82f6,0 0 12px 2px #3b82f660}70%{box-shadow:0 0 0 1.5px #60a5fa,0 0 8px 1px #60a5fa40}100%{box-shadow:none}}
    .spacer-block{min-height:32px;border-radius:var(--radius-sm);border:1.5px dashed var(--border);background:var(--surface2);margin:4px 0;position:relative;transition:all .2s}
    .preview-block:hover .spacer-block{border-color:var(--accent-border);background:var(--accent-bg)}
    .block-grip{position:absolute;left:-26px;top:6px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-sm);color:var(--border2);cursor:grab;opacity:0;transition:all .15s}
    .block-grip:hover{background:var(--surface2);color:var(--text3)}
    .grip-show{opacity:1}

    .float-toolbar{position:fixed;display:flex;gap:2px;background:#1e1e2e;border-radius:var(--radius);padding:4px 6px;box-shadow:var(--shadow-xl);z-index:60;animation:ftIn .12s ease;border:1px solid #313244}
    @keyframes ftIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
    .ft-btn{width:32px;height:30px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:#a6adc8;border-radius:var(--radius-sm);cursor:pointer;transition:all .1s}
    .ft-btn:hover{background:#45475a;color:white}

    .slash-menu{position:fixed;width:260px;background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-xl);border:1px solid var(--border);z-index:60;overflow:hidden;animation:smIn .12s ease}
    @keyframes smIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
    .slash-header{padding:10px;border-bottom:1px solid var(--border)}
    .slash-search{width:100%;border:1px solid var(--border);outline:none;font-size:12.5px;padding:6px 10px;background:var(--surface2);border-radius:var(--radius-sm);font-family:var(--font);transition:border .15s}
    .slash-search:focus{border-color:var(--accent);background:var(--surface)}
    .slash-list{max-height:280px;overflow-y:auto;padding:4px}
    .slash-item{width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;border:none;background:none;cursor:pointer;border-radius:var(--radius-sm);text-align:left;transition:background .1s}
    .slash-item:hover{background:var(--accent-bg)}
    .slash-icon{width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:var(--surface2);border-radius:var(--radius-sm);color:var(--text2);flex-shrink:0;border:1px solid var(--border);transition:all .1s}
    .slash-item:hover .slash-icon{background:var(--accent-bg);color:var(--accent);border-color:var(--accent-border)}
    .slash-label{font-size:13px;font-weight:500;color:var(--text);font-family:var(--font)}
    .slash-desc{font-size:11px;color:var(--text3);font-family:var(--font)}
    .slash-empty{padding:24px;text-align:center;font-size:12px;color:var(--text3);font-family:var(--font)}
    .slash-back{display:flex;align-items:center;gap:4px;padding:4px 8px;margin-bottom:6px;border:none;background:var(--surface2);color:var(--text2);border-radius:var(--radius-sm);cursor:pointer;font-size:11px;font-family:var(--font);transition:background .1s}
    .slash-back:hover{background:var(--border)}
    .slash-arrow{color:var(--text3);font-size:11px;margin-left:auto}
    .slash-icon-lang{font-size:16px;line-height:1;background:var(--surface2);border:1px solid var(--border)}

    .handle-menu{position:fixed;width:180px;background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-xl);border:1px solid var(--border);z-index:60;padding:4px;animation:hmIn .1s ease}
    @keyframes hmIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
    .handle-item{width:100%;display:flex;align-items:center;gap:8px;padding:7px 10px;border:none;background:none;cursor:pointer;border-radius:var(--radius-sm);font-size:12.5px;font-family:var(--font);transition:background .1s}
    .handle-item:hover{background:var(--surface2)}

    .mm-editor{border:2px solid color-mix(in srgb, var(--violet) 50%, var(--border));border-radius:var(--radius);overflow:hidden;background:color-mix(in srgb, var(--violet) 6%, var(--surface));box-shadow:0 0 0 4px rgba(124,58,237,.08)}
    .mm-editor-header{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:linear-gradient(90deg,color-mix(in srgb, var(--violet) 10%, transparent),transparent);border-bottom:1px solid color-mix(in srgb, var(--violet) 20%, var(--border))}
    .mm-editor-badge{font-size:12px;font-weight:700;color:var(--violet);letter-spacing:.01em;font-family:var(--font)}
    .mm-editor-header-right{display:flex;align-items:center;gap:10px}
    .mm-hl-indicator{font-size:10.5px;color:var(--violet);font-family:var(--font);display:flex;align-items:center;gap:5px;padding:3px 12px;background:color-mix(in srgb, var(--violet) 15%, var(--surface));border-radius:20px;font-weight:700;animation:mmHlIn .25s ease;border:1px solid color-mix(in srgb, var(--violet) 40%, var(--border))}
    .mm-hl-dot{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#a78bfa,#7c3aed);box-shadow:0 0 8px #7c3aedaa;animation:mmDotPulse 1.4s ease infinite}
    @keyframes mmDotPulse{0%,100%{box-shadow:0 0 6px #7c3aed88;transform:scale(1)}50%{box-shadow:0 0 14px #7c3aedcc;transform:scale(1.35)}}
    @keyframes mmHlIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}
    .mm-editor-actions{display:flex;gap:6px}
    .mm-editor-body{display:flex;flex-direction:column;min-height:200px}
    .mm-editor-code{border-bottom:1px solid color-mix(in srgb, var(--violet) 15%, var(--border));position:relative}
    .mm-code-label{position:absolute;top:6px;right:10px;font-size:9.5px;color:#a78bfa88;font-family:var(--font);z-index:1;pointer-events:none;letter-spacing:.01em}
    .mm-code-wrap{display:flex;background:#1e1b2e;overflow:hidden}
    .mm-line-nums{padding:10px 0;min-width:32px;text-align:right;user-select:none;flex-shrink:0;background:#16131f;border-right:1px solid #2d2640}
    .mm-line-num{padding:0 8px 0 6px;font-size:11px;line-height:1.7;font-family:var(--mono);color:#4a3f6b;transition:all .12s}
    .mm-line-active{color:#e9dbff;background:linear-gradient(90deg,#7c3aed66,#7c3aed18);font-weight:700;text-shadow:0 0 8px #a78bfa88}
    .mm-code-input{flex:1;min-height:120px;padding:10px 14px;border:none;outline:none;font-family:var(--mono);font-size:12.5px;line-height:1.7;background:transparent;color:#e2d9f3;resize:vertical;scrollbar-width:thin;scrollbar-color:#2d2640 transparent}
    .mm-code-input::selection{background:#7c3aed44}
    .mm-editor-preview{flex:1;position:relative}
    .mm-preview-label{position:absolute;top:6px;right:10px;font-size:10px;color:#a78bfa;font-family:var(--font);z-index:3;pointer-events:none}
    .mm-preview-area{padding:16px;min-height:80px;max-height:320px;overflow:auto;display:flex;align-items:center;justify-content:center;background:var(--surface);margin:8px;border-radius:8px;border:1px solid color-mix(in srgb, var(--violet) 15%, var(--border));position:relative;transition:border-color .2s}
    .mm-preview-area.mm-has-hl{border-color:#a78bfa;box-shadow:inset 0 0 30px #7c3aed15}
    .mm-preview-svg{width:100%;overflow-x:auto;position:relative;z-index:2;transition:opacity .3s,filter .3s}
    .mm-preview-svg svg{max-width:100%;height:auto}
    .mm-preview-svg.mm-svg-dimmed{opacity:.30;filter:saturate(.2) brightness(.85)}
    .mm-hl-spot{position:absolute;z-index:1;pointer-events:none;border-radius:18px;background:radial-gradient(ellipse at center,transparent 25%,#a78bfa55 40%,#7c3aed88 55%,#7c3aedaa 65%,#a78bfa66 78%,transparent 92%);animation:mmSpotIn .3s ease;box-shadow:0 0 32px 10px #7c3aed44,0 0 60px 20px #7c3aed22}
    @keyframes mmSpotIn{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
    .mm-preview-error{color:var(--danger);font-size:12px;display:flex;align-items:center;gap:6px;font-family:var(--mono);padding:8px;background:var(--danger-bg);border-radius:var(--radius-sm);border:1px solid var(--danger);max-width:100%;word-break:break-all}
    .mm-preview-empty{color:var(--violet);font-size:13px;font-family:var(--font)}
    .mm-editor-hint{padding:6px 14px;font-size:10px;color:var(--violet);background:color-mix(in srgb, var(--violet) 5%, var(--surface));border-top:1px solid color-mix(in srgb, var(--violet) 15%, var(--border));font-family:var(--font);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .mm-hint-sep{opacity:.4}

    .ftoc{width:220px;min-width:140px;max-width:480px;background:var(--surface);border-left:none;flex-shrink:0;display:flex;flex-direction:column;overflow:hidden;animation:ftocIn .2s ease}
    @keyframes ftocIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
    .ftoc-resizer{width:7px;flex-shrink:0;cursor:col-resize;display:flex;align-items:center;justify-content:center;background:transparent;position:relative;z-index:3;transition:background .15s}
    .ftoc-resizer:hover{background:var(--accent-bg)}
    .ftoc-resizer:hover .ftoc-resizer-line{background:var(--accent);opacity:1;width:3px;box-shadow:0 0 6px rgba(37,99,235,.25)}
    .ftoc-resizer:active{background:#dbeafe}
    .ftoc-resizer:active .ftoc-resizer-line{background:var(--accent);width:3px;box-shadow:0 0 8px rgba(37,99,235,.35)}
    .ftoc-resizer-line{width:1.5px;height:32px;background:var(--border2);border-radius:2px;transition:all .15s;opacity:.6}
    .ftoc-header{padding:10px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--text2);font-family:var(--font);background:var(--surface2);flex-shrink:0}
    .ftoc-count{margin-left:auto;font-size:10px;font-weight:600;background:var(--accent-bg);color:var(--accent);padding:1px 7px;border-radius:10px;border:1px solid var(--accent-border)}
    .ftoc-list{flex:1;overflow-y:auto;padding:6px 0;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
    .ftoc-list::-webkit-scrollbar{width:4px}
    .ftoc-list::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
    .ftoc-item{display:flex;align-items:center;gap:4px;padding:3px 8px;min-height:28px;transition:all .12s;border-radius:0}
    .ftoc-item:hover{background:var(--surface2)}
    .ftoc-item.ftoc-active{background:var(--accent-bg);border-right:2.5px solid var(--accent)}
    .ftoc-toggle{width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--text3);cursor:pointer;border-radius:3px;flex-shrink:0;padding:0;transition:all .1s}
    .ftoc-toggle:hover{background:var(--border);color:var(--text)}
    .ftoc-dot-wrap{width:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .ftoc-dot{width:4px;height:4px;border-radius:50%;background:var(--border2);transition:all .15s}
    .ftoc-dot-active{width:6px;height:6px;background:var(--accent);box-shadow:0 0 5px var(--accent)}
    .ftoc-link{flex:1;display:flex;align-items:center;gap:5px;border:none;background:none;cursor:pointer;text-align:left;padding:2px 0;min-width:0;font-family:var(--font);transition:color .1s}
    .ftoc-link:hover .ftoc-text{color:var(--accent)}
    .ftoc-level{font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;flex-shrink:0;letter-spacing:.03em;font-family:var(--mono)}
    .ftoc-l1{background:#dbeafe;color:#1d4ed8}
    .ftoc-l2{background:#e0e7ff;color:#4338ca}
    .ftoc-l3{background:#ede9fe;color:#6d28d9}
    .ftoc-l4{background:#fce7f3;color:#be185d}
    .ftoc-l5{background:#fef3c7;color:#92400e}
    .ftoc-text{font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .1s;line-height:1.4}
    .ftoc-active .ftoc-text{color:var(--accent);font-weight:600}
    .ftoc-active .ftoc-level{box-shadow:0 0 0 1.5px currentColor}

    .diff-viewer{font-family:var(--font);display:flex;flex-direction:column;height:100%}
    .diff-stats{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;background:var(--surface);border-bottom:1px solid var(--border);flex-wrap:wrap;flex-shrink:0;position:sticky;top:0;z-index:4}
    .diff-stats-left{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .diff-stats-right{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .diff-severity{display:flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;border:1.5px solid;letter-spacing:.02em}
    .diff-severity-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;animation:diffDotPulse 2s ease infinite}
    @keyframes diffDotPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.8)}}
    .diff-stat-num{font-size:12px;font-weight:600;font-family:var(--mono);padding:2px 8px;background:var(--surface2);border-radius:4px}
    .diff-stat-base{font-size:11px;color:var(--text3);font-family:var(--font);padding:2px 8px;background:var(--surface2);border-radius:4px;border:1px dashed var(--border)}
    .diff-ratio-wrap{display:flex;align-items:center;gap:8px}
    .diff-ratio-label{font-size:11px;color:var(--text3);white-space:nowrap;font-weight:500}
    .diff-ratio-bar{width:120px;height:8px;background:var(--surface2);border-radius:4px;position:relative;overflow:hidden;border:1px solid var(--border)}
    .diff-ratio-fill{height:100%;border-radius:3px;transition:width .5s ease,background .3s}
    .diff-ratio-marks{position:absolute;inset:0}
    .diff-ratio-marks span{position:absolute;top:0;bottom:0;width:1px;background:var(--border2);opacity:.5}
    .diff-ratio-pct{font-size:13px;font-weight:800;font-family:var(--mono);min-width:48px;text-align:right}
    .diff-identical{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:60px 20px;font-size:14px;color:var(--text2);font-weight:500}

    .diff-unified{font-family:var(--mono);font-size:12.5px;line-height:1.7;flex:1}
    .diff-line{display:flex;border-bottom:1px solid transparent}
    .diff-line:hover{filter:brightness(.97)}
    .diff-eq{background:#fafbfc}
    .diff-add{background:#dcfce7;border-left:3px solid #4ade80}
    .diff-del{background:#fef2f2;border-left:3px solid #f87171}
    .diff-modify{background:#fef3c7;border-left:3px solid #fbbf24}
    .diff-gutter-old,.diff-gutter-new{width:46px;flex-shrink:0;text-align:right;padding:1px 8px 1px 4px;color:#9ca3af;font-size:11px;user-select:none;border-right:1px solid var(--border)}
    .diff-add .diff-gutter-old{background:#d1fae5}
    .diff-add .diff-gutter-new{background:#bbf7d0;color:#16a34a}
    .diff-del .diff-gutter-old{background:#fecaca;color:#dc2626}
    .diff-del .diff-gutter-new{background:#fee2e2}
    .diff-sign{width:22px;flex-shrink:0;text-align:center;font-weight:700;color:#9ca3af;user-select:none;padding:1px 0}
    .diff-add .diff-sign{color:#16a34a}
    .diff-del .diff-sign{color:#dc2626}
    .diff-modify .diff-gutter-old{background:#fef3c7;color:#d97706}
    .diff-modify .diff-gutter-new{background:#fef3c7;color:#d97706}
    .diff-modify .diff-sign{color:#d97706}
    .diff-content{flex:1;padding:1px 12px;white-space:pre;min-width:0}
    .diff-word-del{background:#fca5a5;border-radius:2px;padding:0 1px}
    .diff-word-add{background:#86efac;border-radius:2px;padding:0 1px}

    .diff-split{flex:1;display:flex;flex-direction:column;font-family:var(--mono);font-size:12px;line-height:1.7}
    .diff-split-header{display:flex;border-bottom:1px solid var(--border);flex-shrink:0;position:sticky;top:0;z-index:3}
    .diff-split-title{flex:1;padding:8px 12px;font-size:11px;font-weight:700;font-family:var(--font);color:var(--text2);background:var(--surface2);letter-spacing:.02em}
    .diff-split-title.diff-split-old{border-right:1px solid var(--border)}
    .diff-split-body{flex:1;overflow-y:auto}
    .diff-split-row{display:flex;border-bottom:1px solid var(--border)}
    .diff-split-row:hover{filter:brightness(.97)}
    .diff-split-cell{flex:1;display:flex;min-height:24px;min-width:0}
    .diff-split-cell.diff-split-old{border-right:1px solid var(--border)}
    .diff-cell-del{background:#fef2f2;border-left:3px solid #f87171}
    .diff-cell-add{background:#dcfce7;border-left:3px solid #4ade80}
    .diff-cell-modify{background:#fef3c7;border-left:3px solid #fbbf24}
    .diff-cell-modify .diff-gutter-s{color:#d97706;background:#fef3c7}
    .diff-cell-empty{background:#f8f8f8}
    .diff-gutter-s{width:40px;flex-shrink:0;text-align:right;padding:1px 6px 1px 2px;color:#9ca3af;font-size:10.5px;user-select:none;border-right:1px solid var(--border)}
    .diff-cell-del .diff-gutter-s{color:#dc2626;background:#fecaca}
    .diff-cell-add .diff-gutter-s{color:#16a34a;background:#bbf7d0}
    .diff-content-s{flex:1;padding:1px 10px;white-space:pre;min-width:0}
    .diff-wrap .diff-content{white-space:pre-wrap;word-break:break-all}
    .diff-wrap .diff-content-s{white-space:pre-wrap;word-break:break-all}

    .diff-legend{display:flex;align-items:center;gap:14px;padding:10px 20px;background:var(--surface);border-top:1px solid var(--border);flex-shrink:0;flex-wrap:wrap}
    .diff-legend-item{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);font-family:var(--font)}
    .diff-legend-swatch{width:14px;height:14px;border-radius:3px;border:1.5px solid;flex-shrink:0}
    .diff-legend-tip{color:var(--text3);font-style:italic;margin-left:auto}
    .swatch-add{background:#bbf7d0;border-color:#4ade80}
    .swatch-del{background:#fecaca;border-color:#f87171}
    .swatch-mod{background:#fef3c7;border-color:#fbbf24}
    
    .diff-stale-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.85);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:10;border-radius:8px}
    .diff-stale-content{text-align:center;padding:32px;max-width:400px}
    .diff-stale-icon{font-size:48px;margin-bottom:16px}
    .diff-stale-title{font-size:18px;font-weight:700;color:#92400e;margin-bottom:8px}
    .diff-stale-desc{font-size:13px;color:#78716c;line-height:1.5;margin-bottom:20px}
    .diff-stale-btn{padding:12px 24px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(59,130,246,0.3);transition:transform 0.2s,box-shadow 0.2s}
    .diff-stale-btn:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(59,130,246,0.4)}
    @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  `;

  return (
    <div 
      className="flex flex-col"
      data-theme={theme}
      style={{fontFamily:'var(--font)',background:'var(--bg)',color:'var(--text)',height:'100dvh',minHeight:0,overflow:'hidden', transition: 'background 0.3s'}}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <style>{styles}</style>

      {/* Canary build banner */}
      {import.meta.env.VITE_CANARY && (
        <div style={{background:'#fbbf24',color:'#78350f',textAlign:'center',padding:'2px 0',fontSize:11,fontFamily:'monospace',fontWeight:600,letterSpacing:'0.5px',zIndex:200,position:'relative'}}>
          CANARY BUILD {(import.meta.env.VITE_BUILD_SHA || '').slice(0, 7)}
        </div>
      )}

      {/* File Upload Overlay when dragging */}
      <div className="fixed inset-0 bg-blue-500/10 pointer-events-none z-[100] hidden items-center justify-center backdrop-blur-sm group-hover:flex transition-opacity" id="drag-overlay">
        <div className="bg-white/90 p-8 rounded-xl shadow-2xl flex flex-col items-center gap-4 border-4 border-blue-500 border-dashed">
          <Upload className="w-16 h-16 text-blue-500" />
          <span className="text-xl font-bold text-blue-600">釋放以新增 Markdown 檔案</span>
        </div>
      </div>
      
      {/* Header — hidden in embed mode */}
      <div style={{background:'var(--surface)',borderBottom:'1px solid var(--border)',padding:'8px clamp(10px,2%,16px)',boxShadow:'var(--shadow)',flexShrink:0, display: embedMode ? 'none' : undefined}}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div style={{width:36,height:36,background:'linear-gradient(135deg,#2563eb,#7c3aed)',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center'}}><FileText className="w-4.5 h-4.5 text-white" /></div>
            <div><h1 style={{fontSize:15,fontWeight:700,color:'var(--text)',letterSpacing:'-.01em'}}>MD 批次審核</h1><p style={{fontSize:11,color:'var(--text2)',marginTop:1}}>{files.length} 個檔案 · {doneCount} 已完成</p></div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {flagDarkMode && (<>
              <button onClick={toggleTheme} className="tbtn tbtn-gray" title={theme === 'light' ? '切換深色模式' : '切換淺色模式'} aria-label="切換主題">
                {theme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
              </button>
              <div className="w-px h-5 bg-gray-200 mx-1" />
            </>)}
            <button onClick={doFormat} disabled={!activeFile} className="tbtn tbtn-violet" title="整理排版"><Wand2 className="w-3.5 h-3.5" />格式化</button>
            {flagDashboard && <button onClick={() => setShowDashboard(v => !v)} disabled={!files.length} className={'tbtn ' + (showDashboard ? 'tbtn-blue' : 'tbtn-gray')} title="差異儀表板"><BarChart3 className="w-3.5 h-3.5" />儀表板</button>}
            <div className="w-px h-5 bg-gray-200 mx-1" />
            <button onClick={() => importRef.current?.click()} className="tbtn tbtn-gray" title="匯入先前備份的審核狀態 (.json 檔案)"><FileUp className="w-3.5 h-3.5" />匯入狀態</button>
            <button onClick={doExport} disabled={!files.length} className="tbtn tbtn-gray" title="匯出目前的審核進度並下載備份 (.json 檔案)"><FileDown className="w-3.5 h-3.5" />匯出狀態</button>
            <div className="w-px h-5 bg-gray-200 mx-1" />
            <button onClick={() => { if (activeFile) downloadFile(activeFile); }} disabled={!activeFile} className="tbtn tbtn-blue" title="下載 .md(含標記)"><Download className="w-3.5 h-3.5" />下載 MD</button>
            <button onClick={downloadZip} disabled={!doneCount} className="tbtn tbtn-green" title="ZIP 下載已完成檔案"><FolderDown className="w-3.5 h-3.5" />全部 ZIP ({doneCount})</button>
          </div>
        </div>
      </div>
      <input ref={importRef} type="file" accept=".json" onChange={doImport} className="hidden" />

      <div style={{flex:'1 1 0%',display:'flex',overflow:'hidden',minHeight:0}}>
        {/* Sidebar — always visible (even in embed mode, for file switching) */}
        <div className="bg-white border-r flex flex-col" style={{width:'clamp(180px, 20%, 240px)',minWidth:180,maxWidth:240,flexShrink:0}}>
          <div className="px-3 py-2.5 border-b flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">檔案清單</span>
            <button onClick={() => setShowAdd(true)} className="w-6 h-6 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!sortedFiles.length && <div className="p-6 text-center"><Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" /><p className="text-xs text-gray-400">點擊 + 新增檔案</p></div>}
            {sortedFiles.filter(f=>f.status==='pending').length>0 && <div className="px-3 py-1.5 text-xs text-gray-400 font-medium bg-gray-50 border-b">待審核 ({sortedFiles.filter(f=>f.status==='pending').length})</div>}
            {sortedFiles.filter(f=>f.status==='pending').map(f=>(
              <div key={f.id} onClick={()=>{setActiveId(f.id);setEditingBlock(null);setViewMode('preview');setShowDashboard(false)}} className={'si flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-gray-50 '+(activeId===f.id?'act':'')}>
                <button onClick={e=>{e.stopPropagation();toggleDone(f.id)}} className="text-gray-300 hover:text-green-500 shrink-0"><Circle className="w-4 h-4"/></button>
                <span className="text-xs text-gray-700 truncate flex-1">{f.name}</span>
                {f.marks.length>0&&<span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">{f.marks.length}</span>}
              </div>))}
            {sortedFiles.filter(f=>f.status==='done').length>0 && <div className="px-3 py-1.5 text-xs text-gray-400 font-medium bg-green-50 border-b">已完成 ({sortedFiles.filter(f=>f.status==='done').length})</div>}
            {sortedFiles.filter(f=>f.status==='done').map(f=>(
              <div key={f.id} onClick={()=>{setActiveId(f.id);setEditingBlock(null);setViewMode('preview');setShowDashboard(false)}} className={'si flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-gray-50 '+(activeId===f.id?'act':'')}>
                <button onClick={e=>{e.stopPropagation();toggleDone(f.id)}} className="text-green-500 hover:text-gray-400 shrink-0"><CheckCircle2 className="w-4 h-4"/></button>
                <span className="text-xs text-gray-500 truncate flex-1 line-through">{f.name}</span>
                {f.marks.length>0&&<span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">{f.marks.length}</span>}
                <button onClick={e=>{e.stopPropagation();downloadFile(f)}} className="text-gray-300 hover:text-blue-500 shrink-0"><Download className="w-3.5 h-3.5"/></button>
              </div>))}
          </div>
          {files.length>0&&(<div className="px-3 py-2 border-t bg-gray-50"><div className="flex items-center gap-2"><div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-green-500 rounded-full transition-all" style={{width:(doneCount/files.length*100)+'%'}}/></div><span className="text-xs text-gray-500 font-medium">{doneCount}/{files.length}</span></div></div>)}
        </div>

        {/* Main */}
        {flagDashboard && showDashboard ? (
          <div className="flex-1" style={{minWidth:0,overflow:'auto',background:'var(--bg)'}}>
            <DashboardOverview
              files={files}
              allStats={dashStats}
              computing={dashComputing}
              onSelectFile={(id) => { setActiveId(id); setShowDashboard(false); setViewMode('diff'); }}
              onClose={() => setShowDashboard(false)}
            />
          </div>
        ) : activeFile ? (
          <div className="flex-1 flex flex-col" style={{minWidth:0}}>
            <div className="bg-white border-b px-4 py-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">{activeFile.name}</span>
                {activeFile.marks.length>0&&<span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full">{activeFile.marks.length} 個標記</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  <button onClick={()=>{setViewMode('preview');setEditingBlock(null)}} className={'px-2.5 py-1 text-xs rounded-md font-medium transition-colors '+(viewMode==='preview'?'bg-white text-gray-800 shadow-sm':'text-gray-500')}>
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3"/>預覽編輯</span></button>
                  <button onClick={()=>setViewMode('source')} className={'px-2.5 py-1 text-xs rounded-md font-medium transition-colors '+(viewMode==='source'?'bg-white text-gray-800 shadow-sm':'text-gray-500')}>
                    <span className="flex items-center gap-1"><Code className="w-3 h-3"/>原始碼</span></button>
                  {activeFile.originalContent && activeFile.originalContent !== activeFile.content && (
                    <button onClick={()=>setViewMode('diff')} className={'px-2.5 py-1 text-xs rounded-md font-medium transition-colors '+(viewMode==='diff'?'bg-white text-gray-800 shadow-sm':'text-gray-500')}>
                      <span className="flex items-center gap-1"><GitCompare className="w-3 h-3"/>差異比對</span></button>
                  )}
                </div>
                <div className="w-px h-5 bg-gray-200"/>
                {tocEntries.length > 0 && viewMode === 'preview' && (
                  <button onClick={() => setShowToc(p => !p)}
                    className={'text-xs flex items-center gap-1 px-2 py-1 rounded-md transition-colors ' + (showToc ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-500 hover:text-blue-600')}>
                    <ListTree className="w-3.5 h-3.5"/>目錄{showToc ? '' : ` (${tocEntries.length})`}
                  </button>
                )}
                <div className="w-px h-5 bg-gray-200"/>
                <button onClick={()=>downloadFile(activeFile)} className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1"><Download className="w-3.5 h-3.5"/>下載</button>
                <button onClick={()=>removeFile(activeFile.id)} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5"/>移除</button>
              </div>
            </div>

            {viewMode==='source' ? (
              <SourceEditor value={activeFile.content} onChange={val=>updateFile(activeFile.id,{content:val})} />

            ) : viewMode==='diff' ? (
              <div className="flex-1 overflow-auto" style={{background:'var(--surface)',minWidth:0}}>
                <DiffViewer originalContent={activeFile.originalContent || ''} currentContent={activeFile.content} fileName={activeFile.name} />
              </div>
            ) : (
              <div className="flex-1 flex" style={{minHeight:0,overflow:'hidden'}}>
                <div className="flex-1 overflow-auto" style={{background:'var(--surface)',minWidth:0,padding:'clamp(8px,2%,16px)'}}>
                  <div className="doc-canvas">
                    <div className="text-xs text-gray-400 mb-4 flex items-center gap-4 pb-3 border-b border-dashed flex-wrap">
                      <span>📝 單擊 → 編輯</span>
                      <span>🔴 雙擊 → 標記</span>
                      <span>⌨️ 選取文字 → 浮動工具列</span>
                      <span>/ 空行輸入 → 快捷指令</span>
                      <span>⋮⋮ 左側手柄 → 區塊操作</span>
                    </div>
                    {blocks.map((block, i) => (
                      <InlineBlock key={activeFile.id+'-'+i} blockId={'block-'+i} blockIdx={i} totalBlocks={blocks.length} raw={block} html={blockHtmls[i]||''} isEditing={editingBlock==='block-'+i} marks={activeFile.marks} onStartEdit={onStartEdit} onFinishEdit={onFinishEdit} onMark={onBlockMark} onBlockAction={onBlockAction} mermaidReady={mermaidReady} mermaidThemeVer={mermaidThemeVer}/>
                    ))}
                    {!blocks.length && <div className="text-center py-10 text-gray-400 text-sm">檔案內容為空</div>}
                  </div>
                </div>
                {showToc && tocEntries.length > 0 && (<>
                  <div className="ftoc-resizer"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const startX = e.clientX;
                      const startW = tocWidth;
                      tocDragRef.current = true;
                      document.body.style.cursor = 'col-resize';
                      document.body.style.userSelect = 'none';
                      const onMove = (ev) => {
                        const delta = startX - ev.clientX;
                        setTocWidth(Math.max(140, Math.min(480, startW + delta)));
                      };
                      const onUp = () => {
                        tocDragRef.current = false;
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                      };
                      document.addEventListener('mousemove', onMove);
                      document.addEventListener('mouseup', onUp);
                    }}>
                    <div className="ftoc-resizer-line" />
                  </div>
                  <FloatingToc entries={tocEntries} onNavigate={() => {}} width={tocWidth} />
                </>)}
              </div>
            )}

            {activeFile.marks.length>0&&(
              <div className="bg-white border-t px-4 py-1.5">
                <div className="flex items-center gap-2 overflow-x-auto">
                  <span className="text-xs text-gray-400 shrink-0">標記:</span>
                  {activeFile.marks.map((m,i)=>(
                    <span key={m.blockId+'-'+i} onClick={()=>setPopup({blockId:m.blockId,position:{x:window.innerWidth/2,y:window.innerHeight/3},mark:m})} className="shrink-0 px-2 py-0.5 bg-red-50 text-red-600 rounded border border-red-100 text-xs cursor-pointer hover:bg-red-100">
                      #{i+1}: {m.issue.slice(0,15)}{m.issue.length>15?'...':''}
                    </span>))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center" style={{background:'var(--bg)'}}>
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><FileText className="w-8 h-8 text-gray-300"/></div>
              <p className="text-sm text-gray-400 mb-4">{files.length?'← 選擇檔案開始審核':'新增 .md 檔案開始審核'}</p>
              {!files.length&&<button onClick={()=>setShowAdd(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 mx-auto"><Plus className="w-4 h-4"/>新增檔案</button>}
            </div>
          </div>
        )}
      </div>

      {popup&&<MarkPopup mark={popup.mark} position={popup.position} onSave={saveMark} onDelete={deleteMark} onClose={()=>setPopup(null)}/>}
      {showAdd&&<AddFileModal onAdd={addFile} onBatchAdd={batchAddFile} onClose={()=>setShowAdd(false)}/>}
      
      {/* Download Modal */}
      {downloadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setDownloadModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-800 mb-4">下載檔案</h3>
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700 mb-1 block">檔案名稱</label>
              <input 
                type="text" 
                value={downloadModal.name} 
                onChange={e => setDownloadModal({...downloadModal, name: e.target.value})}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button 
                onClick={() => setDownloadModal(null)} 
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                取消
              </button>
              <button 
                onClick={() => confirmDownload(downloadModal.name)} 
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                確認下載
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

