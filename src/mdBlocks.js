// Framework-free markdown block splitter — the single source of truth for how the
// app chunks a document into reviewable blocks. Mark ids ('block-<n>') index into
// this array, so llmExport.js MUST use the same splitter to anchor annotations.
export function splitMdBlocks(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks = [];
  let buf = [];
  let inHtmlTable = false, inMdTable = false, inCodeFence = false, inHtmlDiv = false, inMathFence = false;
  let tableOpens = 0, tableCloses = 0, divOpens = 0, divCloses = 0;
  const flush = () => { if (buf.length) { const raw = buf.join('\n'); if (raw.trim()) blocks.push(raw); buf = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (t.startsWith('```')) { if (!inCodeFence) { flush(); inCodeFence = true; buf.push(l); } else { buf.push(l); inCodeFence = false; flush(); } continue; }
    if (inCodeFence) { buf.push(l); continue; }
    if (t.startsWith('$$')) {
      if (!inMathFence) { const rest = t.slice(2).trim(); if (rest.endsWith('$$') && rest.length >= 2) { flush(); buf.push(l); flush(); continue; } flush(); inMathFence = true; buf.push(l); continue; }
      else { buf.push(l); inMathFence = false; flush(); continue; }
    }
    if (inMathFence) { buf.push(l); continue; }
    if (!inHtmlTable && /<table/i.test(t)) { flush(); inHtmlTable = true; tableOpens = (l.match(/<table/gi) || []).length; tableCloses = (l.match(/<\/table>/gi) || []).length; buf.push(l); if (tableCloses >= tableOpens) { inHtmlTable = false; flush(); } continue; }
    if (inHtmlTable) { buf.push(l); tableOpens += (l.match(/<table/gi) || []).length; tableCloses += (l.match(/<\/table>/gi) || []).length; if (tableCloses >= tableOpens) { inHtmlTable = false; flush(); } continue; }
    if (!inHtmlDiv && /^<div[\s>]/i.test(t)) { flush(); inHtmlDiv = true; divOpens = (l.match(/<div[\s>]/gi) || []).length; divCloses = (l.match(/<\/div>/gi) || []).length; buf.push(l); if (divCloses >= divOpens) { inHtmlDiv = false; flush(); } continue; }
    if (inHtmlDiv) { buf.push(l); divOpens += (l.match(/<div[\s>]/gi) || []).length; divCloses += (l.match(/<\/div>/gi) || []).length; if (divCloses >= divOpens) { inHtmlDiv = false; flush(); } continue; }
    if (t.startsWith('|') && t.includes('|')) { if (!inMdTable) { flush(); inMdTable = true; } buf.push(l); continue; } else if (inMdTable) { inMdTable = false; flush(); }
    if (/^#{1,6}\s/.test(t)) { flush(); buf.push(l); flush(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flush(); buf.push(l); flush(); continue; }
    if (!t) { flush(); continue; }
    if (/^[-*+] /.test(t) || /^\d+\.\s/.test(t)) { if (buf.length && !/^[-*+] /.test(buf[0].trim()) && !/^\d+\.\s/.test(buf[0].trim())) flush(); buf.push(l); continue; }
    if (buf.length && (/^[-*+] /.test(buf[0].trim()) || /^\d+\.\s/.test(buf[0].trim()))) flush();
    if (t.startsWith('>')) { if (buf.length && !buf[0].trim().startsWith('>')) flush(); buf.push(l); continue; }
    if (buf.length && buf[0].trim().startsWith('>')) flush();
    buf.push(l);
  }
  flush();
  return blocks;
}

export function joinMdBlocks(blocks) { return blocks.join('\n\n'); }

// Re-anchor positional marks ('block-<n>') after a free-form source edit.
// onBlockAction keeps mark indices correct for structured edits (insert/move/delete),
// but editing the raw source can add or remove blocks, silently shifting every later
// mark onto the wrong block. We cannot diff arbitrary text reliably, so this is
// deliberately CONSERVATIVE: a mark only moves when its original block text still
// exists verbatim (whitespace-normalized) somewhere in the new content; ties resolve
// to the block nearest the old index, and each new block can claim at most one mark.
// No confident match → the mark is left untouched (no worse than before).
export function remapMarksByContent(oldContent, newContent, marks) {
  if (!marks || !marks.length) return marks || [];
  const oldBlocks = splitMdBlocks(oldContent);
  const newBlocks = splitMdBlocks(newContent);
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const newNorm = newBlocks.map(norm);
  const claimed = new Set();
  return marks.map(m => {
    const mt = /^block-(\d+)$/.exec(m.blockId || '');
    if (!mt) return m;                       // legacy/cell-level ids are not positional
    const oldIdx = parseInt(mt[1], 10);
    const target = norm(oldBlocks[oldIdx]);
    if (!target) return m;
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < newNorm.length; i++) {
      if (claimed.has(i) || newNorm[i] !== target) continue;
      const d = Math.abs(i - oldIdx);
      if (d < bestDist) { best = i; bestDist = d; }
    }
    if (best < 0) return m;
    claimed.add(best);
    return best === oldIdx ? m : { ...m, blockId: 'block-' + best };
  });
}
