// Add-file modal — extracted from MdReviewer.jsx (Phase 2 refactor). Behavior verbatim.
import React, { useState } from 'react';
import { X, Clipboard, FileText } from 'lucide-react';

/* ===== ADD FILE MODAL ===== */
export function AddFileModal({ onAdd, onBatchAdd, onClose }) {
  const [mode, setMode] = useState('single');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [batchText, setBatchText] = useState('');
  const handlePaste = async () => { try { const t = await navigator.clipboard.readText(); if (t) setContent(prev => prev + t); } catch {} };
  const parseBatch = () => {
    const parts = []; const lines = batchText.split('\n');
    let cn = '', cl = [];
    for (const line of lines) {
      const match = line.match(/^={3,}\s*FILE:\s*(.+?)\s*={3,}$/);
      if (match) { if (cn && cl.length) parts.push({ name: cn, content: cl.join('\n').trim() }); cn = match[1]; cl = []; }
      else cl.push(line);
    }
    if (cn && cl.length) parts.push({ name: cn, content: cl.join('\n').trim() });
    return parts;
  };
  const batchFiles = mode === 'batch' ? parseBatch() : [];
  const singleReady = !!(name.trim() && content.trim());
  const batchReady = batchFiles.length > 0;
  const submitSingle = () => { if (singleReady) onAdd(name.trim(), content.trim()); };
  const submitBatch = () => { if (batchReady) { onBatchAdd(batchFiles); onClose(); } };
  const handleShortcut = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'single') submitSingle();
      else submitBatch();
    }
  };
  const panelStyle = {
    background: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-xl)'
  };
  const subtleStyle = { color: 'var(--text2)' };
  const helperStyle = {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    color: 'var(--text2)'
  };
  const inputStyle = {
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '10px 12px',
    fontSize: '13px',
    background: 'var(--bg)',
    color: 'var(--text)',
    outline: 'none'
  };
  const textAreaStyle = {
    width: '100%',
    height: '16rem',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '12px',
    fontFamily: 'var(--mono)',
    resize: 'none',
    lineHeight: 1.7,
    background: 'var(--bg)',
    color: 'var(--text)',
    outline: 'none'
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="rounded-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col overflow-hidden" style={panelStyle} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-base font-semibold">新增檔案</h2>
            <p className="text-xs mt-1" style={subtleStyle}>支援單檔貼上或批次匯入，按 Cmd/Ctrl + Enter 可直接送出。</p>
          </div>
          <button onClick={onClose} className="transition-colors" style={subtleStyle}><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 pt-4 shrink-0">
          <div className="flex gap-1 p-1 rounded-xl" style={helperStyle}>
            <button onClick={() => setMode('single')} className="flex-1 py-2 text-sm rounded-lg font-medium transition-all"
              style={mode === 'single' ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow)' } : subtleStyle}>
              單檔新增
            </button>
            <button onClick={() => setMode('batch')} className="flex-1 py-2 text-sm rounded-lg font-medium transition-all"
              style={mode === 'batch' ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow)' } : subtleStyle}>
              批次新增
            </button>
          </div>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {mode === 'single' ? (
            <div className="space-y-3">
              <div className="rounded-xl p-3.5" style={helperStyle}>
                <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text)' }}>單檔模式</div>
                <div className="text-xs" style={subtleStyle}>適合直接貼入單一 Markdown 文件，檔名可先填好再貼內容。</div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block" style={{ color: 'var(--text)' }}>檔案名稱</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={handleShortcut}
                  autoFocus
                  placeholder="例如: 理賠文件.md"
                  style={inputStyle}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium" style={{ color: 'var(--text)' }}>Markdown 內容</label>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px]" style={subtleStyle}>{content.length} 字元</span>
                    <button onClick={handlePaste} className="text-xs flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                      <Clipboard className="w-3 h-3" />從剪貼簿貼上
                    </button>
                  </div>
                </div>
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  onKeyDown={handleShortcut}
                  placeholder="貼上 Markdown 內容，或直接在這裡輸入..."
                  style={textAreaStyle}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl p-3.5 text-xs" style={{ ...helperStyle, background: 'rgba(245, 158, 11, 0.09)' }}>
                <p className="font-semibold mb-1" style={{ color: 'var(--text)' }}>批次貼上格式</p>
                <p className="mb-2" style={subtleStyle}>用分隔線區分每個檔案，系統會自動拆分並檢查內容。</p>
                <pre className="border rounded-lg p-2.5 text-xs font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto"
                  style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text2)' }}>{`=== FILE: 文件1.md ===\n(第一個檔案的內容)\n\n=== FILE: 文件2.md ===\n(第二個檔案的內容)`}</pre>
              </div>
              <textarea
                value={batchText}
                onChange={e => setBatchText(e.target.value)}
                onKeyDown={handleShortcut}
                placeholder={"=== FILE: 文件1.md ===\n...\n\n=== FILE: 文件2.md ===\n..."}
                style={textAreaStyle}
              />
              {batchFiles.length > 0 && (<div className="rounded-xl p-3" style={{ background: 'var(--success-bg)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--success)' }}>偵測到 {batchFiles.length} 個檔案</p>
                {batchFiles.map((f, i) => (
                  <div key={i} className="text-xs flex items-center gap-1.5 py-0.5" style={{ color: 'var(--text2)' }}>
                    <FileText className="w-3 h-3" />{f.name} ({f.content.length} 字)
                  </div>
                ))}
              </div>)}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2 shrink-0" style={{ background: 'var(--surface2)', borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg transition-colors" style={subtleStyle}>取消</button>
          {mode === 'single' ? (
            <button onClick={submitSingle} disabled={!singleReady} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">新增</button>
          ) : (
            <button onClick={submitBatch} disabled={!batchReady} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">新增 {batchFiles.length} 個檔案</button>
          )}
        </div>
      </div>
    </div>
  );
}
