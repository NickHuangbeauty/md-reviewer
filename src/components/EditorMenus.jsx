import React, { useState, useEffect, useRef } from 'react';
import {
  Bold, Italic, Strikethrough, Code, Link,
  Heading1, Heading2, Heading3, List, Quote, Minus, Table,
  Plus, Trash2, Copy, ArrowUp, ArrowDown, Type,
} from 'lucide-react';

/* ===== FLOATING TOOLBAR ===== */
export function FloatingToolbar({ textareaRef, editText, onWrap }) {
  const [pos, setPos] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const check = () => {
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        const el = textareaRef.current;
        const s = el.selectionStart, e = el.selectionEnd;
        if (s !== e) {
          const rect = el.getBoundingClientRect();
          const val = el.value.substring(0, s);
          const linesBefore = val.split('\n').length;
          const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
          const padTop = parseFloat(getComputedStyle(el).paddingTop) || 10;
          const scrollTop = el.scrollTop;
          const yOff = padTop + (linesBefore - 1) * lh - scrollTop;
          setPos({ x: rect.left + 60, y: rect.top + Math.max(0, Math.min(yOff - 42, rect.height - 50)) });
          setVisible(true);
        } else {
          setVisible(false);
        }
      });
    };
    ta.addEventListener('mouseup', check);
    ta.addEventListener('keyup', check);
    ta.addEventListener('focus', check);
    return () => { ta.removeEventListener('mouseup', check); ta.removeEventListener('keyup', check); ta.removeEventListener('focus', check); };
  }, [textareaRef, editText]);

  if (!visible || !pos) return null;

  const tools = [
    { icon: Bold, label: 'ç²—é«" B', pre: '**', suf: '**' },
    { icon: Italic, label: '斜體 I', pre: '*', suf: '*' },
    { icon: Strikethrough, label: '刪除線', pre: '~~', suf: '~~' },
    { icon: Code, label: '行內程式碼', pre: '`', suf: '`' },
    { icon: Link, label: '連結', pre: '[', suf: '](url)' },
  ];

  return (
    <div className="float-toolbar" style={{ left: Math.min(pos.x, window.innerWidth - 220), top: Math.max(pos.y, 4) }}>
      {tools.map((t, i) => (
        <button key={i} className="ft-btn" title={t.label}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onWrap(t.pre, t.suf); setVisible(false); }}>
          <t.icon style={{ width: 14, height: 14 }} />
        </button>
      ))}
    </div>
  );
}

/* ===== SLASH COMMAND MENU ===== */
export function SlashMenu({ position, onSelect, onClose }) {
  const [filter, setFilter] = useState('');
  const [codeSubMenu, setCodeSubMenu] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  const codeLangs = [
    { id: 'js', label: 'JavaScript', icon: '🟨', insert: '```javascript\n\n```' },
    { id: 'py', label: 'Python', icon: '🐍', insert: '```python\n\n```' },
    { id: 'mermaid', label: 'Mermaid 圖表', icon: '◆', insert: '```mermaid\ngraph TD\n  A[開始] --> B{判斷}\n  B -->|是| C[結果A]\n  B -->|否| D[結果B]\n```' },
    { id: 'sql', label: 'SQL', icon: '🗃', insert: '```sql\n\n```' },
    { id: 'html', label: 'HTML', icon: '🌐', insert: '```html\n\n```' },
    { id: 'css', label: 'CSS', icon: '🎨', insert: '```css\n\n```' },
    { id: 'bash', label: 'Bash', icon: '⬛', insert: '```bash\n\n```' },
    { id: 'json', label: 'JSON', icon: '{}', insert: '```json\n\n```' },
    { id: 'plain', label: '純文字', icon: '📄', insert: '```\n\n```' },
  ];

  const commands = [
    { id: 'h1', icon: Heading1, label: '標題 1', desc: '大標題', insert: '# ' },
    { id: 'h2', icon: Heading2, label: '標題 2', desc: '中標題', insert: '## ' },
    { id: 'h3', icon: Heading3, label: '標題 3', desc: '小標題', insert: '### ' },
    { id: 'h4', icon: Heading3, label: '標題 4', desc: '段落標題', insert: '#### ' },
    { id: 'h5', icon: Heading3, label: '標題 5', desc: '次段落標題', insert: '##### ' },
    { id: 'list', icon: List, label: '無序列表', desc: '項目符號列表', insert: '- ' },
    { id: 'quote', icon: Quote, label: '引用', desc: '引用區塊', insert: '> ' },
    { id: 'code', icon: Code, label: '程式碼區塊', desc: '選擇語言...', insert: null, hasSubmenu: true },
    { id: 'hr', icon: Minus, label: '分隔線', desc: '水平分隔', insert: '---' },
    { id: 'table', icon: Table, label: '表格', desc: '插入表格', insert: '| 欄位1 | 欄位2 | 欄位3 |\n|---|---|---|\n| 內容 | 內容 | 內容 |' },
    { id: 'bold', icon: Bold, label: '粗體', desc: '粗體文字', insert: '**粗體文字**' },
    { id: 'italic', icon: Italic, label: '斜體', desc: '斜體文字', insert: '*斜體文字*' },
  ];

  const filtered = commands.filter(c =>
    !filter || c.label.includes(filter) || c.desc.includes(filter) || c.id.includes(filter.toLowerCase())
  );

  const filteredLangs = codeLangs.filter(l =>
    !filter || l.label.toLowerCase().includes(filter.toLowerCase()) || l.id.includes(filter.toLowerCase())
  );

  return (
    <div ref={ref} className="slash-menu" style={{ left: Math.min(position.x, window.innerWidth - 280), top: Math.min(position.y, window.innerHeight - 350) }}>
      <div className="slash-header">
        {codeSubMenu && (
          <button className="slash-back" onClick={() => setCodeSubMenu(false)}>
            ← 返回
          </button>
        )}
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={codeSubMenu ? '搜尋語言...' : '搜尋指令...'}
          className="slash-search"
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Escape') { if (codeSubMenu) setCodeSubMenu(false); else onClose(); }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (codeSubMenu && filteredLangs.length) { onSelect(filteredLangs[0].insert); }
              else if (!codeSubMenu && filtered.length) {
                if (filtered[0].hasSubmenu) setCodeSubMenu(true);
                else onSelect(filtered[0].insert);
              }
            }
          }}
        />
      </div>
      <div className="slash-list">
        {codeSubMenu ? (
          <>
            {filteredLangs.map(l => (
              <button key={l.id} className="slash-item"
                onClick={() => onSelect(l.insert)}>
                <div className="slash-icon slash-icon-lang">{l.icon}</div>
                <div><div className="slash-label">{l.label}</div><div className="slash-desc">{l.id === 'mermaid' ? '流程圖 / 序列圖 / 甘特圖' : '```' + l.id}</div></div>
              </button>
            ))}
            {!filteredLangs.length && <div className="slash-empty">找不到語言</div>}
          </>
        ) : (
          <>
            {filtered.map(c => (
              <button key={c.id} className="slash-item"
                onClick={() => {
                  if (c.hasSubmenu) { setCodeSubMenu(true); setFilter(''); }
                  else onSelect(c.insert);
                }}>
                <div className="slash-icon"><c.icon style={{ width: 16, height: 16 }} /></div>
                <div className="flex-1"><div className="slash-label">{c.label}</div><div className="slash-desc">{c.desc}</div></div>
                {c.hasSubmenu && <span className="slash-arrow">â–¸</span>}
              </button>
            ))}
            {!filtered.length && <div className="slash-empty">找不到指令</div>}
          </>
        )}
      </div>
    </div>
  );
}

/* ===== BLOCK HANDLE MENU ===== */
export function BlockHandleMenu({ position, onAction, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  const items = [
    { id: 'addAbove', icon: Plus, label: '上方插入空行', cls: 'text-blue-600' },
    { id: 'addBelow', icon: Plus, label: '下方插入空行', cls: 'text-blue-600' },
    { id: 'delete', icon: Trash2, label: '刪除區塊', cls: 'text-red-600' },
    { id: 'copy', icon: Copy, label: '複製內容', cls: 'text-gray-700' },
    { id: 'moveUp', icon: ArrowUp, label: '上移', cls: 'text-gray-700' },
    { id: 'moveDown', icon: ArrowDown, label: '下移', cls: 'text-gray-700' },
    { id: 'toH1', icon: Heading1, label: '轉為 H1', cls: 'text-gray-700' },
    { id: 'toH2', icon: Heading2, label: '轉為 H2', cls: 'text-gray-700' },
    { id: 'toH3', icon: Heading3, label: '轉為 H3', cls: 'text-gray-700' },
    { id: 'toH4', icon: Heading3, label: '轉為 H4', cls: 'text-gray-700' },
    { id: 'toH5', icon: Heading3, label: '轉為 H5', cls: 'text-gray-700' },
    { id: 'toList', icon: List, label: '轉為列表', cls: 'text-gray-700' },
    { id: 'toQuote', icon: Quote, label: '轉為引用', cls: 'text-gray-700' },
    { id: 'toPlain', icon: Type, label: '轉為段落', cls: 'text-gray-700' },
  ];

  return (
    <div ref={ref} className="handle-menu" style={{ left: Math.min(position.x, window.innerWidth - 200), top: Math.min(position.y, window.innerHeight - (items.length * 34 + 16)) }}>
      {items.map((it, i) => (
        <React.Fragment key={it.id}>
          {it.id === 'delete' && <div style={{height:1,background:'var(--border)',margin:'3px 6px'}}/>}
          <button className={'handle-item ' + it.cls}
            onClick={() => { onAction(it.id); onClose(); }}>
            <it.icon style={{ width: 14, height: 14 }} />
            <span>{it.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
