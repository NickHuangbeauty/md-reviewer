// Block rendering & editing components — extracted from MdReviewer.jsx (Phase 2 refactor).
// Covers: Mermaid live editor + render queue, HTML contentEditable, and the
// per-block InlineBlock (preview / edit dispatch). Behavior copied verbatim.
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { AlertCircle, Check, GripVertical } from 'lucide-react';
import { parseMdTableToGrid, parseHtmlTableToGrid } from '../lib/table.js';
import { InlineTableEditor } from './TableEditor.jsx';
import { FloatingToolbar, SlashMenu, BlockHandleMenu } from './EditorMenus.jsx';
import renderMathInElement from 'katex/contrib/auto-render';

/* ===== MERMAID LIVE EDITOR ===== */

/* Extract node IDs from a single Mermaid source line */
export function extractNodeIdsFromLine(line) {
  const ids = new Set();
  const t = line.trim();
  if (!t || /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|gantt|pie|erDiagram|gitGraph|journey)/i.test(t)
    || /^(title|section|dateFormat|axisFormat|%%)/i.test(t)
    || /^(subgraph|end$)/i.test(t)
    || /^\s*style\s/i.test(t)
    || /^\s*class\s/i.test(t)
    || /^\s*linkStyle\s/i.test(t)) return ids;

  // Flowchart: A[text] --> B{text} --- C((text)) etc.
  const flowRe = /\b([A-Za-z_][\w]*)\s*(?:[\[({]|-->|---|\.-|==>|--?>|<--|~~>|o--|x--|&)/g;
  let m;
  while ((m = flowRe.exec(t)) !== null) ids.add(m[1]);
  // Trailing node after last arrow: ... --> B or ... --> B[text]
  const trailingRe = /(?:-->|---|\.-|==>|--?>|~~>)\s*\|?[^|]*\|?\s*([A-Za-z_][\w]*)/g;
  while ((m = trailingRe.exec(t)) !== null) ids.add(m[1]);
  // Simple bare references: A --> B (no brackets)
  const simpleRe = /\b([A-Za-z_][\w]*)\b/g;
  if (!ids.size) { while ((m = simpleRe.exec(t)) !== null) ids.add(m[1]); }

  // Sequence diagram: Alice->>Bob: msg
  const seqRe = /\b([A-Za-z_][\w]*)\s*(?:->>|-->>|->|-->|-)(?:>|>>)?\s*(?:\+|-)?\s*([A-Za-z_][\w]*)/;
  const seqM = t.match(seqRe);
  if (seqM) { ids.add(seqM[1]); ids.add(seqM[2]); }
  const partM = t.match(/^\s*(?:participant|actor)\s+(\S+)/i);
  if (partM) ids.add(partM[1]);

  // Pie chart: "Label" : value
  const pieRe = /^\s*"([^"]+)"\s*:/;
  const pieM = t.match(pieRe);
  if (pieM) ids.add(pieM[1]);

  // Clean out common false-positive keywords
  ['TD', 'TB', 'BT', 'RL', 'LR', 'BR', 'px', 'fill', 'stroke', 'color', 'width',
   'height', 'Note', 'note', 'over', 'left', 'right', 'of', 'loop', 'alt', 'opt',
   'par', 'critical', 'break', 'rect', 'activate', 'deactivate'].forEach(w => ids.delete(w));
  return ids;
}

/* Find all SVG <g> nodes whose id contains a given nodeId */
export function findSvgNodesById(svgEl, nodeId) {
  if (!svgEl) return [];
  const found = [];
  const re = new RegExp('(^|[-_])' + nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([-_]|$)');
  svgEl.querySelectorAll('g[id]').forEach(g => {
    const gid = g.getAttribute('id') || '';
    if (gid === nodeId || re.test(gid)) found.push(g);
  });
  if (!found.length) {
    svgEl.querySelectorAll('.node, .actor, .task, [class*="node"]').forEach(n => {
      if ((n.textContent || '').trim() === nodeId) found.push(n);
    });
  }
  if (!found.length) {
    svgEl.querySelectorAll('text').forEach(t => {
      if (t.textContent?.trim() === nodeId && t.closest('g')) found.push(t.closest('g'));
    });
  }
  return found;
}

export function MermaidEditor({ initialCode, onSave, onCancel }) {
  const [code, setCode] = useState(initialCode);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [hlNodes, setHlNodes] = useState([]);
  const [cursorLine, setCursorLine] = useState(-1);
  const taRef = useRef(null);
  const wrapRef = useRef(null);
  const previewRef = useRef(null);
  const renderTimer = useRef(null);
  const codeRef = useRef(code);
  codeRef.current = code;

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        onSave('```mermaid\n' + codeRef.current + '\n```');
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 100);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [onSave]);

  const activeEntry = useRef(null);
  const doRender = useCallback((src) => {
    if (!window.mermaid || !src.trim()) { setSvg(''); return; }
    clearTimeout(renderTimer.current);
    renderTimer.current = setTimeout(() => {
      if (activeEntry.current) activeEntry.current.cancelled = true;
      const id = 'mme-' + Date.now();
      const entry = enqueueMermaidRender(id, src.trim());
      activeEntry.current = entry;
      const safeId = 'mme-safe-' + Date.now();
      entry.promise.then(({ svg: s }) => {
        if (!entry.cancelled) { setSvg(s.replaceAll(id, safeId)); setError(''); }
      }).catch((err) => {
        if (!entry.cancelled) setError(String(err?.message || err).slice(0, MM_ERR_MAX));
      });
    }, 400);
  }, []);

  useEffect(() => { doRender(code); }, [code, doRender]);
  useEffect(() => {
    if (taRef.current) taRef.current.focus();
    return () => { clearTimeout(renderTimer.current); if (activeEntry.current) activeEntry.current.cancelled = true; };
  }, []);

  /* ---- Code→SVG highlight engine ---- */
  const updateHighlight = useCallback(() => {
    const ta = taRef.current;
    const container = previewRef.current;
    if (!ta || !container || !svg) { setHlNodes([]); setCursorLine(-1); return; }

    const pos = ta.selectionStart;
    const lineIdx = ta.value.substring(0, pos).split('\n').length - 1;
    const lines = ta.value.split('\n');
    const currentLine = lines[lineIdx] || '';
    setCursorLine(lineIdx);

    const nodeIds = extractNodeIdsFromLine(currentLine);
    if (!nodeIds.size) { setHlNodes([]); return; }

    const svgEl = container.querySelector('svg');
    if (!svgEl) { setHlNodes([]); return; }

    const areaEl = container.querySelector('.mm-preview-area');
    const areaRect = areaEl ? areaEl.getBoundingClientRect() : container.getBoundingClientRect();
    const scrollLeft = areaEl ? areaEl.scrollLeft : 0;
    const scrollTop = areaEl ? areaEl.scrollTop : 0;
    const highlights = [];

    nodeIds.forEach(nid => {
      findSvgNodesById(svgEl, nid).forEach(g => {
        const bbox = g.getBoundingClientRect();
        highlights.push({
          id: nid + '-' + highlights.length,
          x: bbox.left - areaRect.left + scrollLeft + bbox.width / 2,
          y: bbox.top - areaRect.top + scrollTop + bbox.height / 2,
          w: bbox.width,
          h: bbox.height,
          left: bbox.left - areaRect.left + scrollLeft,
          top: bbox.top - areaRect.top + scrollTop,
        });
      });
    });

    setHlNodes(highlights);

    // Auto-scroll preview to first highlighted node
    if (highlights.length && areaEl) {
      const first = highlights[0];
      const areaH = areaEl.clientHeight;
      const areaW = areaEl.clientWidth;
      if (first.top < areaEl.scrollTop || first.top > areaEl.scrollTop + areaH - 40) {
        areaEl.scrollTo({ top: Math.max(0, first.top - areaH / 2), behavior: 'smooth' });
      }
      if (first.left < areaEl.scrollLeft || first.left > areaEl.scrollLeft + areaW - 40) {
        areaEl.scrollTo({ left: Math.max(0, first.left - areaW / 2), behavior: 'smooth' });
      }
    }
  }, [svg]);

  const clearHighlight = useCallback(() => { setHlNodes([]); setCursorLine(-1); }, []);

  const codeLines = code.split('\n');

  return (
    <div className="mm-editor" ref={wrapRef}>
      <div className="mm-editor-header">
        <span className="mm-editor-badge">◆ Mermaid 即時編輯</span>
        <div className="mm-editor-header-right">
          {hlNodes.length > 0 && <span className="mm-hl-indicator"><span className="mm-hl-dot"/>定位 {hlNodes.length} 個節點</span>}
          <div className="mm-editor-actions">
            <button onClick={onCancel} className="te-btn te-cancel">取消</button>
            <button onClick={() => onSave('```mermaid\n' + code + '\n```')} className="te-btn te-save">
              <Check style={{ width: 12, height: 12 }} /> 儲存
            </button>
          </div>
        </div>
      </div>
      <div className="mm-editor-body">
        <div className="mm-editor-code">
          <div className="mm-code-label">原始碼 — 游標行 → 預覽高亮</div>
          <div className="mm-code-wrap">
            <div className="mm-line-nums" aria-hidden="true">
              {codeLines.map((_, i) => (
                <div key={i} className={'mm-line-num' + (i === cursorLine ? ' mm-line-active' : '')}>{i + 1}</div>
              ))}
            </div>
            <textarea ref={taRef} value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') onSave('```mermaid\n' + code + '\n```'); }}
              onKeyUp={updateHighlight}
              onMouseUp={updateHighlight}
              onClick={updateHighlight}
              onBlur={clearHighlight}
              spellCheck={false} className="mm-code-input" />
          </div>
        </div>
        <div className="mm-editor-preview" ref={previewRef}>
          <div className="mm-preview-label">即時預覽</div>
          <div className={'mm-preview-area' + (hlNodes.length ? ' mm-has-hl' : '')}>
            {error ? (
              <div className="mm-preview-error"><AlertCircle style={{width:14,height:14}}/> {error}</div>
            ) : svg ? (
              <>
                <div className={'mm-preview-svg' + (hlNodes.length ? ' mm-svg-dimmed' : '')} dangerouslySetInnerHTML={{ __html: svg }} />
                {hlNodes.map(hl => (
                  <div key={hl.id} className="mm-hl-spot" style={{
                    left: hl.left - hl.w * 0.55,
                    top: hl.top - hl.h * 0.7,
                    width: hl.w * 2.1,
                    height: hl.h * 2.4,
                  }}/>
                ))}
              </>
            ) : (
              <div className="mm-preview-empty">輸入 Mermaid 語法以預覽圖表...</div>
            )}
          </div>
        </div>
      </div>
      <div className="mm-editor-hint">
        <span>✦ 游標移到程式碼行 → 自動高亮對應節點</span>
        <span className="mm-hint-sep">·</span>
        <span>Esc 儲存 · 點擊外部自動儲存</span>
      </div>
    </div>
  );
}

/* ===== Mermaid Render Queue (serialize to avoid concurrent render crashes) ===== */
const _mmQueue = [];
let _mmRunning = false;
export const MM_ERR_MAX = 160;
/** Remove Mermaid's temp DOM containers for a given render id */
export function cleanupMermaidDom(id) {
  try { document.getElementById(id)?.remove(); } catch {}
  try { document.getElementById('d' + id)?.remove(); } catch {}
}
/** Extract code body from a ```mermaid fenced block */
export function extractMermaidCode(raw) {
  return raw.replace(/^```mermaid\n/i, '').replace(/\n```$/, '').trim();
}
export function enqueueMermaidRender(id, code) {
  const entry = { id, code, resolve: null, reject: null, cancelled: false };
  entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
  _mmQueue.push(entry);
  _drainMmQueue();
  return entry;
}
async function _drainMmQueue() {
  if (_mmRunning || !_mmQueue.length) return;
  _mmRunning = true;
  try {
    while (_mmQueue.length) {
      const entry = _mmQueue.shift();
      if (entry.cancelled) { entry.reject(new Error('cancelled')); continue; }
      try {
        await new Promise(r => requestAnimationFrame(r));
        const result = await window.mermaid.render(entry.id, entry.code);
        cleanupMermaidDom(entry.id);
        entry.resolve(result);
      } catch (err) {
        cleanupMermaidDom(entry.id);
        entry.reject(err);
      }
    }
  } finally {
    _mmRunning = false;
  }
}

/* ===== HTML CONTENT EDITABLE ===== */
export function HtmlContentEditable({ html, onSave, onCancel }) {
  const ref = useRef(null);
  const cancelRequestedRef = useRef(false);
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = html;
      ref.current.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const handleBlur = (e) => {
    if (cancelRequestedRef.current) {
      cancelRequestedRef.current = false;
      return;
    }
    onSave(e.currentTarget.innerHTML);
  };
  return (
    <div>
      <div style={{fontSize:'11px',color:'var(--text3)',marginBottom:'6px'}}>
        點擊文字直接編輯 · 按外面儲存
      </div>
      <div ref={ref}
        contentEditable
        suppressContentEditableWarning
        className="pv"
        onBlur={handleBlur}
        style={{ border: '2px solid var(--accent2)', borderRadius: '4px', padding: '12px', minHeight: '40px', outline: 'none' }}
      />
      <button className="te-btn te-cancel" style={{marginTop:'6px',fontSize:'11px'}}
        onMouseDown={() => { cancelRequestedRef.current = true; }}
        onClick={onCancel}>取消</button>
    </div>
  );
}

/* ===== INLINE BLOCK ===== */
export function InlineBlock({ blockId, blockIdx, totalBlocks, raw, html, isEditing, marks, onStartEdit, onFinishEdit, onMark, onBlockAction, mermaidReady, mermaidThemeVer }) {
  const textareaRef = useRef(null);
  const previewRef = useRef(null);
  const mouseDownRef = useRef(null);
  const [editText, setEditText] = useState(raw);
  const [slashMenu, setSlashMenu] = useState(null);
  const [handleMenu, setHandleMenu] = useState(null);
  const [hovered, setHovered] = useState(false);
  const [mermaidSvg, setMermaidSvg] = useState(null);
  const [mermaidErr, setMermaidErr] = useState(null);
  const blockMarks = marks.filter(m => m.blockId === blockId);
  const hasMark = blockMarks.length > 0;
  const isHtmlTable = /<table/i.test(raw);
  const isMermaid = /^```mermaid\n/i.test(raw);
  const isStyleBlock = /^<style[\s>]/i.test(raw.trim());
  const mdGrid = useMemo(() => !isHtmlTable ? parseMdTableToGrid(raw) : null, [raw, isHtmlTable]);
  const htmlGrid = useMemo(() => isHtmlTable ? parseHtmlTableToGrid(raw) : null, [raw, isHtmlTable]);

  const isSpacer = /^<!--\s*spacer\s*-->$/.test(raw.trim());
  useEffect(() => { setEditText(isSpacer ? '' : raw); }, [raw, isSpacer]);
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [isEditing]);

  // Mermaid rendering — save SVG to state so re-renders don't lose it
  useEffect(() => { if (isMermaid) { setMermaidSvg(null); setMermaidErr(null); } }, [raw, mermaidThemeVer]);
  useEffect(() => {
    if (!isEditing && isMermaid && !mermaidSvg && !mermaidErr && mermaidReady && window.mermaid) {
      const code = extractMermaidCode(raw);
      if (!code) return;
      const id = 'mm-' + blockId.replace(/[^a-zA-Z0-9]/g, '') + '-' + Date.now();
      const entry = enqueueMermaidRender(id, code);
      const safeId = 'mmv-' + blockId.replace(/[^a-zA-Z0-9]/g, '');
      entry.promise.then(({ svg }) => {
        if (!entry.cancelled) setMermaidSvg(svg.replaceAll(id, safeId));
      }).catch((err) => {
        if (!entry.cancelled) {
          setMermaidErr(String(err?.message || err).slice(0, MM_ERR_MAX));
          cleanupMermaidDom(id);
        }
      });
      return () => { entry.cancelled = true; cleanupMermaidDom(id); };
    }
  }, [isEditing, isMermaid, mermaidSvg, mermaidErr, raw, blockId, mermaidReady, mermaidThemeVer]);

  // KaTeX math rendering — render $$...$$ and $...$ after DOM update
  useEffect(() => {
    if (isEditing || !previewRef.current) return;
    const pvEls = previewRef.current.querySelectorAll('.pv');
    pvEls.forEach(el => {
      renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
      });
    });
  }, [isEditing, html]);

  // Table scroll: measure container, set explicit width, sync custom scrollbar
  useEffect(() => {
    if (isEditing || !previewRef.current) return;
    const wraps = previewRef.current.querySelectorAll('.table-scroll-wrap');
    if (!wraps.length) return;
    const cleanups = [];
    wraps.forEach(wrap => {
      const inner = wrap.querySelector('.table-scroll-inner');
      const barWrap = wrap.querySelector('.tscroll-bar-wrap');
      const track = wrap.querySelector('.tscroll-track');
      const thumb = wrap.querySelector('.tscroll-thumb');
      if (!inner || !barWrap || !track || !thumb) return;

      const update = () => {
        // Force inner to have explicit width matching the wrap's available space
        const wrapW = wrap.clientWidth;
        inner.style.maxWidth = wrapW + 'px';

        const overflows = inner.scrollWidth > inner.clientWidth + 2;
        const canLeft = inner.scrollLeft > 2;
        const canRight = inner.scrollLeft + inner.clientWidth < inner.scrollWidth - 2;
        wrap.classList.toggle('shadow-left', canLeft);
        wrap.classList.toggle('shadow-right', canRight);
        barWrap.style.display = overflows ? '' : 'none';
        if (!overflows) return;
        const ratio = inner.clientWidth / inner.scrollWidth;
        const thumbW = Math.max(ratio * track.clientWidth, 36);
        const maxTravel = track.clientWidth - thumbW;
        const scrollMax = inner.scrollWidth - inner.clientWidth;
        const scrollRatio = scrollMax > 0 ? inner.scrollLeft / scrollMax : 0;
        thumb.style.width = thumbW + 'px';
        thumb.style.transform = 'translateX(' + (scrollRatio * maxTravel) + 'px)';
      };

      // Initial + scroll listener (double-rAF to ensure layout done)
      requestAnimationFrame(() => requestAnimationFrame(update));
      inner.addEventListener('scroll', update, { passive: true });

      // Drag the thumb
      let dragging = false, dragStartX = 0, dragStartScroll = 0;
      const onThumbDown = (e) => {
        e.preventDefault(); e.stopPropagation();
        dragging = true;
        dragStartX = e.clientX;
        dragStartScroll = inner.scrollLeft;
        thumb.classList.add('tscroll-active');
        document.body.style.userSelect = 'none';
      };
      const onThumbMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - dragStartX;
        const ratio = inner.clientWidth / inner.scrollWidth;
        const thumbW = Math.max(ratio * track.clientWidth, 36);
        const maxTravel = track.clientWidth - thumbW;
        const maxScroll = inner.scrollWidth - inner.clientWidth;
        if (maxTravel > 0) inner.scrollLeft = dragStartScroll + (dx / maxTravel) * maxScroll;
      };
      const onThumbUp = () => {
        if (!dragging) return;
        dragging = false;
        thumb.classList.remove('tscroll-active');
        document.body.style.userSelect = '';
      };
      thumb.addEventListener('mousedown', onThumbDown);
      document.addEventListener('mousemove', onThumbMove);
      document.addEventListener('mouseup', onThumbUp);

      // Click on track to jump
      const onTrackDown = (e) => {
        if (e.target === thumb) return;
        e.stopPropagation();
        const rect = track.getBoundingClientRect();
        const clickRatio = (e.clientX - rect.left) / rect.width;
        inner.scrollLeft = clickRatio * (inner.scrollWidth - inner.clientWidth);
      };
      track.addEventListener('mousedown', onTrackDown);

      const ro = new ResizeObserver(update);
      ro.observe(wrap);
      window.addEventListener('resize', update);
      cleanups.push(() => {
        inner.removeEventListener('scroll', update);
        thumb.removeEventListener('mousedown', onThumbDown);
        document.removeEventListener('mousemove', onThumbMove);
        document.removeEventListener('mouseup', onThumbUp);
        track.removeEventListener('mousedown', onTrackDown);
        window.removeEventListener('resize', update);
        ro.disconnect();
      });
    });
    return () => cleanups.forEach(fn => fn());
  }, [isEditing, html]);

  // Wrap selected text in textarea
  const wrapSelection = (pre, suf) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.substring(s, e);
    const newVal = value.substring(0, s) + pre + sel + suf + value.substring(e);
    setEditText(newVal);
    setTimeout(() => { ta.focus(); ta.selectionStart = s + pre.length; ta.selectionEnd = s + pre.length + sel.length; }, 10);
  };

  // Handle slash command in textarea
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (slashMenu) { setSlashMenu(null); return; }
      onFinishEdit(blockId, editText);
    }
    if (e.key === '/' && textareaRef.current) {
      const ta = textareaRef.current;
      const before = ta.value.substring(0, ta.selectionStart);
      const lastLine = before.split('\n').pop();
      if (lastLine.trim() === '') {
        e.preventDefault();
        const rect = ta.getBoundingClientRect();
        const lines = before.split('\n');
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
        setSlashMenu({
          x: rect.left + 12,
          y: rect.top + lines.length * lh + 4
        });
      }
    }
  };

  const handleSlashSelect = (insert) => {
    const ta = textareaRef.current;
    if (!ta) { setSlashMenu(null); return; }
    const { selectionStart: s, value } = ta;
    const newVal = value.substring(0, s) + insert + value.substring(s);
    setEditText(newVal);
    setSlashMenu(null);
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + insert.length; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }, 10);
  };

  const handleGrip = (e) => {
    e.stopPropagation(); e.preventDefault();
    setHandleMenu({ x: e.clientX - 10, y: e.clientY });
  };

  // Style blocks are locked — not editable, hidden in preview
  if (isStyleBlock) {
    return null; // Hide style blocks from the editor view entirely
  }

  if (isEditing) {
    // MD table → grid editor (output as MD)
    if (mdGrid && mdGrid.length) {
      return (
        <div className="block-wrapper">
          <InlineTableEditor grid={mdGrid} outputFormat="md"
            onSave={(newText) => onFinishEdit(blockId, newText)}
            onCancel={() => onFinishEdit(blockId, raw)} />
        </div>
      );
    }
    // HTML table → grid editor (output as HTML)
    if (htmlGrid && htmlGrid.length) {
      return (
        <div className="block-wrapper">
          <InlineTableEditor grid={htmlGrid} outputFormat="html"
            onSave={(newText) => onFinishEdit(blockId, newText)}
            onCancel={() => onFinishEdit(blockId, raw)} />
        </div>
      );
    }
    // Mermaid → live split editor
    if (isMermaid) {
      const mermaidCode = extractMermaidCode(raw);
      return (
        <div className="block-wrapper">
          <MermaidEditor initialCode={mermaidCode}
            onSave={(newText) => onFinishEdit(blockId, newText)}
            onCancel={() => onFinishEdit(blockId, raw)} />
        </div>
      );
    }
    // HTML blocks: show rendered preview with contentEditable for text-only editing
    // Note: contentEditable is used on user-authored content within this review tool
    const isHtmlBlock = /^<(?:div|p|h[1-6]|section|article|header|footer|nav|ul|ol|dl|blockquote|figure|details)/i.test(raw.trim());
    if (isHtmlBlock && !isStyleBlock) {
      return (
        <div className="block-wrapper">
          <div className="edit-block html-visual-edit">
            <div style={{fontSize:'11px',color:'#999',marginBottom:'6px'}}>點擊文字直接編輯 · 按外面儲存 · 按「原始碼」看 HTML</div>
            <HtmlContentEditable
              html={html}
              onSave={(editedHtml) => onFinishEdit(blockId, editedHtml)}
              onCancel={() => onFinishEdit(blockId, raw)}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="block-wrapper">
        <div className="edit-block">
          <FloatingToolbar textareaRef={textareaRef} editText={editText} onWrap={wrapSelection} />
          <textarea ref={textareaRef} value={editText}
            onChange={e => { setEditText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
            onBlur={() => { if (!slashMenu) onFinishEdit(blockId, editText.trim() ? editText : '<!-- spacer -->'); }}
            onKeyDown={handleKeyDown}
            spellCheck={false} />
          {slashMenu && <SlashMenu position={slashMenu} onSelect={handleSlashSelect} onClose={() => setSlashMenu(null)} />}
        </div>
      </div>
    );
  }

  // Smart click detection — don't trigger edit when interacting with scroll bar
  const handlePreviewMouseDown = (e) => {
    if (e.target.closest('.tscroll-track') || e.target.closest('.tscroll-thumb')) {
      return; // Don't track for custom scrollbar
    }
    mouseDownRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  };
  const handlePreviewMouseUp = (e) => {
    if (!mouseDownRef.current) return;
    const dx = Math.abs(e.clientX - mouseDownRef.current.x);
    const dy = Math.abs(e.clientY - mouseDownRef.current.y);
    const dt = Date.now() - mouseDownRef.current.time;
    mouseDownRef.current = null;
    // Only trigger edit if it's a real click (small movement, short time)
    if (dx < 5 && dy < 5 && dt < 400) {
      onStartEdit(blockId);
    }
  };

  return (
    <div id={blockId} className={'block-wrapper' + (hovered ? ' bw-hover' : '')}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setHandleMenu(null); }}>
      {/* Grip handle */}
      <div className={'block-grip' + (hovered ? ' grip-show' : '')}
        onMouseDown={handleGrip} title="拖動 / 更多操作">
        <GripVertical style={{ width: 14, height: 14 }} />
      </div>
      <div className={'preview-block' + (hasMark ? ' marked' : '')}
        ref={previewRef}
        onMouseDown={handlePreviewMouseDown}
        onMouseUp={handlePreviewMouseUp}
        onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); onMark(blockId, e); }}>
        {isMermaid ? (
          <div className="pv">
            <div dangerouslySetInnerHTML={{ __html: html }} />
            {mermaidSvg ? (
              <div className="mermaid-body mermaid-rendered">
                <div className="mermaid-svg-wrap" dangerouslySetInnerHTML={{ __html: mermaidSvg }} />
              </div>
            ) : mermaidErr ? (
              <div className="mermaid-body mermaid-error">
                <div className="mm-err-icon">{'\u26A0'} </div>
                <div className="mm-err-title">Mermaid 語法錯誤</div>
                <div className="mm-err-msg">{mermaidErr}</div>
                <div className="mm-err-hint">點擊此區塊編輯修正語法</div>
              </div>
            ) : (
              <div className="mermaid-body mermaid-loading">
                <div style={{textAlign:'center',padding:'20px',color:'#999'}}>
                  <div style={{fontSize:'24px',marginBottom:'8px'}}>⏳</div>
                  <div>Mermaid 渲染中...</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="pv" dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {hasMark && (
          <div className="mark-badge" onClick={(e) => { e.stopPropagation(); onMark(blockId, e); }}>
            <AlertCircle style={{ width: 12, height: 12 }} /> {blockMarks.length}
          </div>
        )}
      </div>
      {handleMenu && <BlockHandleMenu position={handleMenu}
        onAction={(action) => onBlockAction(blockId, blockIdx, action)}
        onClose={() => setHandleMenu(null)} />}
    </div>
  );
}
