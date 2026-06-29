// Markdown block-splitting pure logic — extracted from MdReviewer.jsx (Phase 1 refactor)
// Splits a markdown/HTML document into renderable blocks (code fences, HTML
// tables/divs, MD tables, headings, lists, blockquotes, paragraphs). No React.

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
