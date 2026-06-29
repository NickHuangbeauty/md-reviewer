// Diff viewer + virtual diff list + source editor + download modal — extracted
// from MdReviewer.jsx (Phase 2 refactor). Behavior verbatim. The diff Web Worker
// is resolved relative to this module.
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useFeatureFlag, getAllFlags } from '../featureFlags.js';

/* ===== DIFF ENGINE (Enhanced with Similarity Matching) ===== */

// 檢查是否為「無意義」的行（純空行、無結構意義的空標籤、Markdown 表格分隔行等）
export function isEmptyOrWhitespace(line) {
  if (!line) return true;
  const trimmed = line.trim();
  if (!trimmed) return true;

  // Markdown 表格分隔行 |---|---|---| 視為結構標記，降低權重
  if (/^\|[\s-:]+\|[\s-:|]*$/.test(trimmed)) return true;

  // Markdown 空表格行 |||| 或 |   |   |   | 視為無意義
  if (/^\|[\s|]*\|$/.test(trimmed)) {
    const content = trimmed.replace(/\|/g, '').trim();
    if (!content) return true;
  }

  // 如果是空的 HTML 標籤，但有結構屬性（colspan, rowspan, height），則視為有意義
  if (/colspan|rowspan|height/i.test(trimmed)) return false;

  // 純空的 <td></td> 或 <th></th>（無任何屬性）才算無意義
  if (/^<(td|th)>\s*<\/(td|th)>$/i.test(trimmed)) return true;

  // 只有空白的標籤
  if (/^<\w+[^>]*>\s*<\/\w+>$/.test(trimmed) && !/colspan|rowspan/i.test(trimmed)) {
    // 檢查是否只是空白標籤（無文字內容）
    const content = trimmed.replace(/<[^>]*>/g, '').trim();
    if (!content) return true;
  }

  return false;
}

export function computeDiffStats(edits) {
  const total = edits.length;
  const added = edits.filter(e => e.type === 'add').length;
  const deleted = edits.filter(e => e.type === 'del').length;
  const modified = edits.filter(e => e.type === 'modify').length;
  const unchanged = edits.filter(e => e.type === 'eq').length;

  // 原始文件總行數（eq + del + modify 都來自舊文件）
  const oldTotal = deleted + unchanged + modified;

  // 計算「有意義」的變更（排除空行/空標籤）
  let meaningfulAdded = 0;
  let meaningfulDeleted = 0;

  edits.forEach(e => {
    if (e.type === 'add') {
      if (!isEmptyOrWhitespace(e.newLine)) {
        meaningfulAdded += 1;
      } else {
        meaningfulAdded += 0.1;
      }
    } else if (e.type === 'del') {
      if (!isEmptyOrWhitespace(e.oldLine)) {
        meaningfulDeleted += 1;
      } else {
        meaningfulDeleted += 0.1;
      }
    }
  });

  // 變更幅度：(新增 + 刪除) ÷ 原始行數，微調不計入，上限 100%
  const weightedChanges = meaningfulAdded + meaningfulDeleted;

  // 有意義的原始行數（排除空行）
  const meaningfulOldTotal = edits.filter(e =>
    (e.type === 'del' || e.type === 'eq' || e.type === 'modify') &&
    !isEmptyOrWhitespace(e.oldLine)
  ).length || oldTotal || 1;

  const rawRatio = meaningfulOldTotal > 0 ? weightedChanges / meaningfulOldTotal : (added > 0 ? 1 : 0);
  const changeRatio = Math.min(rawRatio, 1.0);

  return { total, added, deleted, modified, unchanged, changed: added + deleted + modified, changeRatio, oldTotal };
}

export function DownloadConfirmModal({ filename, onConfirm, onClose }) {
  const [name, setName] = useState(filename);

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b flex justify-between items-center bg-gray-50">
          <h3 className="font-bold text-lg text-gray-800">確認下載</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">檔案名稱</label>
          <input
            type="text"
            className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 text-gray-800"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onConfirm(name)}
            autoFocus
          />
          <p className="mt-2 text-xs text-gray-500">提示：您可以修改下載後的檔案名稱</p>
        </div>
        <div className="px-5 py-4 bg-gray-50 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-md">取消</button>
          <button onClick={() => onConfirm(name)} className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-md shadow-sm">確認下載</button>
        </div>
      </div>
    </div>
  );
}

// Virtual scrolling component for large diffs
export function VirtualDiffList({ items, mode, isCalculating, progress, manualMode, needsRefresh, onRefresh, onExpandFold }) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  const ROW_HEIGHT = 24; // pixels per row
  const BUFFER = 10; // extra rows to render above/below viewport
  const VIRTUAL_THRESHOLD = 500;
  const useVirtual = items.length >= VIRTUAL_THRESHOLD;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !useVirtual) return;

    const updateHeight = () => setContainerHeight(container.clientHeight);
    updateHeight();

    const handleScroll = () => setScrollTop(container.scrollTop);
    container.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', updateHeight);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateHeight);
    };
  }, [useVirtual]);

  const totalHeight = items.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const endIndex = Math.min(items.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER);
  const visibleItems = items.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;

  // Render a single unified row
  const renderUnifiedRow = (e, i) => (
    <div key={startIndex + i} className={'diff-line diff-' + e.type + (e._revealed ? ' diff-revealed' : '') + (e._fade ? ' diff-faded' : '')} style={useVirtual ? { height: ROW_HEIGHT } : undefined}>
      <span className="diff-gutter-old">{e.type === 'add' ? '' : (e.oldIdx != null ? e.oldIdx + 1 : '')}</span>
      <span className="diff-gutter-new">{e.type === 'del' ? '' : (e.newIdx != null ? e.newIdx + 1 : '')}</span>
      <span className="diff-sign">{e.type === 'add' ? '+' : e.type === 'del' ? '−' : e.type === 'modify' ? '~' : ' '}</span>
      <span className="diff-content">{e.type === 'add' ? (e.newLine || '') : e.type === 'modify' ? (e.newLine || '') : (e.oldLine || '')}</span>
    </div>
  );

  // Render a single split row
  const renderSplitRow = (p, i) => {
    const cellClass = (side) => {
      if (p.type === 'modify') return ' diff-cell-modify';
      if (p.type === 'change') {
        if (side === 'old') return p.old != null ? ' diff-cell-del' : ' diff-cell-empty';
        return p.new != null ? ' diff-cell-add' : ' diff-cell-empty';
      }
      return '';
    };
    return (
      <div key={startIndex + i} className={'diff-split-row' + (p._revealed ? ' diff-revealed' : '') + (p._fade ? ' diff-faded' : '')} style={useVirtual ? { height: ROW_HEIGHT } : undefined}>
        <div className={'diff-split-cell diff-split-old' + cellClass('old')}>
          <span className="diff-gutter-s">{p.oldIdx != null ? p.oldIdx + 1 : ''}</span>
          <span className="diff-content-s">{p.old != null ? p.old : ''}</span>
        </div>
        <div className={'diff-split-cell diff-split-new' + cellClass('new')}>
          <span className="diff-gutter-s">{p.newIdx != null ? p.newIdx + 1 : ''}</span>
          <span className="diff-content-s">{p.new != null ? p.new : ''}</span>
        </div>
      </div>
    );
  };

  // Render a fold row (collapsed/expanded unchanged lines)
  const renderFoldRow = (e, i) => (
    <div
      key={'fold-' + e.foldId}
      className={'diff-fold-row' + (e.expanded ? ' diff-fold-expanded' : '')}
      onClick={() => onExpandFold(e.foldId)}
      style={{ height: ROW_HEIGHT }}
    >
      <span className="diff-fold-icon">{e.expanded ? '▴' : '⋯'}</span>
      <span className="diff-fold-label">{e.expanded ? `▾ 收合 ${e.count} 行` : `收合 ${e.count} 行未變更`}</span>
      <span className="diff-fold-hint">{e.expanded ? '點擊收合' : '點擊展開'}</span>
    </div>
  );

  return (
    <div className="diff-virtual-container" style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Blur overlay when diff is stale in manual mode */}
      {manualMode && needsRefresh && items.length > 0 && !isCalculating && (
        <div className="diff-stale-overlay">
          <div className="diff-stale-content">
            <div className="diff-stale-icon">⚠️</div>
            <div className="diff-stale-title">內容已變更</div>
            <div className="diff-stale-desc">大型文件已啟用手動比對模式，請點擊下方按鈕更新差異顯示</div>
            <button
              onClick={onRefresh}
              className="diff-stale-btn"
            >
              🔄 更新差異比對
            </button>
          </div>
        </div>
      )}

      {/* Manual mode indicator bar */}
      {manualMode && (
        <div className="diff-manual-bar" style={{
          padding: '8px 12px',
          background: 'linear-gradient(90deg, #fef3c7, #fde68a)',
          borderRadius: '6px',
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>⚡</span>
            <span style={{ color: '#92400e', fontSize: '12px', fontWeight: 500 }}>
              大型內容（&gt;3000字元）：已啟用手動比對模式
            </span>
          </div>
          <button
            onClick={onRefresh}
            disabled={isCalculating}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              background: needsRefresh ? '#3b82f6' : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isCalculating ? 'not-allowed' : 'pointer',
              opacity: isCalculating ? 0.5 : 1,
              fontWeight: 500
            }}
          >
            {isCalculating ? '⏳ 計算中...' : needsRefresh ? '🔄 更新比對' : '✓ 已是最新'}
          </button>
        </div>
      )}

      {/* Progress Bar */}
      {isCalculating && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
          background: '#e5e7eb', zIndex: 10
        }}>
          <div style={{
            height: '100%', background: '#3b82f6', width: `${progress}%`,
            transition: 'width 0.2s ease-out'
          }} />
        </div>
      )}

      {items.length === 0 ? (
        <div className="diff-empty" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          color: '#9ca3af',
          fontSize: '14px'
        }}>
          {isCalculating ? (
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'8px'}}>
               <span style={{ fontSize:'24px', animation: 'spin 1s linear infinite' }}>⏳</span>
               <span>正在計算差異中... ({progress}%)</span>
            </div>
          ) : manualMode ? '請點擊「更新比對」按鈕來計算差異' : '尚無差異資料'}
        </div>
      ) : (
        <div style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          filter: (manualMode && needsRefresh) ? 'blur(3px)' : 'none',
          opacity: (manualMode && needsRefresh) ? 0.6 : 1,
          transition: 'filter 0.3s, opacity 0.3s'
        }}>
          {mode === 'split' && (
            <div className="diff-split-header">
              <div className="diff-split-title diff-split-old">📄 原始(解析者產出)</div>
              <div className="diff-split-title diff-split-new">📝 目前(審核後)</div>
            </div>
          )}
          <div
            ref={containerRef}
            className={(mode === 'unified' ? 'diff-unified' : 'diff-split-body') + (useVirtual ? ' diff-virtual-scroll' : ' diff-wrap')}
            style={{ flex: 1, overflowY: 'auto', overflowX: useVirtual ? 'auto' : 'hidden', minHeight: 0 }}
          >
            {useVirtual ? (
              <div style={{ height: totalHeight, position: 'relative', minWidth: 'fit-content' }}>
                <div style={{ position: 'absolute', top: offsetY, left: 0, minWidth: '100%' }}>
                  {visibleItems.map((item, i) =>
                    item.type === 'fold' ? renderFoldRow(item, i)
                    : mode === 'unified' ? renderUnifiedRow(item, i) : renderSplitRow(item, i)
                  )}
                </div>
              </div>
            ) : (
              items.map((item, i) =>
                item.type === 'fold' ? renderFoldRow(item, i)
                : mode === 'unified' ? renderUnifiedRow(item, i) : renderSplitRow(item, i)
              )
            )}
          </div>
          <div className="diff-virtual-info text-xs text-gray-400 mt-1">
            {useVirtual
              ? `顯示 ${startIndex + 1}-${Math.min(endIndex, items.length)} / 共 ${items.length} 行`
              : `共 ${items.length} 行`
            }
          </div>
        </div>
      )}
    </div>
  );
}

export function SourceEditor({ value, onChange }) {
  const textareaRef = useRef(null);
  const gutterRef = useRef(null);
  const lineCount = useMemo(() => (value || '').split('\n').length, [value]);

  const syncScroll = useCallback(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  return (
    <div className="flex-1 overflow-hidden flex" style={{ background: '#0d1117' }}>
      <div ref={gutterRef} className="source-gutter" aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="source-gutter-line">{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        className="source-editor"
        spellCheck={false}
      />
    </div>
  );
}

/* ===== DIFF FOLD HELPERS ===== */
export const CONTEXT_LINES = 3;   // eq lines to keep near changes
export const FOLD_THRESHOLD = 5;  // min consecutive eq to trigger fold

export function buildFoldedItems(items, expandedFolds) {
  const result = [];
  let foldId = 0;
  let i = 0;
  while (i < items.length) {
    if (items[i].type === 'eq') {
      const eqStart = i;
      while (i < items.length && items[i].type === 'eq') i++;
      const eqLen = i - eqStart;
      const hiddenCount = eqLen - 2 * CONTEXT_LINES;
      if (eqLen >= FOLD_THRESHOLD && hiddenCount > 0) {
        const currentFoldId = foldId++;
        if (expandedFolds.has(currentFoldId)) {
          // Expanded: before context + collapse marker + revealed hidden lines + after context
          for (let k = eqStart; k < eqStart + CONTEXT_LINES; k++) result.push(items[k]);
          result.push({ type: 'fold', foldId: currentFoldId, count: hiddenCount, expanded: true });
          for (let k = eqStart + CONTEXT_LINES; k < i - CONTEXT_LINES; k++) result.push({ ...items[k], _revealed: true });
          for (let k = i - CONTEXT_LINES; k < i; k++) result.push(items[k]);
        } else {
          // Collapsed: before context (last faded) + fold + after context (first faded)
          for (let k = eqStart; k < eqStart + CONTEXT_LINES - 1; k++) result.push(items[k]);
          result.push({ ...items[eqStart + CONTEXT_LINES - 1], _fade: true });
          result.push({ type: 'fold', foldId: currentFoldId, count: hiddenCount });
          result.push({ ...items[i - CONTEXT_LINES], _fade: true });
          for (let k = i - CONTEXT_LINES + 1; k < i; k++) result.push(items[k]);
        }
      } else {
        for (let k = eqStart; k < i; k++) result.push(items[k]);
      }
    } else {
      result.push(items[i]);
      i++;
    }
  }
  return result;
}

export function DiffViewer({ originalContent, currentContent, fileName }) {
  const [diffMode, setDiffMode] = useState('unified'); // unified | split
  const [edits, setEdits] = useState([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [manualMode, setManualMode] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [expandedFolds, setExpandedFolds] = useState(new Set());
  const flagDiffFold = useFeatureFlag('diff-fold');
  const workerRef = useRef(null);
  const requestIdRef = useRef(0);

  // Threshold for large content (characters)
  const LARGE_CONTENT_THRESHOLD = 3000;
  const isLargeContent = (originalContent?.length || 0) > LARGE_CONTENT_THRESHOLD ||
                          (currentContent?.length || 0) > LARGE_CONTENT_THRESHOLD;

  // Initialize Web Worker
  useEffect(() => {
    workerRef.current = new Worker(new URL('../diffWorker.js', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e) => {
      const { id, type, edits: newEdits, progress: newProgress, error, canary } = e.data;

      // Only accept results from the latest request
      if (id !== requestIdRef.current) return;

      if (type === 'progress') {
        if (newEdits && newEdits.length > 0) {
          setEdits(prev => [...prev, ...newEdits]);
        }
        if (typeof newProgress === 'number') {
          setProgress(newProgress);
        }
      } else if (type === 'complete') {
        // Canary report logging
        if (canary) {
          canary.violations?.forEach(v => console.warn('[Canary]', id, v.code, v.message));
          canary.suspicious?.forEach(s => console.warn('[Canary:Suspicious]', id, s.code, s.message));
        }
        setIsCalculating(false);
        setNeedsRefresh(false);
        setProgress(100);
      } else if (type === 'error') {
        console.error('Diff Worker Error:', error);
        setIsCalculating(false);
      }
    };
    return () => workerRef.current?.terminate();
  }, []);

  // Auto-enable manual mode for large content
  useEffect(() => {
    if (isLargeContent && !manualMode) {
      setManualMode(true);
      setNeedsRefresh(true);
    }
  }, [isLargeContent]);

  // Mark as needing refresh when content changes in manual mode
  useEffect(() => {
    if (manualMode) {
      setNeedsRefresh(true);
    }
  }, [originalContent, currentContent]);

  // Debounce and send to worker (only in auto mode)
  useEffect(() => {
    if (manualMode) return; // Skip auto-update in manual mode

    const timer = setTimeout(() => {
      if (workerRef.current) {
        requestIdRef.current++;
        setIsCalculating(true);
        setEdits([]); // Reset edits for streaming
        setExpandedFolds(new Set());
        setProgress(0);
        workerRef.current.postMessage({
          id: requestIdRef.current,
          oldText: originalContent,
          newText: currentContent,
          flags: getAllFlags()
        });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [originalContent, currentContent, manualMode]);

  // Manual refresh function
  const triggerDiff = () => {
    if (workerRef.current) {
      requestIdRef.current++;
      setIsCalculating(true);
      setEdits([]); // Reset edits for streaming
      setProgress(0);
      workerRef.current.postMessage({
        id: requestIdRef.current,
        oldText: originalContent,
        newText: currentContent,
        flags: getAllFlags()
      });
    }
  };

  const stats = useMemo(() => computeDiffStats(edits), [edits]);

  const severityColor = stats.changeRatio <= 0.05 ? '#10b981' : stats.changeRatio <= 0.15 ? '#f59e0b' : stats.changeRatio <= 0.30 ? '#f97316' : '#ef4444';
  const severityLabel = stats.changeRatio <= 0.05 ? '微量修改' : stats.changeRatio <= 0.15 ? '適度修改' : stats.changeRatio <= 0.30 ? '大幅修改' : '重大變更';
  const severityBg = stats.changeRatio <= 0.05 ? '#ecfdf5' : stats.changeRatio <= 0.15 ? '#fffbeb' : stats.changeRatio <= 0.30 ? '#fff7ed' : '#fef2f2';

  const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Inline word diff for changed line pairs
  const wordDiff = (oldStr, newStr) => {
    const oldWords = (oldStr || '').split(/(\s+)/);
    const newWords = (newStr || '').split(/(\s+)/);
    // Simple LCS-based word highlighting
    const oldHtml = [], newHtml = [];
    let oi = 0, ni = 0;
    // Build sets for quick lookup
    const newSet = new Set(newWords);
    const oldSet = new Set(oldWords);
    oldWords.forEach(w => {
      if (newSet.has(w)) oldHtml.push(esc(w));
      else oldHtml.push('<span class="diff-word-del">' + esc(w) + '</span>');
    });
    newWords.forEach(w => {
      if (oldSet.has(w)) newHtml.push(esc(w));
      else newHtml.push('<span class="diff-word-add">' + esc(w) + '</span>');
    });
    return { oldHtml: oldHtml.join(''), newHtml: newHtml.join('') };
  };

  // Build paired hunks for split view - memoized for performance
  const pairs = useMemo(() => {
    const result = [];
    let i = 0;
    while (i < edits.length) {
      if (edits[i].type === 'eq') {
        result.push({ type: 'eq', old: edits[i].oldLine, new: edits[i].newLine, oldIdx: edits[i].oldIdx, newIdx: edits[i].newIdx });
        i++;
      } else if (edits[i].type === 'modify') {
        // Modify → show as modify pair (old vs new, distinct from del/add)
        result.push({
          type: 'modify',
          old: edits[i].oldLine,
          new: edits[i].newLine,
          oldIdx: edits[i].oldIdx,
          newIdx: edits[i].newIdx,
        });
        i++;
      } else {
        // Collect consecutive del/add as a "change" group
        const dels = [], adds = [];
        while (i < edits.length && edits[i].type === 'del') { dels.push(edits[i]); i++; }
        while (i < edits.length && edits[i].type === 'add') { adds.push(edits[i]); i++; }
        const max = Math.max(dels.length, adds.length);
        for (let j = 0; j < max; j++) {
          result.push({
            type: 'change',
            old: j < dels.length ? dels[j].oldLine : null,
            new: j < adds.length ? adds[j].newLine : null,
            oldIdx: j < dels.length ? dels[j].oldIdx : null,
            newIdx: j < adds.length ? adds[j].newIdx : null,
          });
        }
      }
    }
    return result;
  }, [edits]);

  // Fold consecutive unchanged lines
  const handleExpandFold = useCallback((foldId) => {
    setExpandedFolds(prev => {
      const next = new Set(prev);
      if (next.has(foldId)) next.delete(foldId); else next.add(foldId);
      return next;
    });
  }, []);
  const foldedEdits = useMemo(() => {
    if (diffMode !== 'unified') return [];
    return flagDiffFold ? buildFoldedItems(edits, expandedFolds) : edits;
  }, [edits, expandedFolds, diffMode, flagDiffFold]);
  const foldedPairs = useMemo(() => {
    if (diffMode !== 'split') return [];
    return flagDiffFold ? buildFoldedItems(pairs, expandedFolds) : pairs;
  }, [pairs, expandedFolds, diffMode, flagDiffFold]);

  const isIdentical = stats.changed === 0;
  const actualOldLines = useMemo(() => originalContent ? originalContent.split('\n').length : 0, [originalContent]);

  return (
    <div className="diff-viewer">
      {/* Stats bar */}
      <div className="diff-stats">
        <div className="diff-stats-left">
          <div className="diff-severity" style={{ background: severityBg, color: severityColor, borderColor: severityColor + '44' }}>
            <span className="diff-severity-dot" style={{ background: severityColor }} />
            {severityLabel}
          </div>
          <span className="diff-stat-num" style={{ color: '#10b981' }}>+{stats.added}</span>
          <span className="diff-stat-num" style={{ color: '#ef4444' }}>−{stats.deleted}</span>
          {stats.modified > 0 && <span className="diff-stat-num" style={{ color: '#f59e0b' }}>~{stats.modified} 修改</span>}
          <span className="diff-stat-num" style={{ color: '#6b7280' }}>{stats.unchanged} 未變</span>
          <span className="diff-stat-base" title="原始文件行數">原始 {actualOldLines} 行</span>
        </div>
        <div className="diff-stats-right">
          {/* Change ratio bar */}
          <div className="diff-ratio-wrap" title={'(+' + stats.added + ' −' + stats.deleted + ') / 原始 ' + actualOldLines + ' 行 = ' + (stats.changeRatio * 100).toFixed(1) + '% (上限100%)'}>
            <div className="diff-ratio-label">變更幅度</div>
            <div className="diff-ratio-bar">
              <div className="diff-ratio-fill" style={{ width: Math.min(stats.changeRatio * 100, 100) + '%', background: severityColor }} />
              <div className="diff-ratio-marks">
                <span style={{ left: '5%' }} /><span style={{ left: '15%' }} /><span style={{ left: '30%' }} />
              </div>
            </div>
            <div className="diff-ratio-pct" style={{ color: severityColor }}>{(stats.changeRatio * 100).toFixed(1)}%{stats.changeRatio > 1 && <AlertTriangle className="w-3.5 h-3.5 inline ml-1 -mt-0.5" />}</div>
          </div>
          <div className="flex bg-gray-100 rounded-lg p-0.5 ml-3">
            <button onClick={() => setDiffMode('unified')} className={'px-2 py-0.5 text-xs rounded font-medium ' + (diffMode === 'unified' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500')}>統一</button>
            <button onClick={() => setDiffMode('split')} className={'px-2 py-0.5 text-xs rounded font-medium ' + (diffMode === 'split' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500')}>並排</button>
          </div>
        </div>
      </div>

      {/* Large content warning - shows even when identical */}
      {manualMode && (
        <div style={{
          padding: '10px 16px',
          background: 'linear-gradient(90deg, #fef3c7, #fde68a)',
          borderBottom: '1px solid #fcd34d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>⚡</span>
            <div>
              <div style={{ color: '#92400e', fontSize: '13px', fontWeight: 600 }}>
                大型內容模式（&gt;3000 字元）
              </div>
              <div style={{ color: '#a16207', fontSize: '11px' }}>
                為確保編輯流暢，需手動點擊「更新比對」來刷新差異顯示
              </div>
            </div>
          </div>
          <button
            onClick={triggerDiff}
            disabled={isCalculating}
            style={{
              padding: '6px 16px',
              fontSize: '12px',
              background: needsRefresh ? '#3b82f6' : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: isCalculating ? 'not-allowed' : 'pointer',
              opacity: isCalculating ? 0.5 : 1,
              fontWeight: 600,
              whiteSpace: 'nowrap'
            }}
          >
            {isCalculating ? '⏳ 計算中...' : needsRefresh ? '🔄 更新比對' : '✓ 已是最新'}
          </button>
        </div>
      )}

      {isIdentical ? (
        <div className="diff-identical">
          <CheckCircle2 style={{ width: 28, height: 28, color: '#10b981' }} />
          <span>文件內容與原始版本完全一致</span>
        </div>
      ) : (
        <VirtualDiffList
          items={diffMode === 'unified' ? foldedEdits : foldedPairs}
          mode={diffMode}
          isCalculating={isCalculating}
          manualMode={manualMode}
          needsRefresh={needsRefresh}
          onRefresh={triggerDiff}
          onExpandFold={handleExpandFold}
        />
      )}

      {/* Legend */}
      {!isIdentical && (
        <div className="diff-legend">
          <span className="diff-legend-item"><span className="diff-legend-swatch swatch-add" />++ 新增行</span>
          <span className="diff-legend-item"><span className="diff-legend-swatch swatch-del" />−− 刪除行</span>
          <span className="diff-legend-item"><span className="diff-legend-swatch swatch-mod" />~~ 微調行</span>
          <span className="diff-legend-item diff-legend-tip">💡 變更幅度 = (新增 + 刪除) ÷ 原始行數,上限 100%</span>
        </div>
      )}
    </div>
  );
}
