import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Download, Upload, FileText, X, AlertCircle, AlertTriangle, Trash2, Edit, Check, Wand2, Plus, CheckCircle2, Circle, FolderDown, FileUp, FileDown, Clipboard, Code, Eye, Bold, Italic, Strikethrough, Link, Heading1, Heading2, Heading3, List, Minus, Quote, Table, GripVertical, Type, Copy, ArrowUp, ArrowDown, ListTree, ChevronRight, PanelRightClose, GitCompare, BarChart3, Sun, Moon } from 'lucide-react';
import { useFeatureFlag, fetchRemoteFlags, getAllFlags } from './featureFlags.js';


/* ===== MD BLOCK SPLITTER ===== */
function splitMdBlocks(text) {
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

function joinMdBlocks(blocks) { return blocks.join('\n\n'); }

/* ===== PARSERS ===== */
function parseMarkdownTable(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2 || !lines[0].includes('|')) return null;
  const parseRow = (l) => l.split('|').map(c => c.trim()).filter((c, i, a) => i > 0 && i < a.length);
  const rows = []; let hdr = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|?[\s\-:]+\|[\s\-:|]+\|?$/.test(lines[i].trim())) { hdr = true; continue; }
    const cells = parseRow(lines[i]);
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
function highlightCode(code, lang) {
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

function parseBlockToHtml(text) {
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
        + '<div class="mermaid-body"><pre class="mermaid">' + esc(code) + '</pre></div>'
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
  h = h.replace(/<(div|pre|style)[\s\S]*?<\/\1>/gi, m => { bl.push(m); return `{{B${bl.length - 1}}}`; });
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
function formatMarkdown(text) {
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

/* ===== SAFE DOWNLOAD (FileSaver pattern) ===== */
function safeDownload(content, filename, mimeType) {
  console.log('=== safeDownload called ===');
  console.log('Original filename:', filename);
  console.log('MimeType:', mimeType);
  console.log('Content length:', content?.length);
  
  // Ensure filename has .md extension
  if (!filename.endsWith('.md')) {
    filename = filename + '.md';
  }
  console.log('Final filename:', filename);
  
  try {
    const blob = new Blob([content], { type: mimeType });
    console.log('Blob created, size:', blob.size);
    
    // For IE/Edge (legacy)
    if (typeof navigator !== 'undefined' && navigator.msSaveBlob) {
      console.log('Using msSaveBlob (IE/Edge)');
      navigator.msSaveBlob(blob, filename);
      return;
    }
    
    // Modern browsers - use FileSaver.js pattern
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.href = url;
    link.download = filename;
    
    console.log('Link created:');
    console.log('  - href:', link.href);
    console.log('  - download attribute:', link.download);
    console.log('  - link.getAttribute("download"):', link.getAttribute('download'));
    
    // Append to body (required for Firefox)
    document.body.appendChild(link);
    
    // Dispatch click event (more reliable than link.click())
    const event = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true
    });
    link.dispatchEvent(event);
    console.log('Click event dispatched');
    
    // Cleanup after download starts
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      console.log('Cleanup completed');
    }, 100);
    
  } catch (e) {
    console.error('Download error:', e);
    // Fallback: prompt user to save manually
    try {
      const b64 = btoa(unescape(encodeURIComponent(content)));
      const dataUri = 'data:' + mimeType + ';base64,' + b64;
      const downloadLink = document.createElement('a');
      downloadLink.href = dataUri;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } catch {
      alert('下載失敗，請使用瀏覽器的「另存為」功能');
    }
  }
}

/* ===== ZIP ===== */
function crc32(d) { let c = 0xFFFFFFFF; const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let v = i; for (let j = 0; j < 8; j++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1); t[i] = v; }
  for (let i = 0; i < d.length; i++) c = t[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function createZip(files) {
  const enc = new TextEncoder(); const lf = []; const cd = []; let off = 0;
  files.forEach(({ name, content }) => {
    const d = enc.encode(content); const n = enc.encode(name); const cr = crc32(d);
    const lo = new Uint8Array(30 + n.length + d.length); const lv = new DataView(lo.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
    lv.setUint32(14, cr, true); lv.setUint32(18, d.length, true); lv.setUint32(22, d.length, true);
    lv.setUint16(26, n.length, true); lv.setUint16(28, 0, true); lo.set(n, 30); lo.set(d, 30 + n.length); lf.push(lo);
    const ce = new Uint8Array(46 + n.length); const cv = new DataView(ce.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
    cv.setUint32(16, cr, true); cv.setUint32(20, d.length, true); cv.setUint32(24, d.length, true);
    cv.setUint16(28, n.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, off, true);
    ce.set(n, 46); cd.push(ce); off += lo.length;
  });
  const cds = cd.reduce((s, c) => s + c.length, 0); const eo = new Uint8Array(22); const ev = new DataView(eo.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cds, true); ev.setUint32(16, off, true);
  return new Blob([...lf, ...cd, eo], { type: 'application/zip' });
}

function safeDownloadBlob(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const link = Object.assign(window.document.createElement('a'), { href: url, download: filename, style: 'display:none' });
    window.document.body.appendChild(link); link.click();
    setTimeout(() => { window.document.body.removeChild(link); URL.revokeObjectURL(url); }, 200);
  } catch {
    try {
      const reader = new FileReader();
      reader.onload = () => { const l = Object.assign(window.document.createElement('a'), { href: reader.result, download: filename, style: 'display:none' }); window.document.body.appendChild(l); l.click(); setTimeout(() => window.document.body.removeChild(l), 200); };
      reader.readAsDataURL(blob);
    } catch { alert('ZIP 下載失敗'); }
  }
}

/* ===== INJECT MARKS ===== */
function injectMarksToMd(content, marks) {
  if (!marks || !marks.length) return content;
  const blocks = splitMdBlocks(content);
  const result = [];
  blocks.forEach((block, bi) => {
    result.push(block);
    const bm = marks.filter(m => m.blockId === 'block-' + bi);
    bm.forEach(m => { result.push('<!-- [審核問題] ' + m.issue.replace(/-->/g, '—>') + ' -->'); });
  });
  return result.join('\n\n');
}

/* ===== MARK POPUP ===== */
function MarkPopup({ mark, position, onSave, onDelete, onClose }) {
  const [issue, setIssue] = useState(mark?.issue || '');
  const [editing, setEditing] = useState(!mark);
  const ref = useRef(null);
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);
  return (
    <div ref={ref} style={{ position:'fixed', left: Math.min(position.x, window.innerWidth-290), top: Math.min(position.y+10, window.innerHeight-220), width:270, background:'white', borderRadius:12, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', border:'1px solid #fecaca', padding:16, zIndex:50 }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-red-600 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{mark ? '問題標記' : '新增標記'}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      {editing ? (<>
        <textarea value={issue} onChange={e => setIssue(e.target.value)} placeholder="描述問題..."
          className="w-full h-20 border rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300" autoFocus />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">取消</button>
          <button onClick={() => { if (issue.trim()) onSave(issue.trim()); }} disabled={!issue.trim()}
            className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-40 flex items-center gap-1"><Check className="w-3.5 h-3.5" />儲存</button>
        </div>
      </>) : (<>
        <div className="bg-red-50 rounded-lg p-2.5 text-sm text-gray-700 mb-3">{mark?.issue}</div>
        <div className="flex justify-end gap-2">
          <button onClick={() => setEditing(true)} className="px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-lg flex items-center gap-1"><Edit className="w-3 h-3" />修改</button>
          <button onClick={onDelete} className="px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1"><Trash2 className="w-3 h-3" />刪除</button>
        </div>
      </>)}
    </div>
  );
}

/* ===== TABLE PARSER (for editing) ===== */
function parseMdTableToGrid(raw) {
  const lines = raw.trim().split('\n').filter(l => l.trim());
  if (!lines.length || !lines[0].includes('|')) return null;
  const parseRow = (l) => l.split('|').map(c => c.trim()).filter((c, i, a) => i > 0 && i < a.length);

  // 先檢查原始文本是否有分隔行（只有有分隔行時，第一行才是 header）
  const hasSeparatorLine = lines.some(l => /^\|?[\s\-:]+\|[\s\-:|]+\|?$/.test(l.trim()));

  // 檢測原始格式：是否為緊湊格式（如 |||）
  const isCompactFormat = lines.some(l => /^\|[^|\s]*\|/.test(l.trim()) || /\|\|/.test(l));

  const grid = [];
  let passedSeparator = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|?[\s\-:]+\|[\s\-:|]+\|?$/.test(lines[i].trim())) { passedSeparator = true; continue; }
    const cells = parseRow(lines[i]);
    // 只有在原始文本有分隔行時，第一行才標記為 header
    // 這樣可以避免沒有分隔行的表格（如 ||| 格式）被自動加上分隔行
    if (cells.length) grid.push({ cells, isHeader: hasSeparatorLine && !passedSeparator && grid.length === 0 });
  }
  if (!grid.length) return null;

  // 修復：確保所有行的 cells 數量一致（補足到最大列數）
  // 這樣可以避免不規則表格（如 ||| 格式）導致的編輯問題
  const maxCols = Math.max(...grid.map(r => r.cells.length));
  grid.forEach(row => {
    while (row.cells.length < maxCols) {
      row.cells.push('');
    }
  });

  // 附加原始格式資訊到 grid（用於序列化時還原）
  grid._originalFormat = {
    hasSeparatorLine,
    isCompactFormat,
    rawText: raw  // 保留原始文字以供比對
  };

  return grid;
}

function parseHtmlTableToGrid(raw) {
  // Advanced HTML table parser - supports colspan/rowspan
  // Step 1: Extract all rows with cell metadata
  const rawRows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(raw)) !== null) {
    const rowHtml = trMatch[1];
    const cells = [];
    const tdRe = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let tdMatch;
    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
      const tag = tdMatch[1].toLowerCase();
      const attrs = tdMatch[2];
      const content = tdMatch[3];
      const colspan = parseInt((attrs.match(/colspan\s*=\s*["']?(\d+)/i) || [, '1'])[1]) || 1;
      const rowspan = parseInt((attrs.match(/rowspan\s*=\s*["']?(\d+)/i) || [, '1'])[1]) || 1;
      // Extract style for reconstruction
      const style = (attrs.match(/style\s*=\s*"([^"]*)"/i) || [, ''])[1];
      const align = (attrs.match(/align\s*=\s*"([^"]*)"/i) || [, ''])[1];
      const height = (attrs.match(/height\s*=\s*"([^"]*)"/i) || [, ''])[1];
      // Clean content to text
      let text = content
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      cells.push({ text, colspan, rowspan, isHeader: tag === 'th', style, align, height });
    }
    if (cells.length) rawRows.push(cells);
  }
  if (!rawRows.length) return null;

  // Step 2: Determine grid dimensions
  let maxCols = 0;
  rawRows.forEach(row => {
    let w = 0;
    row.forEach(c => { w += c.colspan; });
    if (w > maxCols) maxCols = w;
  });
  // Account for rowspan stretching
  const totalRows = rawRows.length;

  // Step 3: Build expanded grid with occupied tracking
  const occupied = Array.from({ length: totalRows + 10 }, () => Array(maxCols + 10).fill(false));
  const grid = Array.from({ length: totalRows }, () => ({
    cells: Array(maxCols).fill(''),
    cellMeta: Array(maxCols).fill(null),
    isHeader: false
  }));

  rawRows.forEach((rowCells, ri) => {
    let ci = 0; // column cursor
    let cellIdx = 0;
    while (cellIdx < rowCells.length) {
      // Skip occupied cells (from previous rowspan)
      while (ci < maxCols && occupied[ri][ci]) ci++;
      if (ci >= maxCols) break;
      const cell = rowCells[cellIdx];
      // Place this cell
      for (let dr = 0; dr < cell.rowspan; dr++) {
        for (let dc = 0; dc < cell.colspan; dc++) {
          const r = ri + dr;
          const c = ci + dc;
          if (r < totalRows && c < maxCols) {
            occupied[r][c] = true;
            if (dr === 0 && dc === 0) {
              // Primary cell
              grid[r].cells[c] = cell.text;
              grid[r].cellMeta[c] = {
                colspan: cell.colspan,
                rowspan: cell.rowspan,
                isHeader: cell.isHeader,
                style: cell.style,
                align: cell.align,
                height: cell.height,
                primary: true
              };
              if (cell.isHeader) grid[r].isHeader = true;
            } else {
              // Spanned cell (reference back to primary)
              grid[r].cellMeta[c] = {
                colspan: 1, rowspan: 1,
                spannedBy: { r: ri, c: ci },
                primary: false
              };
            }
          }
        }
      }
      ci += cell.colspan;
      cellIdx++;
    }
  });

  // Fill nulls
  grid.forEach(row => {
    row.cellMeta = row.cellMeta.map((m, i) => m || {
      colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true
    });
  });

  return grid;
}

function gridToMdTable(grid) {
  if (!grid || !grid.length) return '';
  const colCount = Math.max(...grid.map(r => r.cells.length));

  // 取得原始格式資訊（如果有的話）
  const origFormat = grid._originalFormat || {};
  const isCompact = origFormat.isCompactFormat;
  const hadSeparator = origFormat.hasSeparatorLine;

  const lines = [];
  grid.forEach((row, ri) => {
    let cells;
    if (isCompact) {
      // 緊湊格式：不加空格，空 cell 就是空字串
      cells = row.cells.map(c => c || '');
    } else {
      // 標準格式：前後加空格
      cells = row.cells.map(c => c ? ' ' + c + ' ' : '   ');
    }
    while (cells.length < colCount) cells.push(isCompact ? '' : '   ');
    lines.push('|' + cells.join('|') + '|');

    // 只有原本有分隔行，或者這是標準 header，才加分隔行
    if (ri === 0 && row.isHeader && hadSeparator !== false) {
      lines.push('|' + Array(colCount).fill('---').join('|') + '|');
    }
  });
  return lines.join('\n');
}

function gridToHtmlTable(grid) {
  if (!grid || !grid.length) return '';
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let h = '<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">\n';
  grid.forEach((row, ri) => {
    h += '  <tr>\n';
    row.cells.forEach((cellText, ci) => {
      const meta = row.cellMeta?.[ci];
      if (!meta || !meta.primary) return; // skip spanned cells
      if (meta.spannedBy) return;
      const tag = meta.isHeader ? 'th' : 'td';
      let attrs = '';
      if (meta.colspan > 1) attrs += ` colspan="${meta.colspan}"`;
      if (meta.rowspan > 1) attrs += ` rowspan="${meta.rowspan}"`;
      // Rebuild style
      const styles = [];
      if (meta.style) styles.push(meta.style);
      if (meta.align) attrs += ` align="${meta.align}"`;
      if (meta.height) attrs += ` height="${meta.height}"`;
      const styleAttr = styles.length ? ` style="${styles.join('; ')}"` : '';
      // Convert newlines back to <br>
      const content = cellText.split('\n').map(l => esc(l)).join('<br>');
      h += `    <${tag}${attrs}${styleAttr}>${content}</${tag}>\n`;
    });
    h += '  </tr>\n';
  });
  h += '</table>';
  return h;
}

/* ===== CELL INLINE MD ===== */
function renderCellMd(text) {
  if (!text) return '\u00A0';
  let h = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code class="cd">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" target="_blank">$1</a>');
  h = h.split('\n').join('<br>');
  return h;
}

/* ===== INLINE TABLE EDITOR ===== */
function InlineTableEditor({ grid, outputFormat, onSave, onCancel }) {
  // Deep clone grid including cellMeta AND _originalFormat
  const cloneGrid = (g) => {
    const cloned = g.map(r => ({
      ...r,
      cells: [...r.cells],
      cellMeta: r.cellMeta ? r.cellMeta.map(m => m ? { ...m } : null) : null
    }));
    // 保留原始格式資訊
    if (g._originalFormat) {
      cloned._originalFormat = { ...g._originalFormat };
    }
    return cloned;
  };

  // 正規化儲存格內容用於比較（忽略空白差異）
  const normalizeCell = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // 比較兩個 grid 的內容是否有意義地不同（忽略空白）
  const gridsAreDifferent = (g1, g2) => {
    if (g1.length !== g2.length) return true;
    for (let ri = 0; ri < g1.length; ri++) {
      if (g1[ri].cells.length !== g2[ri].cells.length) return true;
      for (let ci = 0; ci < g1[ri].cells.length; ci++) {
        if (normalizeCell(g1[ri].cells[ci]) !== normalizeCell(g2[ri].cells[ci])) {
          return true;
        }
      }
    }
    return false;
  };

  const [data, setData] = useState(() => cloneGrid(grid));
  const [focusCell, setFocusCell] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [structureChanged, setStructureChanged] = useState(false); // 結構變化（新增/刪除行列）
  const wrapRef = useRef(null);
  const dataRef = useRef(data);
  const initialGridRef = useRef(cloneGrid(grid)); // 保存原始 grid 用於比較
  dataRef.current = data;

  const hasMeta = data.some(r => r.cellMeta && r.cellMeta.some(m => m && (m.colspan > 1 || m.rowspan > 1)));
  const serialize = (d) => outputFormat === 'html' ? gridToHtmlTable(d) : gridToMdTable(d);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        // 檢查是否有意義地修改了內容
        const hasRealChanges = structureChanged || gridsAreDifferent(initialGridRef.current, dataRef.current);

        if (hasRealChanges) {
          onSave(serialize(dataRef.current));
        } else {
          onCancel(); // 沒有有意義的修改，保留原始 HTML
        }
      }
    };
    const timer = setTimeout(() => { document.addEventListener('mousedown', handler); }, 100);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [onSave, onCancel, outputFormat, structureChanged]);

  const updateCell = (ri, ci, val) => {
    setData(prev => prev.map((r, i) => i === ri ? { ...r, cells: r.cells.map((c, j) => j === ci ? val : c) } : r));
  };

  const colCount = Math.max(...data.map(r => r.cells.length), 1);

  // Row & Column operations (simple mode — for tables without colspan/rowspan)
  const addRowBelow = (ri) => {
    const nd = cloneGrid(data);
    const newRow = { cells: Array(colCount).fill(''), isHeader: false };
    if (hasMeta) {
      newRow.cellMeta = Array(colCount).fill(null).map(() => ({ colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true }));
    }
    nd.splice(ri + 1, 0, newRow);
    setStructureChanged(true); setData(nd); setCtxMenu(null);
  };
  const addRowAbove = (ri) => {
    const nd = cloneGrid(data);
    const newRow = { cells: Array(colCount).fill(''), isHeader: false };
    if (hasMeta) {
      newRow.cellMeta = Array(colCount).fill(null).map(() => ({ colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true }));
    }
    nd.splice(ri, 0, newRow);
    setStructureChanged(true); setData(nd); setCtxMenu(null);
  };
  const deleteRow = (ri) => {
    if (data.length <= 1) return;
    setStructureChanged(true); setData(prev => prev.filter((_, i) => i !== ri)); setCtxMenu(null);
  };
  const addColRight = (ci) => {
    setStructureChanged(true);
    setData(prev => prev.map(r => {
      const cells = [...r.cells.slice(0, ci + 1), '', ...r.cells.slice(ci + 1)];
      let cellMeta = r.cellMeta;
      if (cellMeta) {
        const newMeta = { colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true };
        cellMeta = [...cellMeta.slice(0, ci + 1), newMeta, ...cellMeta.slice(ci + 1)];
      }
      return { ...r, cells, cellMeta };
    }));
    setCtxMenu(null);
  };
  const addColLeft = (ci) => {
    setStructureChanged(true);
    setData(prev => prev.map(r => {
      const cells = [...r.cells.slice(0, ci), '', ...r.cells.slice(ci)];
      let cellMeta = r.cellMeta;
      if (cellMeta) {
        const newMeta = { colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true };
        cellMeta = [...cellMeta.slice(0, ci), newMeta, ...cellMeta.slice(ci)];
      }
      return { ...r, cells, cellMeta };
    }));
    setCtxMenu(null);
  };
  const deleteCol = (ci) => {
    if (colCount <= 1) return;
    setStructureChanged(true);
    setData(prev => prev.map(r => ({
      ...r,
      cells: r.cells.filter((_, j) => j !== ci),
      cellMeta: r.cellMeta ? r.cellMeta.filter((_, j) => j !== ci) : null
    })));
    setCtxMenu(null);
  };
  const clearCell = (ri, ci) => {
    updateCell(ri, ci, '');
    setCtxMenu(null);
  };

  const handleCtxMenu = (e, ri, ci) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, ri, ci });
  };

  // Render table: with or without cellMeta
  const renderRow = (row, ri) => {
    const cellElements = [];
    row.cells.forEach((cell, ci) => {
      const meta = row.cellMeta?.[ci];
      // If this cell is spanned by another, skip rendering
      if (meta && !meta.primary && meta.spannedBy) return;

      const Tag = (meta?.isHeader || row.isHeader) ? 'th' : 'td';
      const isFocused = focusCell && focusCell[0] === ri && focusCell[1] === ci;
      const spanProps = {};
      if (meta && meta.colspan > 1) spanProps.colSpan = meta.colspan;
      if (meta && meta.rowspan > 1) spanProps.rowSpan = meta.rowspan;

      cellElements.push(
        <Tag key={ci}
          {...spanProps}
          className={isFocused ? 'cell-focus' : 'cell-normal'}
          onClick={() => setFocusCell([ri, ci])}
          onContextMenu={e => handleCtxMenu(e, ri, ci)}>
          {isFocused ? (
            <textarea value={cell}
              onChange={e => updateCell(ri, ci, e.target.value)}
              onBlur={() => setFocusCell(null)}
              onKeyDown={e => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  // Find next editable cell
                  let nextR = ri, nextC = ci + 1;
                  while (nextR < data.length) {
                    while (nextC < data[nextR].cells.length) {
                      const nm = data[nextR].cellMeta?.[nextC];
                      if (!nm || nm.primary) { setFocusCell([nextR, nextC]); return; }
                      nextC++;
                    }
                    nextR++; nextC = 0;
                  }
                  setFocusCell(null);
                }
                if (e.key === 'Escape') onSave(serialize(data));
              }}
              autoFocus className="cell-input"
              rows={Math.max(1, cell.split('\n').length)}
              style={{ resize: 'vertical', minHeight: 34 }} />
          ) : (
            <span className="cell-text" dangerouslySetInnerHTML={{ __html: renderCellMd(cell) }} />
          )}
        </Tag>
      );
    });
    return cellElements;
  };

  return (
    <div className="table-editor" ref={wrapRef}>
      {/* Column add buttons on top */}
      <div className="te-col-btns">
        {Array.from({ length: colCount }).map((_, ci) => (
          <div key={ci} className="te-col-btn-group">
            <button className="te-add-col" title="在左邊插入欄"
              onClick={() => addColLeft(ci)}>+</button>
            {colCount > 1 && <button className="te-del-col" title="刪除此欄"
              onClick={() => deleteCol(ci)}>×</button>}
          </div>
        ))}
        <button className="te-add-col te-add-col-last" title="在最右邊插入欄"
          onClick={() => addColRight(colCount - 1)}>+</button>
      </div>
      <div className="te-scroll">
        <table>
          <tbody>
            {data.map((row, ri) => (
              <tr key={ri}>
                {/* Row add button on left */}
                <td className="te-row-ctrl"
                  onContextMenu={e => handleCtxMenu(e, ri, 0)}>
                  <button className="te-add-row" title="在上方插入列"
                    onClick={() => addRowAbove(ri)}>+</button>
                  {data.length > 1 && <button className="te-del-row" title="刪除此列"
                    onClick={() => deleteRow(ri)}>×</button>}
                </td>
                {renderRow(row, ri)}
              </tr>
            ))}
            {/* Bottom add row button */}
            <tr>
              <td className="te-row-ctrl"></td>
              <td colSpan={colCount} className="te-add-row-bottom">
                <button onClick={() => addRowBelow(data.length - 1)} className="te-add-full">+ 新增一列</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="table-editor-actions">
        <span className="te-hint">右鍵 = 行列操作 · Tab 跳格 · 點外面自動存</span>
        <button onClick={onCancel} className="te-btn te-cancel">取消</button>
        <button onClick={() => onSave(serialize(data))} className="te-btn te-save">
          <Check style={{ width: 12, height: 12 }} /> 儲存
        </button>
      </div>
      {/* Context menu */}
      {ctxMenu && <TableCtxMenu pos={ctxMenu}
        onAddRowAbove={() => addRowAbove(ctxMenu.ri)}
        onAddRowBelow={() => addRowBelow(ctxMenu.ri)}
        onDeleteRow={() => deleteRow(ctxMenu.ri)}
        onAddColLeft={() => addColLeft(ctxMenu.ci)}
        onAddColRight={() => addColRight(ctxMenu.ci)}
        onDeleteCol={() => deleteCol(ctxMenu.ci)}
        onClearCell={() => clearCell(ctxMenu.ri, ctxMenu.ci)}
        canDeleteRow={data.length > 1}
        canDeleteCol={colCount > 1}
        onClose={() => setCtxMenu(null)} />}
    </div>
  );
}

function TableCtxMenu({ pos, onAddRowAbove, onAddRowBelow, onDeleteRow, onAddColLeft, onAddColRight, onDeleteCol, onClearCell, canDeleteRow, canDeleteCol, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  const sections = [
    { title: '列操作', items: [
      { label: '上方插入列', icon: '⬆', action: onAddRowAbove },
      { label: '下方插入列', icon: '⬇', action: onAddRowBelow },
      { label: '刪除此列', icon: '🗑', action: onDeleteRow, disabled: !canDeleteRow, danger: true },
    ]},
    { title: '欄操作', items: [
      { label: '左邊插入欄', icon: '⬅', action: onAddColLeft },
      { label: '右邊插入欄', icon: '➡', action: onAddColRight },
      { label: '刪除此欄', icon: '🗑', action: onDeleteCol, disabled: !canDeleteCol, danger: true },
    ]},
    { title: '格子操作', items: [
      { label: '清空此格', icon: '⬜', action: onClearCell },
    ]},
  ];

  return (
    <div ref={ref} className="tctx-menu" style={{ left: Math.min(pos.x, window.innerWidth - 200), top: Math.min(pos.y, window.innerHeight - 300) }}>
      {sections.map((sec, si) => (
        <div key={si}>
          {si > 0 && <div className="tctx-divider" />}
          <div className="tctx-title">{sec.title}</div>
          {sec.items.map((it, ii) => (
            <button key={ii} className={'tctx-item' + (it.danger ? ' tctx-danger' : '')}
              disabled={it.disabled}
              onClick={() => { it.action(); onClose(); }}>
              <span className="tctx-ico">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ===== FLOATING TOOLBAR ===== */
function FloatingToolbar({ textareaRef, editText, onWrap }) {
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
function SlashMenu({ position, onSelect, onClose }) {
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
function BlockHandleMenu({ position, onAction, onClose }) {
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

/* ===== MERMAID LIVE EDITOR ===== */

/* Extract node IDs from a single Mermaid source line */
function extractNodeIdsFromLine(line) {
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

  // Clean out common false-positive keywords
  ['TD', 'TB', 'BT', 'RL', 'LR', 'BR', 'px', 'fill', 'stroke', 'color', 'width',
   'height', 'Note', 'note', 'over', 'left', 'right', 'of', 'loop', 'alt', 'opt',
   'par', 'critical', 'break', 'rect', 'activate', 'deactivate'].forEach(w => ids.delete(w));
  return ids;
}

/* Find all SVG <g> nodes whose id contains a given nodeId */
function findSvgNodesById(svgEl, nodeId) {
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

function MermaidEditor({ initialCode, onSave, onCancel }) {
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

  const doRender = useCallback((src) => {
    if (!window.mermaid || !src.trim()) { setSvg(''); return; }
    clearTimeout(renderTimer.current);
    renderTimer.current = setTimeout(() => {
      const id = 'mme-' + Date.now();
      window.mermaid.render(id, src.trim()).then(({ svg: s }) => {
        setSvg(s); setError('');
      }).catch((err) => {
        setError(String(err?.message || err).slice(0, 120));
      });
    }, 400);
  }, []);

  useEffect(() => { doRender(code); }, [code, doRender]);
  useEffect(() => { if (taRef.current) taRef.current.focus(); }, []);

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

/* ===== INLINE BLOCK ===== */
function InlineBlock({ blockId, blockIdx, totalBlocks, raw, html, isEditing, marks, onStartEdit, onFinishEdit, onMark, onBlockAction }) {
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
  useEffect(() => { if (isMermaid) { setMermaidSvg(null); setMermaidErr(null); } }, [raw]);
  useEffect(() => {
    if (!isEditing && isMermaid && !mermaidSvg && !mermaidErr && window.mermaid) {
      const code = raw.replace(/^```mermaid\n/i, '').replace(/\n```$/, '').trim();
      if (!code) return;
      const id = 'mm-' + blockId.replace(/[^a-zA-Z0-9]/g, '') + '-' + Date.now();
      try {
        window.mermaid.render(id, code).then(({ svg }) => {
          setMermaidSvg(svg);
        }).catch((err) => {
          setMermaidErr(String(err?.message || err).slice(0, 200));
          // Clean up error SVG that mermaid injects into DOM
          const errEl = document.getElementById(id);
          if (errEl) errEl.remove();
          const dErrEl = document.getElementById('d' + id);
          if (dErrEl) dErrEl.remove();
        });
      } catch (e) {
        setMermaidErr(String(e?.message || e).slice(0, 200));
      }
      // Also remove any stray mermaid error containers
      return () => {
        try {
          const el = document.getElementById(id);
          if (el) el.remove();
        } catch {}
      };
    }
  }, [isEditing, isMermaid, mermaidSvg, mermaidErr, raw, blockId]);

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
      const mermaidCode = raw.replace(/^```mermaid\n/i, '').replace(/\n```$/, '').trim();
      return (
        <div className="block-wrapper">
          <MermaidEditor initialCode={mermaidCode}
            onSave={(newText) => onFinishEdit(blockId, newText)}
            onCancel={() => onFinishEdit(blockId, raw)} />
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
        <div className="pv" dangerouslySetInnerHTML={{ __html: isMermaid && mermaidSvg
          ? html.replace(/<div class="mermaid-body">[\s\S]*?<\/div>/, '<div class="mermaid-body mermaid-rendered">' + mermaidSvg + '</div>')
          : isMermaid && mermaidErr
          ? html.replace(/<div class="mermaid-body">[\s\S]*?<\/div>/,
            '<div class="mermaid-body mermaid-error">'
            + '<div class="mm-err-icon">âš </div>'
            + '<div class="mm-err-title">Mermaid 語法錯誤</div>'
            + '<div class="mm-err-msg">' + mermaidErr.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>'
            + '<div class="mm-err-hint">點擊此區塊編輯修正語法</div>'
            + '</div>')
          : html }} />
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

/* ===== ADD FILE MODAL ===== */
function AddFileModal({ onAdd, onBatchAdd, onClose }) {
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-800">新增檔案</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 pt-4 shrink-0">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            <button onClick={() => setMode('single')} className={`flex-1 py-1.5 text-sm rounded-md font-medium ${mode === 'single' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>單檔新增</button>
            <button onClick={() => setMode('batch')} className={`flex-1 py-1.5 text-sm rounded-md font-medium ${mode === 'batch' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>批次新增</button>
          </div>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          {mode === 'single' ? (
            <div className="space-y-3">
              <div><label className="text-sm font-medium text-gray-700 mb-1 block">檔案名稱</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="例如:文件1.md" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" /></div>
              <div><div className="flex items-center justify-between mb-1"><label className="text-sm font-medium text-gray-700">Markdown 內容</label>
                <button onClick={handlePaste} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"><Clipboard className="w-3 h-3" />從剪貼簿貼上</button></div>
                <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="貼上 Markdown 內容..." className="w-full h-64 border rounded-lg p-3 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 leading-relaxed" /></div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <p className="font-semibold mb-1">批次貼上格式</p><p className="mb-2">用分隔線區分每個檔案:</p>
                <pre className="bg-white border rounded p-2 text-xs font-mono whitespace-pre-wrap leading-relaxed">{`=== FILE: 文件1.md ===\n(第一個檔案的內容)\n\n=== FILE: 文件2.md ===\n(第二個檔案的內容)`}</pre>
              </div>
              <textarea value={batchText} onChange={e => setBatchText(e.target.value)} placeholder={"=== FILE: 文件1.md ===\n..."} className="w-full h-64 border rounded-lg p-3 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 leading-relaxed" />
              {batchFiles.length > 0 && (<div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-green-700 mb-1">偵測到 {batchFiles.length} 個檔案:</p>
                {batchFiles.map((f, i) => (<div key={i} className="text-xs text-green-600 flex items-center gap-1.5 py-0.5"><FileText className="w-3 h-3" />{f.name} ({f.content.length} å­—)</div>))}
              </div>)}
            </div>
          )}
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
          {mode === 'single' ? (
            <button onClick={() => { if (name.trim() && content.trim()) onAdd(name.trim(), content.trim()); }} disabled={!name.trim() || !content.trim()} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">新增</button>
          ) : (
            <button onClick={() => { if (batchFiles.length) { batchFiles.forEach(f => onBatchAdd(f.name, f.content)); onClose(); } }} disabled={!batchFiles.length} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">新增 {batchFiles.length} 個檔案</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===== FLOATING TOC ===== */
function extractTocEntries(blocks) {
  const entries = [];
  blocks.forEach((block, i) => {
    const m = block.match(/^(#{1,5})\s+(.+)$/m);
    if (m) {
      const level = m[1].length;
      // Strip inline markdown from title
      let title = m[2]
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
      entries.push({ level, title, blockId: 'block-' + i, blockIdx: i });
    }
  });
  return entries;
}

function FloatingToc({ entries, onNavigate, width }) {
  const [activeId, setActiveId] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const tocRef = useRef(null);

  // Scroll spy — track which heading is in viewport
  useEffect(() => {
    if (!entries.length) return;
    const observer = new IntersectionObserver(
      (ents) => {
        // Find the topmost visible heading
        const visible = ents
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );
    entries.forEach(e => {
      const el = document.getElementById(e.blockId);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [entries]);

  // Auto-scroll ToC to keep active item visible
  useEffect(() => {
    if (!activeId || !tocRef.current) return;
    const el = tocRef.current.querySelector('[data-toc-id="' + activeId + '"]');
    if (el) {
      const rect = el.getBoundingClientRect();
      const containerRect = tocRef.current.getBoundingClientRect();
      if (rect.top < containerRect.top + 20 || rect.bottom > containerRect.bottom - 20) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [activeId]);

  const handleClick = (entry) => {
    const el = document.getElementById(entry.blockId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('block-flash');
      setTimeout(() => el.classList.remove('block-flash'), 1800);
      setActiveId(entry.blockId);
    }
    if (onNavigate) onNavigate(entry);
  };

  // Determine which entries are children of a collapsed parent
  const isHidden = (idx) => {
    for (let i = idx - 1; i >= 0; i--) {
      if (entries[i].level < entries[idx].level) {
        if (collapsed.has(entries[i].blockId)) return true;
        // Continue checking ancestors
      }
    }
    return false;
  };

  const hasChildren = (idx) => {
    if (idx >= entries.length - 1) return false;
    return entries[idx + 1].level > entries[idx].level;
  };

  const toggleCollapse = (blockId) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId); else next.add(blockId);
      return next;
    });
  };

  if (!entries.length) return null;

  // Find min level for proper indentation
  const minLevel = Math.min(...entries.map(e => e.level));

  return (
    <div className="ftoc" ref={tocRef} style={width ? { width } : undefined}>
      <div className="ftoc-header">
        <ListTree style={{ width: 13, height: 13 }} />
        <span>目錄</span>
        <span className="ftoc-count">{entries.length}</span>
      </div>
      <div className="ftoc-list">
        {entries.map((entry, idx) => {
          if (isHidden(idx)) return null;
          const indent = entry.level - minLevel;
          const isActive = activeId === entry.blockId;
          const expandable = hasChildren(idx);
          const isCollapsed = collapsed.has(entry.blockId);
          return (
            <div key={entry.blockId} data-toc-id={entry.blockId}
              className={'ftoc-item' + (isActive ? ' ftoc-active' : '')}
              style={{ paddingLeft: 8 + indent * 14 }}>
              {expandable ? (
                <button className="ftoc-toggle" onClick={(e) => { e.stopPropagation(); toggleCollapse(entry.blockId); }}>
                  <ChevronRight style={{ width: 11, height: 11, transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform .15s' }} />
                </button>
              ) : (
                <span className="ftoc-dot-wrap"><span className={'ftoc-dot' + (isActive ? ' ftoc-dot-active' : '')} /></span>
              )}
              <button className="ftoc-link" onClick={() => handleClick(entry)}
                title={entry.title}>
                <span className={'ftoc-level ftoc-l' + entry.level}>H{entry.level}</span>
                <span className="ftoc-text">{entry.title}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== DIFF ENGINE (Enhanced with Similarity Matching) ===== */

// 正規化行內容用於比較（處理空白、HTML 屬性等）
function normalizeLineForComparison(line) {
  if (!line) return '';
  let normalized = line;

  // 0. Markdown 表格特殊處理
  // 分隔行 |---|---|---| 視為結構標記，正規化為固定格式
  if (/^\|[\s-:]+\|[\s-:|]*$/.test(normalized.trim())) {
    // 計算欄位數
    const cols = (normalized.match(/\|/g) || []).length - 1;
    return '|' + Array(cols).fill('---').join('|') + '|';
  }

  // Markdown 表格行：移除儲存格內的空白，保留結構
  // |   |   |   | → ||||
  // | abc | def | → |abc|def|
  if (/^\|.*\|$/.test(normalized.trim())) {
    normalized = normalized.trim()
      .split('|')
      .map(cell => cell.trim())
      .join('|');
  }

  // 1. 移除 HTML 註解
  normalized = normalized.replace(/<!--[\s\S]*?-->/g, '');

  // 2. 移除裝飾性屬性（這些變化不影響語義）
  // width, height, align, valign, style, bgcolor, border, cellpadding, cellspacing
  normalized = normalized.replace(/\s+(width|height|align|valign|style|bgcolor|border|cellpadding|cellspacing)="[^"]*"/gi, '');
  normalized = normalized.replace(/\s+(width|height|align|valign|style|bgcolor|border|cellpadding|cellspacing)='[^']*'/gi, '');

  // 3. 將多個連續空白壓縮為單一空格
  normalized = normalized.replace(/\s+/g, ' ');

  // 4. 移除行首行尾空白
  normalized = normalized.trim();

  // 5. HTML 標籤內屬性正規化：移除屬性間多餘空白
  normalized = normalized.replace(/\s*=\s*/g, '=');
  normalized = normalized.replace(/>\s+</g, '><');

  // 6. 統一引號
  normalized = normalized.replace(/'/g, '"');

  // 7. 移除空標籤內的空白 <td>  </td> → <td></td>
  normalized = normalized.replace(/<(td|th)([^>]*)>\s*<\/(td|th)>/gi, '<$1$2></$3>');

  return normalized.toLowerCase();
}

// 計算兩行的相似度 (0-1)，使用 Levenshtein 距離
function computeLineSimilarity(line1, line2) {
  const s1 = normalizeLineForComparison(line1);
  const s2 = normalizeLineForComparison(line2);

  // 完全相同
  if (s1 === s2) return 1;

  // 其中一個為空
  if (!s1 || !s2) return 0;

  const len1 = s1.length;
  const len2 = s2.length;

  // 長度差異過大，直接判定不相似
  if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.5) return 0;

  // 使用優化的 Levenshtein 距離計算
  const matrix = [];
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= len2; j++) {
      if (i === 0) {
        matrix[i][j] = j;
      } else {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // 刪除
          matrix[i][j - 1] + 1,      // 插入
          matrix[i - 1][j - 1] + cost // 替換
        );
      }
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return maxLen > 0 ? 1 - distance / maxLen : 1;
}

// 檢查是否為「無意義」的行（純空行、無結構意義的空標籤、Markdown 表格分隔行等）
function isEmptyOrWhitespace(line) {
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

function computeDiffStats(edits) {
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

function DownloadConfirmModal({ filename, onConfirm, onClose }) {
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
function VirtualDiffList({ items, mode, isCalculating, progress, manualMode, needsRefresh, onRefresh }) {
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
    <div key={startIndex + i} className={'diff-line diff-' + e.type} style={useVirtual ? { height: ROW_HEIGHT } : undefined}>
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
      <div key={startIndex + i} className="diff-split-row" style={useVirtual ? { height: ROW_HEIGHT } : undefined}>
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
                    mode === 'unified' ? renderUnifiedRow(item, i) : renderSplitRow(item, i)
                  )}
                </div>
              </div>
            ) : (
              items.map((item, i) =>
                mode === 'unified' ? renderUnifiedRow(item, i) : renderSplitRow(item, i)
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

// ===== Dashboard Stats Hook =====

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

function useDashboardStats(files, isActive) {
  const workerRef = useRef(null);
  const cacheRef = useRef(new Map());
  const [allStats, setAllStats] = useState(new Map());
  const [computing, setComputing] = useState({ active: false, current: 0, total: 0 });
  const queueRef = useRef([]);
  const activeRef = useRef(false);

  useEffect(() => {
    const w = new Worker(new URL('./diffWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, type, stats, canary } = e.data;
      if (type === 'stats-complete') {
        // Canary report logging
        if (canary) {
          canary.violations?.forEach(v => console.warn('[Canary]', id, v.code, v.message));
          canary.suspicious?.forEach(s => console.warn('[Canary:Suspicious]', id, s.code, s.message));
        }
        cacheRef.current.set(id, stats);
        setAllStats(prev => new Map(prev).set(id, stats));
        setComputing(prev => {
          const next = { ...prev, current: prev.current + 1 };
          if (next.current >= next.total) next.active = false;
          return next;
        });
        // Process next in queue
        const nextFile = queueRef.current.shift();
        if (nextFile) {
          w.postMessage({ id: nextFile.id, mode: 'stats', oldText: nextFile.originalContent || '', newText: nextFile.content || '', flags: getAllFlags() });
        }
      }
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    if (!isActive || !workerRef.current) return;
    activeRef.current = true;

    // Find files that need (re)computation
    const stale = files.filter(f => {
      if (!f.originalContent) return false;
      const hash = simpleHash(f.originalContent + '|' + f.content);
      const cached = cacheRef.current.get(f.id);
      if (cached && cached._hash === hash) return false;
      return true;
    });

    if (stale.length === 0) {
      // Populate allStats from cache
      const m = new Map();
      files.forEach(f => { if (cacheRef.current.has(f.id)) m.set(f.id, cacheRef.current.get(f.id)); });
      setAllStats(m);
      return;
    }

    setComputing({ active: true, current: 0, total: stale.length });

    // Tag cache entries with hash for invalidation
    stale.forEach(f => {
      const hash = simpleHash(f.originalContent + '|' + f.content);
      const placeholder = { _hash: hash, _pending: true };
      cacheRef.current.set(f.id, placeholder);
    });

    // Queue all stale files, start first
    queueRef.current = stale.slice(1);
    const first = stale[0];
    workerRef.current.postMessage({ id: first.id, mode: 'stats', oldText: first.originalContent || '', newText: first.content || '', flags: getAllFlags() });
  }, [isActive, files]);

  const recompute = useCallback(() => {
    cacheRef.current.clear();
    setAllStats(new Map());
  }, []);

  return { allStats, computing, recompute };
}

// ===== Dashboard Overview Component =====

function getSeverityInfo(ratio) {
  if (ratio <= 0.05) return { label: '微量修改', color: '#10b981', bg: '#ecfdf5' };
  if (ratio <= 0.15) return { label: '適度修改', color: '#f59e0b', bg: '#fffbeb' };
  if (ratio <= 0.30) return { label: '大幅修改', color: '#f97316', bg: '#fff7ed' };
  return { label: '重大變更', color: '#ef4444', bg: '#fef2f2' };
}

function DashboardOverview({ files, allStats, computing, onSelectFile, onClose }) {
  const fileRows = useMemo(() => {
    return files.map(f => {
      const stats = allStats.get(f.id);
      const hasOriginal = !!f.originalContent;
      const identical = hasOriginal && f.originalContent === f.content;
      const actualLines = hasOriginal ? f.originalContent.split('\n').length : (f.content || '').split('\n').length;
      return { ...f, stats, hasOriginal, identical, actualLines };
    }).sort((a, b) => {
      const ra = a.stats?.changeRatio ?? -1;
      const rb = b.stats?.changeRatio ?? -1;
      return rb - ra;
    });
  }, [files, allStats]);

  const summary = useMemo(() => {
    const withStats = fileRows.filter(r => r.stats && !r.stats._pending);
    const total = files.length;
    const computed = withStats.length;
    const avgRatio = computed > 0 ? withStats.reduce((s, r) => s + r.stats.changeRatio, 0) / computed : 0;
    const maxFile = withStats.length > 0 ? withStats.reduce((a, b) => (a.stats.changeRatio > b.stats.changeRatio ? a : b)) : null;
    const totalAdded = withStats.reduce((s, r) => s + r.stats.added, 0);
    const totalDeleted = withStats.reduce((s, r) => s + r.stats.deleted, 0);
    const totalModified = withStats.reduce((s, r) => s + r.stats.modified, 0);
    const totalUnchanged = withStats.reduce((s, r) => s + r.stats.unchanged, 0);
    return { total, computed, avgRatio, maxFile, totalAdded, totalDeleted, totalModified, totalUnchanged };
  }, [files, fileRows]);

  const avgSeverity = getSeverityInfo(summary.avgRatio);

  return (
    <div className="dash-container">
      <div className="dash-header">
        <div className="dash-title">
          <BarChart3 className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span>差異儀表板</span>
        </div>
        <button onClick={onClose} className="dash-close"><X className="w-4 h-4" /></button>
      </div>

      {/* Summary Cards */}
      <div className="dash-cards">
        <div className="dash-card">
          <div className="dash-card-value">{summary.total}</div>
          <div className="dash-card-label">總檔案數</div>
          {computing.active && <div className="dash-card-sub">計算中 {computing.current}/{computing.total}...</div>}
        </div>
        <div className="dash-card" style={{ borderTopColor: avgSeverity.color }}>
          <div className="dash-card-value" style={{ color: avgSeverity.color }}>{(summary.avgRatio * 100).toFixed(1)}%</div>
          <div className="dash-card-label">平均變更率</div>
          <div className="dash-card-sub" style={{ color: avgSeverity.color }}>{avgSeverity.label}</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-value" style={{ color: '#10b981' }}>+{summary.totalAdded}</div>
          <div className="dash-card-label">總新增行</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-value" style={{ color: '#ef4444' }}>-{summary.totalDeleted}</div>
          <div className="dash-card-label">總刪除行</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-value" style={{ color: '#f59e0b' }}>~{summary.totalModified}</div>
          <div className="dash-card-label">總修改行</div>
        </div>
      </div>

      {/* Per-file Donut Charts */}
      {summary.computed > 0 && (() => {
        const r = 38, circ = 2 * Math.PI * r;
        const donuts = fileRows.filter(row => row.stats && !row.stats._pending);
        if (donuts.length === 0) return null;
        return (
          <div className="dash-donut-grid">
            {donuts.map((row, di) => {
              const s = row.stats;
              const total = s.unchanged + s.added + s.deleted + s.modified;
              if (total === 0) return null;
              const segs = [
                { value: s.unchanged, color: '#d1d5db' },
                { value: s.added, color: '#10b981' },
                { value: s.deleted, color: '#ef4444' },
                { value: s.modified, color: '#f59e0b' },
              ].filter(seg => seg.value > 0);
              let cum = 0;
              const arcs = segs.map(seg => {
                const len = (seg.value / total) * circ;
                const off = cum; cum += len;
                return { ...seg, len, off };
              });
              const sev = getSeverityInfo(s.changeRatio);
              return (
                <div key={row.id} className="dash-donut-cell" onClick={() => onSelectFile(row.id)} title={`點擊查看 ${row.name} 的差異比對`}>
                  <div className="dash-donut-wrap-sm">
                    <svg viewBox="0 0 100 100" className="dash-donut-svg">
                      {arcs.map((a, i) => (
                        <circle key={i} r={r} cx="50" cy="50" fill="none" stroke={a.color} strokeWidth="12"
                          strokeDasharray={a.len + ' ' + (circ - a.len)} strokeDashoffset={-a.off}
                          transform="rotate(-90 50 50)" className="dash-donut-seg" style={{ animationDelay: (di * 150 + i * 100) + 'ms' }} />
                      ))}
                    </svg>
                    <div className="dash-donut-center">
                      <div className="dash-donut-pct" style={{ color: sev.color }}>{(s.changeRatio * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="dash-donut-fname">{row.name}</div>
                  <div className="dash-donut-meta">
                    {s.added > 0 && <span style={{ color: '#10b981' }}>+{s.added}</span>}
                    {s.deleted > 0 && <span style={{ color: '#ef4444' }}>-{s.deleted}</span>}
                    {s.modified > 0 && <span style={{ color: '#f59e0b' }}>~{s.modified}</span>}
                    {s.changed === 0 && <span style={{ color: '#10b981' }}>無變更</span>}
                  </div>
                  <div className="dash-donut-lines">{row.actualLines} 行</div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Shared legend */}
      <div className="dash-legend-bar">
        <span className="dash-legend-item"><span className="dash-legend-dot" style={{ background: '#d1d5db' }} />未變更</span>
        <span className="dash-legend-item"><span className="dash-legend-dot" style={{ background: '#10b981' }} />新增</span>
        <span className="dash-legend-item"><span className="dash-legend-dot" style={{ background: '#ef4444' }} />刪除</span>
        <span className="dash-legend-item"><span className="dash-legend-dot" style={{ background: '#f59e0b' }} />修改</span>
      </div>

      {/* File ranking */}
      <div className="dash-section-title">檔案變更排行</div>
      <div className="dash-ranking">
        {fileRows.map((row, idx) => {
          const stats = row.stats;
          const pending = !stats || stats._pending;
          const ratio = pending ? 0 : stats.changeRatio;
          const sev = getSeverityInfo(ratio);
          const barWidth = Math.max(ratio * 100, 0.5);

          return (
            <div key={row.id} className="dash-row" onClick={() => onSelectFile(row.id)} title={`點擊查看 ${row.name} 的差異比對`}>
              <div className="dash-row-rank">{idx + 1}</div>
              <div className="dash-row-name">{row.name}</div>
              <div className="dash-row-bar-wrap">
                {pending ? (
                  <div className="dash-row-pending">計算中...</div>
                ) : row.identical ? (
                  <div className="dash-row-identical">無變更</div>
                ) : (
                  <div className="dash-row-stacked" style={{ width: Math.min(barWidth, 100) + '%', animationDelay: (idx * 60) + 'ms' }}>
                    {stats.added > 0 && <div style={{ flex: stats.added, background: '#10b981' }} />}
                    {stats.deleted > 0 && <div style={{ flex: stats.deleted, background: '#ef4444' }} />}
                    {stats.modified > 0 && <div style={{ flex: stats.modified, background: '#f59e0b' }} />}
                  </div>
                )}
              </div>
              <div className="dash-row-pct" style={{ color: pending ? '#9ca3af' : sev.color }}>
                {pending ? '...' : (ratio * 100).toFixed(1) + '%'}
              </div>
              <div className="dash-row-counts">
                {!pending && stats.changed > 0 && (
                  <>
                    {stats.added > 0 && <span style={{ color: '#10b981' }}>+{stats.added}</span>}
                    {stats.deleted > 0 && <span style={{ color: '#ef4444' }}>-{stats.deleted}</span>}
                    {stats.modified > 0 && <span style={{ color: '#f59e0b' }}>~{stats.modified}</span>}
                  </>
                )}
              </div>
              <div className="dash-row-lines">{row.actualLines}行</div>
            </div>
          );
        })}
        {fileRows.length === 0 && <div className="dash-empty">尚無檔案</div>}
      </div>
    </div>
  );
}

function SourceEditor({ value, onChange }) {
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

function DiffViewer({ originalContent, currentContent, fileName }) {
  const [diffMode, setDiffMode] = useState('unified'); // unified | split
  const [edits, setEdits] = useState([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [manualMode, setManualMode] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const workerRef = useRef(null);
  const requestIdRef = useRef(0);
  
  // Threshold for large content (characters)
  const LARGE_CONTENT_THRESHOLD = 3000;
  const isLargeContent = (originalContent?.length || 0) > LARGE_CONTENT_THRESHOLD || 
                          (currentContent?.length || 0) > LARGE_CONTENT_THRESHOLD;
  
  // Initialize Web Worker
  useEffect(() => {
    workerRef.current = new Worker(new URL('./diffWorker.js', import.meta.url), { type: 'module' });
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
          items={diffMode === 'unified' ? edits : pairs}
          mode={diffMode}
          isCalculating={isCalculating}
          manualMode={manualMode}
          needsRefresh={needsRefresh}
          onRefresh={triggerDiff}
        />
      )}

      {/* Legend */}
      {!isIdentical && (
        <div className="diff-legend">
          <span className="diff-legend-item"><span className="diff-legend-swatch swatch-eq" />未變更</span>
          <span className="diff-legend-item"><span className="diff-legend-swatch swatch-add" />++ 新增行</span>
          <span className="diff-legend-item"><span className="diff-legend-swatch swatch-del" />−− 刪除行</span>
          <span className="diff-legend-item"><span className="diff-legend-swatch swatch-mod" />~~ 微調行</span>
          <span className="diff-legend-item diff-legend-tip">💡 變更幅度 = (新增 + 刪除) ÷ 原始行數,上限 100%</span>
        </div>
      )}
    </div>
  );
}

/* ===== THEME HELPERS ===== */
function getInitialTheme() {
  try {
    const saved = localStorage.getItem('md-reviewer-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* localStorage unavailable */ }
  return 'light';
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
  const [showToc, setShowToc] = useState(false);
  const [tocWidth, setTocWidth] = useState(220);
  const tocDragRef = useRef(null);
  const importRef = useRef(null);

  // Feature Flags
  const flagDarkMode = useFeatureFlag('dark-mode');
  const flagDashboard = useFeatureFlag('dashboard');

  // Fetch remote flags once on mount
  useEffect(() => { fetchRemoteFlags(); }, []);

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

  // Load Mermaid.js from CDN
  useEffect(() => {
    if (window.mermaid) { setMermaidReady(true); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js';
    script.onload = () => {
      window.mermaid.initialize({
        startOnLoad: false,
        suppressErrorRendering: true,
        theme: 'neutral',
        themeVariables: {
          primaryColor: '#dbeafe',
          primaryTextColor: '#1e3a5f',
          primaryBorderColor: '#3b82f6',
          lineColor: '#64748b',
          secondaryColor: '#f0fdf4',
          tertiaryColor: '#fef3c7',
          fontFamily: '"Noto Sans TC", system-ui, sans-serif',
          fontSize: '13px'
        },
        flowchart: { curve: 'basis', padding: 12 },
        sequence: { actorMargin: 30, mirrorActors: false },
      });
      setMermaidReady(true);
    };
    document.head.appendChild(script);
  }, []);

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

  // History Management
  // History Management (DISABLED)
  /*
  const pushHistory = useCallback((fileId, currentContent) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== fileId) return f;
      const newHistory = [...(f.history || []), currentContent].slice(-5); // Keep last 5 steps (User request: 5 times)
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
  */

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
      // pushHistory(activeFile.id, activeFile.content); // UNDO DISABLED
      cur[idx] = newText; updateFile(activeFile.id, { content: joinMdBlocks(cur) });
    }
    setEditingBlock(null);
  }, [activeFile, updateFile]); // Removed pushHistory dependency

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
    // if (action !== 'copy') {
    //   pushHistory(activeFile.id, activeFile.content); // UNDO DISABLED
    // }

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
  }, [activeFile, updateFile]); // Removed pushHistory dependency

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

    .mermaid-block{border-radius:var(--radius);overflow:hidden;margin:8px 0;border:1.5px solid #c4b5fd;background:linear-gradient(135deg,#faf5ff 0%,#ede9fe 100%);box-shadow:0 4px 16px rgba(124,58,237,.08)}
    .mermaid-header{padding:8px 14px;background:linear-gradient(90deg,#7c3aed10,#7c3aed08);border-bottom:1px solid #ddd6fe;display:flex;align-items:center;justify-content:space-between}
    .mermaid-badge{font-size:11px;font-weight:700;color:#7c3aed;letter-spacing:.02em;font-family:var(--font)}
    .mermaid-hint{font-size:10px;color:#a78bfa;font-family:var(--font)}
    .mermaid-body{padding:20px;min-height:60px;display:flex;align-items:center;justify-content:center;background:white;margin:8px;border-radius:8px;border:1px solid #ede9fe}
    .mermaid-body pre.mermaid{font-size:12px;color:#6b7280;font-family:var(--mono);white-space:pre-wrap;text-align:center}
    .mermaid-body.mermaid-rendered{padding:16px}
    .mermaid-body.mermaid-rendered svg{max-width:100%;height:auto}
    .mermaid-body.mermaid-error{flex-direction:column;gap:6px;padding:20px;background:#fef7f7;border-color:#fecaca}
    .mm-err-icon{font-size:28px;line-height:1;opacity:.7}
    .mm-err-title{font-size:13px;font-weight:700;color:#b91c1c;font-family:var(--font)}
    .mm-err-msg{font-size:11px;color:#7f1d1d;font-family:var(--mono);background:#fee2e2;padding:6px 10px;border-radius:6px;max-width:100%;overflow-x:auto;white-space:pre-wrap;word-break:break-all;border:1px solid #fecaca;line-height:1.5}
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
    .table-editor table{width:100%;border-collapse:collapse;background:white;table-layout:auto}
    .table-editor th,.table-editor td{border:1px solid var(--border2);padding:0;text-align:left;vertical-align:top;font-size:12.5px;min-width:70px;position:relative}
    .table-editor th{background:var(--surface2);font-weight:600;font-size:12px}
    .te-row-ctrl{width:26px!important;min-width:26px!important;max-width:26px!important;padding:0!important;border:none!important;background:transparent!important;vertical-align:middle;text-align:center;position:relative}
    .te-add-row,.te-del-row{width:20px;height:20px;border:1.5px dashed var(--border2);border-radius:var(--radius-sm);background:var(--surface);color:var(--text3);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:all .15s;margin:1px auto}
    .table-editor tr:hover .te-add-row,.table-editor tr:hover .te-del-row{opacity:1}
    .te-add-row:hover{background:var(--accent-bg);color:var(--accent);border-color:var(--accent2);transform:scale(1.1)}
    .te-del-row{border-color:#fca5a5;color:#f87171;font-size:15px;font-weight:600}
    .te-del-row:hover{background:#fef2f2;color:#ef4444;border-color:#ef4444;transform:scale(1.1)}
    .te-col-btns{display:flex;padding:0 0 0 26px;gap:0}
    .te-col-btn-group{flex:1;display:flex;flex-direction:column;align-items:stretch;gap:0}
    .te-add-col{height:20px;border:none;border-bottom:1.5px dashed var(--accent-border);background:transparent;color:var(--text3);font-size:12px;cursor:pointer;opacity:0;transition:all .15s;width:100%}
    .te-add-col-last{flex:0 0 24px;width:24px}
    .te-del-col{height:18px;border:none;border-bottom:1.5px dashed #fca5a5;background:transparent;color:#f87171;font-size:14px;font-weight:600;cursor:pointer;opacity:0;transition:all .15s;width:100%}
    .te-col-btns:hover .te-add-col,.te-col-btns:hover .te-del-col{opacity:1}
    .te-add-col:hover{background:var(--accent-bg);color:var(--accent)}
    .te-del-col:hover{background:#fef2f2;color:#ef4444}
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

    .mm-editor{border:2px solid #c4b5fd;border-radius:var(--radius);overflow:hidden;background:#faf5ff;box-shadow:0 0 0 4px rgba(124,58,237,.08)}
    .mm-editor-header{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:linear-gradient(90deg,#7c3aed10,#7c3aed08);border-bottom:1px solid #ddd6fe}
    .mm-editor-badge{font-size:12px;font-weight:700;color:#7c3aed;letter-spacing:.01em;font-family:var(--font)}
    .mm-editor-header-right{display:flex;align-items:center;gap:10px}
    .mm-hl-indicator{font-size:10.5px;color:#7c3aed;font-family:var(--font);display:flex;align-items:center;gap:5px;padding:3px 12px;background:#ede9fe;border-radius:20px;font-weight:700;animation:mmHlIn .25s ease;border:1px solid #c4b5fd}
    .mm-hl-dot{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#a78bfa,#7c3aed);box-shadow:0 0 8px #7c3aedaa;animation:mmDotPulse 1.4s ease infinite}
    @keyframes mmDotPulse{0%,100%{box-shadow:0 0 6px #7c3aed88;transform:scale(1)}50%{box-shadow:0 0 14px #7c3aedcc;transform:scale(1.35)}}
    @keyframes mmHlIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}
    .mm-editor-actions{display:flex;gap:6px}
    .mm-editor-body{display:flex;flex-direction:column;min-height:200px}
    .mm-editor-code{border-bottom:1px solid #ede9fe;position:relative}
    .mm-code-label{position:absolute;top:6px;right:10px;font-size:9.5px;color:#a78bfa88;font-family:var(--font);z-index:1;pointer-events:none;letter-spacing:.01em}
    .mm-code-wrap{display:flex;background:#1e1b2e;overflow:hidden}
    .mm-line-nums{padding:10px 0;min-width:32px;text-align:right;user-select:none;flex-shrink:0;background:#16131f;border-right:1px solid #2d2640}
    .mm-line-num{padding:0 8px 0 6px;font-size:11px;line-height:1.7;font-family:var(--mono);color:#4a3f6b;transition:all .12s}
    .mm-line-active{color:#e9dbff;background:linear-gradient(90deg,#7c3aed66,#7c3aed18);font-weight:700;text-shadow:0 0 8px #a78bfa88}
    .mm-code-input{flex:1;min-height:120px;padding:10px 14px;border:none;outline:none;font-family:var(--mono);font-size:12.5px;line-height:1.7;background:transparent;color:#e2d9f3;resize:vertical;scrollbar-width:thin;scrollbar-color:#2d2640 transparent}
    .mm-code-input::selection{background:#7c3aed44}
    .mm-editor-preview{flex:1;position:relative}
    .mm-preview-label{position:absolute;top:6px;right:10px;font-size:10px;color:#a78bfa;font-family:var(--font);z-index:3;pointer-events:none}
    .mm-preview-area{padding:16px;min-height:80px;max-height:320px;overflow:auto;display:flex;align-items:center;justify-content:center;background:white;margin:8px;border-radius:8px;border:1px solid #ede9fe;position:relative;transition:border-color .2s}
    .mm-preview-area.mm-has-hl{border-color:#a78bfa;box-shadow:inset 0 0 30px #7c3aed15}
    .mm-preview-svg{width:100%;overflow-x:auto;position:relative;z-index:2;transition:opacity .3s,filter .3s}
    .mm-preview-svg svg{max-width:100%;height:auto}
    .mm-preview-svg.mm-svg-dimmed{opacity:.30;filter:saturate(.2) brightness(.85)}
    .mm-hl-spot{position:absolute;z-index:1;pointer-events:none;border-radius:18px;background:radial-gradient(ellipse at center,transparent 25%,#a78bfa55 40%,#7c3aed88 55%,#7c3aedaa 65%,#a78bfa66 78%,transparent 92%);animation:mmSpotIn .3s ease;box-shadow:0 0 32px 10px #7c3aed44,0 0 60px 20px #7c3aed22}
    @keyframes mmSpotIn{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
    .mm-preview-error{color:#ef4444;font-size:12px;display:flex;align-items:center;gap:6px;font-family:var(--mono);padding:8px;background:#fef2f2;border-radius:var(--radius-sm);border:1px solid #fecaca;max-width:100%;word-break:break-all}
    .mm-preview-empty{color:#a78bfa;font-size:13px;font-family:var(--font)}
    .mm-editor-hint{padding:6px 14px;font-size:10px;color:#a78bfa;background:#faf5ff;border-top:1px solid #ede9fe;font-family:var(--font);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
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
    .swatch-eq{background:#dcfce7;border-color:#86efac}
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
      
      {/* Header */}
      <div style={{background:'var(--surface)',borderBottom:'1px solid var(--border)',padding:'8px clamp(10px,2%,16px)',boxShadow:'var(--shadow)',flexShrink:0}}>
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
            {flagDashboard && <button onClick={() => setShowDashboard(true)} disabled={!files.length} className={'tbtn ' + (showDashboard ? 'tbtn-blue' : 'tbtn-gray')} title="差異儀表板"><BarChart3 className="w-3.5 h-3.5" />儀表板</button>}
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
        {/* Sidebar */}
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
                      <InlineBlock key={activeFile.id+'-'+i} blockId={'block-'+i} blockIdx={i} totalBlocks={blocks.length} raw={block} html={blockHtmls[i]||''} isEditing={editingBlock==='block-'+i} marks={activeFile.marks} onStartEdit={onStartEdit} onFinishEdit={onFinishEdit} onMark={onBlockMark} onBlockAction={onBlockAction}/>
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
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
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
