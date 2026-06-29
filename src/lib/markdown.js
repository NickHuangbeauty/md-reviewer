// Markdown block-splitting pure logic — extracted from MdReviewer.jsx (Phase 1 refactor)
// Splits a markdown/HTML document into renderable blocks (code fences, HTML
// tables/divs, MD tables, headings, lists, blockquotes, paragraphs). No React.
// Also holds markdown→HTML rendering pure functions (Phase 2 refactor):
// parseMarkdownTable, highlightCode, _scopeStyleBlock, parseBlockToHtml, formatMarkdown.
import { parseTableRow } from './table.js';

/* ===== MD BLOCK SPLITTER ===== */
export function splitMdBlocks(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks = [];
  let buf = [];
  let inHtmlTable = false;
  let inMdTable = false;
  let inCodeFence = false;
  let inHtmlDiv = false;

  const flush = () => {
    if (buf.length) {
      const raw = buf.join('\n');
      if (raw.trim()) blocks.push(raw);
      buf = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();

    // Code fence ``` ... ```
    if (t.startsWith('```')) {
      if (!inCodeFence) {
        flush(); inCodeFence = true; buf.push(l);
      } else {
        buf.push(l); inCodeFence = false; flush();
      }
      continue;
    }
    if (inCodeFence) { buf.push(l); continue; }

    // HTML table (track nesting depth)
    if (!inHtmlTable && /<table/i.test(t)) {
      flush(); inHtmlTable = true;
      let depth = (t.match(/<table/gi) || []).length - (t.match(/<\/table>/gi) || []).length;
      buf.push(l);
      if (depth <= 0) { inHtmlTable = false; flush(); }
      continue;
    }
    if (inHtmlTable) {
      buf.push(l);
      const opens = (t.match(/<table/gi) || []).length;
      const closes = (t.match(/<\/table>/gi) || []).length;
      // Check if we've closed all tables on this accumulated buffer
      const fullBuf = buf.join('\n');
      const totalOpens = (fullBuf.match(/<table/gi) || []).length;
      const totalCloses = (fullBuf.match(/<\/table>/gi) || []).length;
      if (totalCloses >= totalOpens) { inHtmlTable = false; flush(); }
      continue;
    }

    // HTML div block (track open/close)
    if (!inHtmlDiv && /^<div[\s>]/i.test(t)) {
      flush(); inHtmlDiv = true; buf.push(l);
      const fullBuf = buf.join('\n');
      if ((fullBuf.match(/<\/div>/gi) || []).length >= (fullBuf.match(/<div[\s>]/gi) || []).length) { inHtmlDiv = false; flush(); }
      continue;
    }
    if (inHtmlDiv) {
      buf.push(l);
      const fullBuf = buf.join('\n');
      if ((fullBuf.match(/<\/div>/gi) || []).length >= (fullBuf.match(/<div[\s>]/gi) || []).length) { inHtmlDiv = false; flush(); }
      continue;
    }

    // MD table
    if (t.startsWith('|') && t.includes('|')) {
      if (!inMdTable) { flush(); inMdTable = true; }
      buf.push(l); continue;
    } else if (inMdTable) { inMdTable = false; flush(); }

    if (/^#{1,6}\s/.test(t)) { flush(); buf.push(l); flush(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flush(); buf.push(l); flush(); continue; }
    if (!t) { flush(); continue; }
    if (/^[-*+] /.test(t) || /^\d+\.\s/.test(t)) {
      if (buf.length && !/^[-*+] /.test(buf[0].trim()) && !/^\d+\.\s/.test(buf[0].trim())) flush();
      buf.push(l); continue;
    }
    if (buf.length && (/^[-*+] /.test(buf[0].trim()) || /^\d+\.\s/.test(buf[0].trim()))) flush();
    // Blockquote >
    if (t.startsWith('>')) {
      if (buf.length && !buf[0].trim().startsWith('>')) flush();
      buf.push(l); continue;
    }
    if (buf.length && buf[0].trim().startsWith('>')) flush();
    buf.push(l);
  }
  flush();
  return blocks;
}

export function joinMdBlocks(blocks) { return blocks.join('\n\n'); }

/* ===== PARSERS ===== */
export function parseMarkdownTable(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2 || !lines[0].includes('|')) return null;
  const rows = []; let hdr = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|?[\s\-:]+\|[\s\-:|]+\|?$/.test(lines[i].trim())) { hdr = true; continue; }
    const cells = parseTableRow(lines[i]);
    if (cells.length) rows.push({ cells, isHeader: !hdr && i === 0 });
  }
  if (!rows.length) return null;
  const inlineMd = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code class="cd">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link">$1</a>');
  let h = '<table class="md-table">\n';
  rows.forEach(r => { h += '<tr>'; r.cells.forEach(c => { const t = r.isHeader ? 'th' : 'td'; h += `<${t}>${inlineMd(c)}</${t}>`; }); h += '</tr>\n'; });
  return h + '</table>';
}

// Token-based syntax highlighter - avoids regex conflicts
export function highlightCode(code, lang) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const l = (lang || '').toLowerCase();

  const JS_KW = new Set(['const','let','var','function','return','if','else','for','while','import','export','from','class','new','this','try','catch','throw','async','await','yield','switch','case','break','continue','default','typeof','instanceof','in','of','do','void','delete','with','finally','extends','super','static','get','set','true','false','null','undefined']);
  const PY_KW = new Set(['def','return','if','else','elif','for','while','import','from','class','try','except','finally','raise','pass','break','continue','yield','lambda','with','as','is','not','and','or','in','global','nonlocal','assert','del','True','False','None','self','async','await','print']);
  const SQL_KW = new Set(['SELECT','FROM','WHERE','INSERT','UPDATE','DELETE','CREATE','TABLE','ALTER','DROP','JOIN','LEFT','RIGHT','INNER','OUTER','ON','INTO','VALUES','SET','ORDER','BY','GROUP','HAVING','LIMIT','DISTINCT','UNION','AND','OR','NOT','NULL','INT','VARCHAR','TEXT','PRIMARY','KEY','INDEX','FOREIGN','REFERENCES','BEGIN','COMMIT','ROLLBACK']);
  const PY_BUILTINS = new Set(['range','len','str','int','float','list','dict','set','tuple','type','print','input','open','map','filter','zip','enumerate','sorted','reversed','sum','min','max','abs','round','isinstance','issubclass','super','property','staticmethod','classmethod','__init__','__str__','__repr__','__name__']);

  let KW;
  if (l === 'python' || l === 'py') KW = PY_KW;
  else if (l === 'sql') KW = SQL_KW;
  else KW = new Set([...JS_KW, ...PY_KW, ...SQL_KW]);

  const isPython = l === 'python' || l === 'py';

  const lines = code.split('\n');
  return lines.map(line => {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
      // Python decorator
      if (isPython && line[i] === '@' && (i === 0 || /\s/.test(line[i-1]))) {
        let j = i + 1;
        while (j < line.length && /\w/.test(line[j])) j++;
        tokens.push({ type: 'deco', text: line.slice(i, j) }); i = j; continue;
      }
      // Comment: // or # or --
      if ((line[i] === '/' && line[i+1] === '/') || (line[i] === '#' && (i === 0 || /[\s(]/.test(line[i-1]))) || (l === 'sql' && line[i] === '-' && line[i+1] === '-')) {
        tokens.push({ type: 'cmt', text: line.slice(i) }); break;
      }
      // Triple-quote string (python)
      if (isPython && ((line[i] === '"' && line[i+1] === '"' && line[i+2] === '"') || (line[i] === "'" && line[i+1] === "'" && line[i+2] === "'"))) {
        const q3 = line.slice(i, i+3);
        let j = i + 3;
        const end = line.indexOf(q3, j);
        if (end >= 0) j = end + 3; else j = line.length;
        tokens.push({ type: 'str', text: line.slice(i, j) }); i = j; continue;
      }
      // f-string prefix
      if (isPython && (line[i] === 'f' || line[i] === 'r' || line[i] === 'b') && (line[i+1] === '"' || line[i+1] === "'")) {
        const q = line[i+1]; let j = i + 2;
        while (j < line.length && line[j] !== q) { if (line[j] === '\\') j++; j++; }
        tokens.push({ type: 'str', text: line.slice(i, j + 1) }); i = j + 1; continue;
      }
      // String
      if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
        const q = line[i]; let j = i + 1;
        while (j < line.length && line[j] !== q) { if (line[j] === '\\') j++; j++; }
        tokens.push({ type: 'str', text: line.slice(i, j + 1) }); i = j + 1; continue;
      }
      // Number
      if (/\d/.test(line[i]) && (i === 0 || /[\s(,=+\-*/<>[\]{}:!]/.test(line[i-1]))) {
        let j = i; while (j < line.length && /[\d.xXa-fA-F_]/.test(line[j])) j++;
        tokens.push({ type: 'num', text: line.slice(i, j) }); i = j; continue;
      }
      // Word
      if (/[a-zA-Z_]/.test(line[i])) {
        let j = i; while (j < line.length && /\w/.test(line[j])) j++;
        const w = line.slice(i, j);
        if (KW.has(w)) tokens.push({ type: 'kw', text: w });
        else if (isPython && PY_BUILTINS.has(w)) tokens.push({ type: 'builtin', text: w });
        else if (j < line.length && line[j] === '(') tokens.push({ type: 'fn', text: w });
        else if (w[0] === w[0].toUpperCase() && /[a-z]/.test(w.slice(1))) tokens.push({ type: 'cls', text: w });
        else tokens.push({ type: 'txt', text: w });
        i = j; continue;
      }
      // Operators
      if (/[=!<>+\-*/%&|^~]/.test(line[i])) {
        let j = i; while (j < line.length && /[=!<>+\-*/%&|^~]/.test(line[j])) j++;
        tokens.push({ type: 'op', text: line.slice(i, j) }); i = j; continue;
      }
      tokens.push({ type: 'txt', text: line[i] }); i++;
    }
    return tokens.map(t => {
      const s = esc(t.text);
      switch (t.type) {
        case 'kw': return '<span class="hl-kw">' + s + '</span>';
        case 'str': return '<span class="hl-str">' + s + '</span>';
        case 'cmt': return '<span class="hl-cmt">' + s + '</span>';
        case 'num': return '<span class="hl-num">' + s + '</span>';
        case 'fn': return '<span class="hl-fn">' + s + '</span>';
        case 'builtin': return '<span class="hl-bi">' + s + '</span>';
        case 'cls': return '<span class="hl-cls">' + s + '</span>';
        case 'deco': return '<span class="hl-deco">' + s + '</span>';
        case 'op': return '<span class="hl-op">' + s + '</span>';
        default: return s;
      }
    }).join('');
  }).join('\n');
}

/** Scope CSS inside a <style> block to a container selector, preventing style leaks. */
export function _scopeStyleBlock(styleHtml, scopeSelector) {
  const inner = styleHtml.replace(/<\/?style[^>]*>/gi, '');
  const scoped = inner.replace(/([^{}@/][^{}]*?)\{/g, (match, selectors) => {
    const trimmed = selectors.trim();
    if (!trimmed || trimmed.startsWith('@') || trimmed.startsWith('from') || trimmed.startsWith('to') || /^\d+%/.test(trimmed)) return match;
    const scopedSelectors = trimmed.split(',').map(s => {
      const sel = s.trim();
      if (sel === 'body' || sel === 'html') return scopeSelector;
      if (sel.startsWith(scopeSelector)) return sel;
      return `${scopeSelector} ${sel}`;
    }).join(', ');
    return `${scopedSelectors} {`;
  });
  return `<style>${scoped}</style>`;
}

export function parseBlockToHtml(text) {
  if (!text) return '';

  // Code fence block
  const codeFenceMatch = text.match(/^```(\w*)\n([\s\S]*?)\n```$/);
  if (codeFenceMatch) {
    const lang = codeFenceMatch[1] || '';
    const code = codeFenceMatch[2];
    // Mermaid: render as diagram
    if (lang.toLowerCase() === 'mermaid') {
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<div class="mermaid-block" data-mermaid="' + esc(code).replace(/"/g, '&quot;') + '">'
        + '<div class="mermaid-header"><span class="mermaid-badge">◆ Mermaid</span><span class="mermaid-hint">圖表預覽</span></div>'
        + '</div>';
    }
    const highlighted = highlightCode(code, lang);
    const lineCount = code.split('\n').length;
    const lineNums = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
    return '<div class="code-block">'
      + '<div class="code-header"><span class="code-lang">' + (lang || 'code') + '</span><span class="code-copy" onclick="navigator.clipboard.writeText(this.closest(\'.code-block\').querySelector(\'.code-body\').textContent).then(()=>{this.textContent=\'已複製 ✓\';setTimeout(()=>this.textContent=\'複製\',1500)})">複製</span></div>'
      + '<div class="code-content"><pre class="code-lines">' + lineNums + '</pre><pre class="code-body">' + highlighted + '</pre></div>'
      + '</div>';
  }

  // Blockquote - use iterative approach to prevent infinite recursion
  if (text.trim().startsWith('>')) {
    let inner = text;
    let depth = 0;
    const maxDepth = 10; // Prevent infinite recursion
    let result = '';

    // Process nested blockquotes iteratively
    while (inner.trim().startsWith('>') && depth < maxDepth) {
      inner = inner.split('\n').map(l => l.replace(/^>\s?/, '')).join('\n');
      depth++;
    }

    // Build nested blockquote HTML
    const openTags = '<blockquote class="bq">'.repeat(depth);
    const closeTags = '</blockquote>'.repeat(depth);

    // Process the inner content without recursion for blockquotes
    // (skip the blockquote check to avoid re-triggering)
    let h = inner;
    const bl = [];
    h = h.replace(/<table[\s\S]*<\/table>/gi, m => { bl.push(m); return `{{B${bl.length - 1}}}`; });
    h = h.replace(/<(div|pre|style)[\s\S]*?<\/\1>/gi, m => { bl.push(m); return `{{B${bl.length - 1}}}`; });
    h = h.replace(/((?:^\|.+\|$\n?)+)/gm, m => { const t = parseMarkdownTable(m); if (t) { bl.push(t); return `{{B${bl.length - 1}}}\n`; } return m; });
    h = h.replace(/^##### (.+)$/gm, '<h5>$1</h5>').replace(/^#### (.+)$/gm, '<h4>$1</h4>').replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
    h = h.replace(/~~(.+?)~~/g, '<del>$1</del>');
    h = h.replace(/`([^`]+)`/g, '<code class="cd">$1</code>').replace(/^---$/gm, '<hr/>');
    h = h.replace(/\[x\]/gi, '<input type="checkbox" checked disabled class="md-checkbox" />');
    h = h.replace(/\[ \]/g, '<input type="checkbox" disabled class="md-checkbox" />');
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link">$1</a>');
    h = h.split('\n').map(l => { const t = l.trim(); if (!t || t.startsWith('<') || t.startsWith('{{B')) return l; return `<p>${t}</p>`; }).join('\n');
    bl.forEach((b, i) => { h = h.replace(`{{B${i}}}`, b); });

    return openTags + h + closeTags;
  }

  let h = text;
  const bl = [];
  // Preserve HTML blocks: table (including nested/comments), div, pre, style
  h = h.replace(/<table[\s\S]*<\/table>/gi, m => { bl.push(m); return `{{B${bl.length - 1}}}`; });
  h = h.replace(/<(div|pre|style)[\s\S]*?<\/\1>/gi, m => { if (/^<style[\s>]/i.test(m)) { m = _scopeStyleBlock(m, '.pv'); } bl.push(m); return `{{B${bl.length - 1}}}`; });
  h = h.replace(/((?:^\|.+\|$\n?)+)/gm, m => { const t = parseMarkdownTable(m); if (t) { bl.push(t); return `{{B${bl.length - 1}}}\n`; } return m; });
  h = h.replace(/^##### (.+)$/gm, '<h5>$1</h5>').replace(/^#### (.+)$/gm, '<h4>$1</h4>').replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/~~(.+?)~~/g, '<del>$1</del>');
  h = h.replace(/`([^`]+)`/g, '<code class="cd">$1</code>').replace(/^---$/gm, '<hr/>');
  // Nested list rendering
  h = h.replace(/((?:^[ \t]*(?:[-*+]|\d+\.)\s.+$\n?)+)/gm, (listBlock) => {
    const lines = listBlock.split('\n').filter(l => l.trim());
    const stack = []; // { tag: 'ul'|'ol', indent }
    let out = '';
    lines.forEach(line => {
      const indentMatch = line.match(/^([ \t]*)/);
      const indent = indentMatch ? indentMatch[1].replace(/\t/g, '    ').length : 0;
      const trimmed = line.trim();
      const isOl = /^\d+\.\s/.test(trimmed);
      const tag = isOl ? 'ol' : 'ul';
      const content = trimmed.replace(/^(?:[-*+]|\d+\.)\s/, '');
      // Close deeper levels
      while (stack.length && stack[stack.length - 1].indent > indent) {
        out += '</' + stack.pop().tag + '>';
      }
      // If same level but different tag type, close and reopen
      if (stack.length && stack[stack.length - 1].indent === indent && stack[stack.length - 1].tag !== tag) {
        out += '</' + stack.pop().tag + '>';
      }
      // Open new level if needed
      if (!stack.length || stack[stack.length - 1].indent < indent) {
        out += '<' + tag + '>';
        stack.push({ tag, indent });
      }
      out += '<li>' + content + '</li>';
    });
    while (stack.length) out += '</' + stack.pop().tag + '>';
    return out;
  });
  // Checkbox syntax (must be before link regex to avoid conflicts)
  h = h.replace(/\[x\]/gi, '<input type="checkbox" checked disabled class="md-checkbox" />');
  h = h.replace(/\[ \]/g, '<input type="checkbox" disabled class="md-checkbox" />');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link">$1</a>');
  h = h.replace(/<!--\s*image\s*-->/gi, '<div class="img-ph">[圖片]</div>');
  h = h.replace(/<!--\s*spacer\s*-->/gi, '<div class="spacer-block">&nbsp;</div>');
  h = h.split('\n').map(l => { const t = l.trim(); if (!t || t.startsWith('<') || t.startsWith('{{B')) return l; return `<p>${t}</p>`; }).join('\n');
  bl.forEach((b, i) => {
    // Wrap tables in scroll container
    const isTable = /<table/i.test(b);
    const wrapped = isTable
      ? '<div class="table-scroll-wrap"><div class="table-scroll-inner">' + b + '</div><div class="tscroll-bar-wrap"><div class="tscroll-track"><div class="tscroll-thumb"></div></div></div></div>'
      : b;
    h = h.replace(`{{B${i}}}`, wrapped);
  });
  return h;
}

/* ===== FORMATTER ===== */
export function formatMarkdown(text) {
  if (!text) return text;
  const parts = []; const re = /<table[\s\S]*?<\/table>/gi; let li = 0, m;
  while ((m = re.exec(text)) !== null) { if (m.index > li) parts.push({ t: 'md', c: text.slice(li, m.index) }); parts.push({ t: 'html', c: m[0] }); li = m.index + m[0].length; }
  if (li < text.length) parts.push({ t: 'md', c: text.slice(li) });
  if (!parts.length) parts.push({ t: 'md', c: text });
  const fH = (h) => { let f = h.replace(/>(\s*)</g, '>\n<'); const ls = f.split('\n'); let ind = 0; const r = [];
    for (const l of ls) { const t = l.trim(); if (!t) continue; if (/^<\//.test(t)) ind = Math.max(0, ind - 2); r.push(' '.repeat(ind) + t); if (/^<[a-z][^\/]*>$/i.test(t) && !/\/>$/.test(t)) ind += 2; } return r.join('\n'); };
  const fM = (md) => { const ls = md.split('\n'); const r = []; let inT = false;
    for (const l of ls) { const t = l.trim();
      if (t.startsWith('|')) { if (!inT && r.length && r[r.length-1] !== '') r.push(''); inT = true; r.push(t); continue; } else if (inT && t) { inT = false; r.push(''); }
      if (/^#{1,6}\s/.test(t)) { if (r.length && r[r.length-1] !== '') r.push(''); r.push(t); continue; }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { if (r.length && r[r.length-1] !== '') r.push(''); r.push('---'); continue; }
      if (!t) { if (r.length && r[r.length-1] !== '') r.push(''); continue; } r.push(t);
    } return r.join('\n'); };
  return parts.map(p => p.t === 'html' ? '\n' + fH(p.c) + '\n' : fM(p.c)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
