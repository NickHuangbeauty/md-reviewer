// Diff Core — Pure functional diff engine (no Worker, no postMessage)
// Extracted from src/diffWorker.js so that both the Web Worker (UI streaming)
// and Node-based consumers (e.g. MCP) can reuse identical diff logic.
//
// Three-phase pipeline:
//   Phase 1: Block segmentation & matching
//   Phase 2: Similarity-based line pairing
//   Phase 3: Enhanced normalization
//
// IMPORTANT: Algorithm and thresholds must stay byte-for-byte identical to the
// original worker implementation — this file is a pure move, not a rewrite.
import { diffTrimmedLines, diffChars } from 'diff';

// ===== Utilities =====

/** Split value from jsdiff part into lines, dropping trailing empty string */
export function splitLines(value) {
  return value.split('\n').filter((l, idx, arr) => !(idx === arr.length - 1 && l === ''));
}

// ===== Phase 3: Enhanced Normalization =====

export function normalizeTextForDiff(text) {
  if (!text) return '';
  let n = text;

  // Unify line endings
  n = n.replace(/\r\n/g, '\n');

  // MD table separator lines: |---|:---:|---| → |---|---|---|
  n = n.replace(/^\|[\s-:]+\|[\s-:|]*$/gm, match => {
    const cols = (match.match(/\|/g) || []).length - 1;
    return '|' + Array(Math.max(cols, 1)).fill('---').join('|') + '|';
  });

  // HTML self-closing tags: <br/>, <br />, <hr/>, <hr /> → <br>, <hr>
  n = n.replace(/<(br|hr|img|input)\s*\/?>/gi, '<$1>');

  // Trim content inside <td>/<th> tags
  n = n.replace(/(<(?:td|th)[^>]*>)\s*([\s\S]*?)\s*(<\/(?:td|th)>)/gi, '$1$2$3');

  // Remove decorative HTML attributes (class, id, style, width, etc.)
  n = n.replace(/\s+(class|id|style|width|height|align|valign|bgcolor|border|cellpadding|cellspacing)="[^"]*"/gi, '');

  // Normalize table cell whitespace & trailing whitespace per line
  n = n.split('\n').map(line => {
    const t = line.trim();
    // MD table row: starts and ends with |
    if (t.startsWith('|') && t.endsWith('|') && t.length > 2) {
      return t.split('|').map(cell => cell.trim()).join('|');
    }
    return line.trimEnd();
  }).join('\n');

  return n;
}

// ===== Phase 1: Block Segmentation =====

/**
 * Parse text into structured blocks with type, lines, and fingerprint.
 * Each block: { type, text, lines[], startLine, fingerprint }
 */
export function parseBlocks(text) {
  if (!text) return [];
  const rawLines = text.split('\n');
  const blocks = [];
  let buf = [];
  let bufStart = 0;
  let blockType = 'paragraph';
  let inHtmlTable = false;
  let inMdTable = false;
  let inCodeFence = false;
  let inHtmlDiv = false;

  const flush = (type) => {
    if (buf.length) {
      const raw = buf.join('\n');
      if (raw.trim()) {
        blocks.push({
          type: type || blockType,
          text: raw,
          lines: [...buf],
          startLine: bufStart,
          fingerprint: computeFingerprint(raw),
        });
      }
      buf = [];
      blockType = 'paragraph';
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    const t = l.trim();

    if (buf.length === 0) bufStart = i;

    // Code fence ``` ... ```
    if (t.startsWith('```')) {
      if (!inCodeFence) {
        flush('paragraph');
        bufStart = i;
        inCodeFence = true;
        blockType = 'code';
        buf.push(l);
      } else {
        buf.push(l);
        inCodeFence = false;
        flush('code');
      }
      continue;
    }
    if (inCodeFence) { buf.push(l); continue; }

    // HTML table
    if (!inHtmlTable && /<table/i.test(t)) {
      flush(blockType);
      bufStart = i;
      inHtmlTable = true;
      blockType = 'html-table';
      buf.push(l);
      const fullBuf = buf.join('\n');
      const opens = (fullBuf.match(/<table/gi) || []).length;
      const closes = (fullBuf.match(/<\/table>/gi) || []).length;
      if (closes >= opens) { inHtmlTable = false; flush('html-table'); }
      continue;
    }
    if (inHtmlTable) {
      buf.push(l);
      const fullBuf = buf.join('\n');
      const opens = (fullBuf.match(/<table/gi) || []).length;
      const closes = (fullBuf.match(/<\/table>/gi) || []).length;
      if (closes >= opens) { inHtmlTable = false; flush('html-table'); }
      continue;
    }

    // HTML div block
    if (!inHtmlDiv && /^<div[\s>]/i.test(t)) {
      flush(blockType);
      bufStart = i;
      inHtmlDiv = true;
      blockType = 'html-div';
      buf.push(l);
      const fullBuf = buf.join('\n');
      if ((fullBuf.match(/<\/div>/gi) || []).length >= (fullBuf.match(/<div[\s>]/gi) || []).length) {
        inHtmlDiv = false; flush('html-div');
      }
      continue;
    }
    if (inHtmlDiv) {
      buf.push(l);
      const fullBuf = buf.join('\n');
      if ((fullBuf.match(/<\/div>/gi) || []).length >= (fullBuf.match(/<div[\s>]/gi) || []).length) {
        inHtmlDiv = false; flush('html-div');
      }
      continue;
    }

    // MD table
    if (t.startsWith('|') && t.includes('|')) {
      if (!inMdTable) {
        flush(blockType);
        bufStart = i;
        inMdTable = true;
        blockType = 'md-table';
      }
      buf.push(l);
      continue;
    } else if (inMdTable) {
      inMdTable = false;
      flush('md-table');
      bufStart = i;
    }

    // Heading
    if (/^#{1,6}\s/.test(t)) {
      flush(blockType);
      bufStart = i;
      buf.push(l);
      flush('heading');
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flush(blockType);
      bufStart = i;
      buf.push(l);
      flush('hr');
      continue;
    }

    // Empty line → flush
    if (!t) { flush(blockType); continue; }

    // List item
    if (/^[-*+] /.test(t) || /^\d+\.\s/.test(t)) {
      if (buf.length && blockType !== 'list') {
        flush(blockType);
        bufStart = i;
      }
      blockType = 'list';
      buf.push(l);
      continue;
    }
    if (blockType === 'list') {
      flush('list');
      bufStart = i;
    }

    // Blockquote
    if (t.startsWith('>')) {
      if (buf.length && blockType !== 'blockquote') {
        flush(blockType);
        bufStart = i;
      }
      blockType = 'blockquote';
      buf.push(l);
      continue;
    }
    if (blockType === 'blockquote') {
      flush('blockquote');
      bufStart = i;
    }

    // Default: paragraph
    blockType = 'paragraph';
    buf.push(l);
  }
  flush(blockType);
  return blocks;
}

/** Fingerprint: strip formatting, lowercase, first 200 chars */
export function computeFingerprint(text) {
  return text
    .replace(/[|#*_`~>\-\[\](){}\\/<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

// ===== Phase 1: Block Matching =====

/** Token-Set Jaccard similarity between two texts (CJK-aware) */
export function tokenSetJaccard(textA, textB) {
  const CJK_RE = /[一-鿿㐀-䶿　-〿＀-￯]/;
  const tokenize = (t) => {
    const set = new Set();
    // Split on whitespace, pipes, and common delimiters for fine-grained comparison
    for (const w of t.toLowerCase().split(/[\s|,;:(){}\[\]<>]+/)) {
      if (!w || /^-+$/.test(w)) continue; // skip empty and separator dashes
      if (CJK_RE.test(w)) {
        for (const ch of w) { if (ch.trim()) set.add(ch); }
      } else {
        set.add(w);
      }
    }
    return set;
  };
  const setA = tokenize(textA);
  const setB = tokenize(textB);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Match old blocks to new blocks.
 * Returns: { pairs: Map<newIdx, oldIdx>, unmatchedOld: Set, unmatchedNew: Set }
 */
export function matchBlocks(oldBlocks, newBlocks) {
  const pairs = new Map(); // newIdx → oldIdx
  const usedOld = new Set();
  const usedNew = new Set();

  // Pass 1: Fingerprint exact match
  const fpMap = new Map(); // fingerprint → [oldIdx, ...]
  for (let i = 0; i < oldBlocks.length; i++) {
    const fp = oldBlocks[i].fingerprint;
    if (!fp) continue;
    if (!fpMap.has(fp)) fpMap.set(fp, []);
    fpMap.get(fp).push(i);
  }

  for (let ni = 0; ni < newBlocks.length; ni++) {
    const fp = newBlocks[ni].fingerprint;
    if (!fp || !fpMap.has(fp)) continue;
    const candidates = fpMap.get(fp);
    for (let c = 0; c < candidates.length; c++) {
      const oi = candidates[c];
      if (!usedOld.has(oi)) {
        pairs.set(ni, oi);
        usedOld.add(oi);
        usedNew.add(ni);
        candidates.splice(c, 1);
        break;
      }
    }
  }

  // Pass 2: Fuzzy match (same-type blocks, Jaccard > 0.3)
  const remainingOld = [];
  for (let i = 0; i < oldBlocks.length; i++) {
    if (!usedOld.has(i)) remainingOld.push(i);
  }
  const remainingNew = [];
  for (let i = 0; i < newBlocks.length; i++) {
    if (!usedNew.has(i)) remainingNew.push(i);
  }

  // Build similarity candidates
  const candidates = [];
  for (const ni of remainingNew) {
    for (const oi of remainingOld) {
      if (oldBlocks[oi].type !== newBlocks[ni].type) continue;
      const sim = tokenSetJaccard(oldBlocks[oi].text, newBlocks[ni].text);
      if (sim > 0.3) {
        candidates.push({ ni, oi, sim });
      }
    }
  }
  // Greedy: best similarity first
  candidates.sort((a, b) => b.sim - a.sim);
  for (const { ni, oi } of candidates) {
    if (usedOld.has(oi) || usedNew.has(ni)) continue;
    pairs.set(ni, oi);
    usedOld.add(oi);
    usedNew.add(ni);
  }

  const unmatchedOld = new Set();
  for (let i = 0; i < oldBlocks.length; i++) {
    if (!usedOld.has(i)) unmatchedOld.add(i);
  }
  const unmatchedNew = new Set();
  for (let i = 0; i < newBlocks.length; i++) {
    if (!usedNew.has(i)) unmatchedNew.add(i);
  }

  return { pairs, unmatchedOld, unmatchedNew };
}

// ===== Phase 2: Similarity-Based Line Pairing =====

/** Compute similarity between two lines using character-level diff (handles CJK) */
export function computeLineSimilarity(a, b) {
  if (a === b) return 1.0;
  if (!a || !b) return 0;
  // Quick length check
  if (Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.2) return 0;
  // For very long lines, use token-based approximation
  if (a.length + b.length > 1000) {
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));
    let inter = 0;
    for (const w of setA) { if (setB.has(w)) inter++; }
    return (setA.size + setB.size) === 0 ? 0 : (2 * inter) / (setA.size + setB.size);
  }
  // Use diffChars for accurate CJK/multilingual similarity
  const dc = diffChars(a, b);
  const unchanged = dc.filter(p => !p.added && !p.removed).reduce((s, p) => s + p.value.length, 0);
  return unchanged / Math.max(a.length, b.length, 1);
}

/**
 * Pair removed/added lines by similarity instead of by position.
 * Returns edits array with proper oldIdx/newIdx.
 */
export function pairBySimilarity(oldLines, newLines, startOldIdx, startNewIdx) {
  const edits = [];

  if (oldLines.length === 0) {
    for (let j = 0; j < newLines.length; j++) {
      edits.push({ type: 'add', newLine: newLines[j], newIdx: startNewIdx + j });
    }
    return edits;
  }
  if (newLines.length === 0) {
    for (let i = 0; i < oldLines.length; i++) {
      edits.push({ type: 'del', oldLine: oldLines[i], oldIdx: startOldIdx + i });
    }
    return edits;
  }

  // Build matches using greedy best-similarity
  const matches = new Map(); // oldLineIdx → { newLineIdx, similarity }
  const usedOld = new Set();
  const usedNew = new Set();

  if (oldLines.length <= 8 && newLines.length <= 8) {
    // Small group: full N×M matrix
    const sims = [];
    for (let i = 0; i < oldLines.length; i++) {
      for (let j = 0; j < newLines.length; j++) {
        const sim = computeLineSimilarity(oldLines[i], newLines[j]);
        if (sim > 0.5) sims.push({ i, j, sim });
      }
    }
    sims.sort((a, b) => b.sim - a.sim);
    for (const { i, j, sim } of sims) {
      if (usedOld.has(i) || usedNew.has(j)) continue;
      matches.set(i, { j, sim });
      usedOld.add(i);
      usedNew.add(j);
    }
  } else {
    // Large group: exact match first → Jaccard pre-filter → diffWords confirm
    // Pass A: exact match
    const newLineMap = new Map(); // line → [idx, ...]
    for (let j = 0; j < newLines.length; j++) {
      const key = newLines[j].trim();
      if (!newLineMap.has(key)) newLineMap.set(key, []);
      newLineMap.get(key).push(j);
    }
    for (let i = 0; i < oldLines.length; i++) {
      const key = oldLines[i].trim();
      if (newLineMap.has(key)) {
        const candidates = newLineMap.get(key);
        for (let c = 0; c < candidates.length; c++) {
          const j = candidates[c];
          if (!usedNew.has(j)) {
            matches.set(i, { j, sim: 1.0 });
            usedOld.add(i);
            usedNew.add(j);
            candidates.splice(c, 1);
            break;
          }
        }
      }
    }

    // Pass B: Jaccard pre-filter for remaining
    const remOld = [];
    for (let i = 0; i < oldLines.length; i++) { if (!usedOld.has(i)) remOld.push(i); }
    const remNew = [];
    for (let j = 0; j < newLines.length; j++) { if (!usedNew.has(j)) remNew.push(j); }

    if (remOld.length > 0 && remNew.length > 0 && remOld.length * remNew.length <= 200) {
      // Manageable size: compute similarity
      const sims = [];
      for (const i of remOld) {
        for (const j of remNew) {
          const sim = computeLineSimilarity(oldLines[i], newLines[j]);
          if (sim > 0.5) sims.push({ i, j, sim });
        }
      }
      sims.sort((a, b) => b.sim - a.sim);
      for (const { i, j, sim } of sims) {
        if (usedOld.has(i) || usedNew.has(j)) continue;
        matches.set(i, { j, sim });
        usedOld.add(i);
        usedNew.add(j);
      }
    }
    // If still too many remaining, fallback to position-based for the rest
  }

  // Emit edits: unmatched old as del, then for each new line: modify if matched, add if not
  // Build reverse map: newLineIdx → { oldLineIdx, similarity }
  const reverseMatches = new Map();
  for (const [oi, { j, sim }] of matches) {
    reverseMatches.set(j, { oi, sim });
  }

  // Emit unmatched old lines as del first
  for (let i = 0; i < oldLines.length; i++) {
    if (!usedOld.has(i)) {
      edits.push({ type: 'del', oldLine: oldLines[i], oldIdx: startOldIdx + i });
    }
  }

  // Emit new lines: modify if matched, add if not
  for (let j = 0; j < newLines.length; j++) {
    if (reverseMatches.has(j)) {
      const { oi, sim } = reverseMatches.get(j);
      edits.push({
        type: 'modify',
        oldLine: oldLines[oi],
        newLine: newLines[j],
        oldIdx: startOldIdx + oi,
        newIdx: startNewIdx + j,
        similarity: sim,
      });
    } else {
      edits.push({ type: 'add', newLine: newLines[j], newIdx: startNewIdx + j });
    }
  }

  return edits;
}

// ===== Intra-Block Diff =====

/** Run diffTrimmedLines within a matched block pair, using similarity-based pairing */
export function diffWithinBlock(oldBlock, newBlock) {
  const diffs = diffTrimmedLines(oldBlock.text + '\n', newBlock.text + '\n');
  const edits = [];
  let oldIdx = oldBlock.startLine;
  let newIdx = newBlock.startLine;
  let i = 0;

  while (i < diffs.length) {
    const part = diffs[i];
    const lines = splitLines(part.value);

    if (!part.added && !part.removed) {
      for (const line of lines) {
        edits.push({ type: 'eq', oldLine: line, newLine: line, oldIdx: oldIdx++, newIdx: newIdx++ });
      }
      i++;
    } else if (part.removed && diffs[i + 1]?.added) {
      const oldLines = splitLines(part.value);
      const newLines = splitLines(diffs[i + 1].value);
      const paired = pairBySimilarity(oldLines, newLines, oldIdx, newIdx);
      edits.push(...paired);
      oldIdx += oldLines.length;
      newIdx += newLines.length;
      i += 2;
    } else if (part.added) {
      for (const line of lines) {
        edits.push({ type: 'add', newLine: line, newIdx: newIdx++ });
      }
      i++;
    } else if (part.removed) {
      for (const line of lines) {
        edits.push({ type: 'del', oldLine: line, oldIdx: oldIdx++ });
      }
      i++;
    } else {
      i++;
    }
  }
  return edits;
}

// ===== New-engine edit assembly (pure, non-streaming) =====

/**
 * Assemble the full edits array using the new engine (block segmentation →
 * matching → similarity pairing). This mirrors exactly the order the worker's
 * streaming pipeline emits edits in, so UI output stays byte-for-byte identical.
 */
export function computeEditsNewEngine(oldText, newText) {
  const normOld = normalizeTextForDiff(oldText || '');
  const normNew = normalizeTextForDiff(newText || '');

  // Phase 1: Block segmentation
  const oldBlocks = parseBlocks(normOld);
  const newBlocks = parseBlocks(normNew);

  // Phase 1: Block matching
  const { pairs, unmatchedOld } = matchBlocks(oldBlocks, newBlocks);

  // Build reverse map: oldIdx → newIdx
  const oldToNew = new Map();
  for (const [ni, oi] of pairs) oldToNew.set(oi, ni);

  // Determine where deleted (unmatched old) blocks should appear in the output.
  const deletionsBeforeNewBlock = new Map(); // newBlockIdx → [oldBlock, ...]
  let deletionBuffer = [];
  for (let oi = 0; oi < oldBlocks.length; oi++) {
    if (unmatchedOld.has(oi)) {
      deletionBuffer.push(oldBlocks[oi]);
    } else {
      const ni = oldToNew.get(oi);
      if (deletionBuffer.length > 0) {
        if (!deletionsBeforeNewBlock.has(ni)) deletionsBeforeNewBlock.set(ni, []);
        deletionsBeforeNewBlock.get(ni).push(...deletionBuffer);
        deletionBuffer = [];
      }
    }
  }
  const trailingDeletions = deletionBuffer;

  const edits = [];

  // Walk through new blocks in order, interleaving deletions
  for (let ni = 0; ni < newBlocks.length; ni++) {
    if (deletionsBeforeNewBlock.has(ni)) {
      for (const block of deletionsBeforeNewBlock.get(ni)) {
        for (let li = 0; li < block.lines.length; li++) {
          edits.push({ type: 'del', oldLine: block.lines[li], oldIdx: block.startLine + li });
        }
      }
    }

    if (pairs.has(ni)) {
      const oi = pairs.get(ni);
      edits.push(...diffWithinBlock(oldBlocks[oi], newBlocks[ni]));
    } else {
      const block = newBlocks[ni];
      for (let li = 0; li < block.lines.length; li++) {
        edits.push({ type: 'add', newLine: block.lines[li], newIdx: block.startLine + li });
      }
    }
  }

  // Emit trailing deletions
  for (const block of trailingDeletions) {
    for (let li = 0; li < block.lines.length; li++) {
      edits.push({ type: 'del', oldLine: block.lines[li], oldIdx: block.startLine + li });
    }
  }

  return edits;
}

/**
 * Stats-only edit assembly for the new engine. NOTE: unlike the streaming
 * pipeline, deletions are collected up-front (matching the worker's
 * computeStatsOnly), which is fine because stats are order-independent.
 */
export function computeEditsNewEngineStats(oldText, newText) {
  const normOld = normalizeTextForDiff(oldText || '');
  const normNew = normalizeTextForDiff(newText || '');
  const oldBlocks = parseBlocks(normOld);
  const newBlocks = parseBlocks(normNew);
  const { pairs, unmatchedOld } = matchBlocks(oldBlocks, newBlocks);

  const allEdits = [];

  // Collect deletions from unmatched old blocks
  for (const oi of unmatchedOld) {
    for (let li = 0; li < oldBlocks[oi].lines.length; li++) {
      allEdits.push({ type: 'del', oldLine: oldBlocks[oi].lines[li], oldIdx: oldBlocks[oi].startLine + li });
    }
  }

  // Walk new blocks
  for (let ni = 0; ni < newBlocks.length; ni++) {
    if (pairs.has(ni)) {
      const oi = pairs.get(ni);
      allEdits.push(...diffWithinBlock(oldBlocks[oi], newBlocks[ni]));
    } else {
      for (let li = 0; li < newBlocks[ni].lines.length; li++) {
        allEdits.push({ type: 'add', newLine: newBlocks[ni].lines[li], newIdx: newBlocks[ni].startLine + li });
      }
    }
  }

  return allEdits;
}

// ===== Legacy edit assembly (simple diffTrimmedLines + position pairing) =====

/** Shared legacy edit walk. `withSimilarity` includes per-line similarity on modify edits. */
function legacyComputeEdits(oldText, newText, withSimilarity) {
  const normOld = normalizeTextForDiff(oldText || '');
  const normNew = normalizeTextForDiff(newText || '');

  const diffs = diffTrimmedLines(normOld + '\n', normNew + '\n');
  const edits = [];
  let oldIdx = 0;
  let newIdx = 0;

  for (let i = 0; i < diffs.length; i++) {
    const part = diffs[i];
    const lines = splitLines(part.value);

    if (!part.added && !part.removed) {
      for (const line of lines) {
        edits.push({ type: 'eq', oldLine: line, newLine: line, oldIdx: oldIdx++, newIdx: newIdx++ });
      }
    } else if (part.removed && diffs[i + 1]?.added) {
      const oldLines = lines;
      const newLines = splitLines(diffs[i + 1].value);
      const maxLen = Math.max(oldLines.length, newLines.length);

      for (let j = 0; j < maxLen; j++) {
        if (j < oldLines.length && j < newLines.length) {
          const edit = {
            type: 'modify',
            oldLine: oldLines[j],
            newLine: newLines[j],
            oldIdx: oldIdx + j,
            newIdx: newIdx + j,
          };
          if (withSimilarity) edit.similarity = computeLineSimilarity(oldLines[j], newLines[j]);
          edits.push(edit);
        } else if (j < oldLines.length) {
          edits.push({ type: 'del', oldLine: oldLines[j], oldIdx: oldIdx + j });
        } else {
          edits.push({ type: 'add', newLine: newLines[j], newIdx: newIdx + j });
        }
      }

      oldIdx += oldLines.length;
      newIdx += newLines.length;
      i++; // Skip the added part
    } else if (part.added) {
      for (const line of lines) {
        edits.push({ type: 'add', newLine: line, newIdx: newIdx++ });
      }
    } else if (part.removed) {
      for (const line of lines) {
        edits.push({ type: 'del', oldLine: line, oldIdx: oldIdx++ });
      }
    }
  }

  return edits;
}

/** Legacy full edits (modify edits carry similarity, matching legacyComputeAndStreamDiff). */
export function computeEditsLegacy(oldText, newText) {
  return legacyComputeEdits(oldText, newText, true);
}

/** Legacy stats edits (no similarity, matching legacyComputeStatsOnly). */
export function computeEditsLegacyStats(oldText, newText) {
  return legacyComputeEdits(oldText, newText, false);
}

// ===== Stats =====

export function isEmptyOrWhitespaceWorker(line) {
  if (!line) return true;
  const t = line.trim();
  if (!t) return true;

  // Markdown 表格分隔行 |---|---|---| 視為結構標記
  if (/^\|[\s-:]+\|[\s-:|]*$/.test(t)) return true;

  // Markdown 空表格行 |||| 或 |   |   |   |
  if (/^\|[\s|]*\|$/.test(t)) {
    const content = t.replace(/\|/g, '').trim();
    if (!content) return true;
  }

  // HTML 結構屬性（colspan, rowspan, height）視為有意義
  if (/colspan|rowspan|height/i.test(t)) return false;

  // 純空的 <td></td> 或 <th></th>
  if (/^<(td|th)>\s*<\/(td|th)>$/i.test(t)) return true;

  // 空白 HTML 標籤（無文字內容）
  if (/^<\w+[^>]*>\s*<\/\w+>$/.test(t) && !/colspan|rowspan/i.test(t)) {
    const content = t.replace(/<[^>]*>/g, '').trim();
    if (!content) return true;
  }

  // 自封閉 HTML 區塊標籤
  if (/^<\/?(?:br|hr|p|div|tr|td|th|table|thead|tbody)[\s/>]*$/i.test(t)) return true;

  return false;
}

export function computeStatsFromEdits(edits) {
  const added = edits.filter(e => e.type === 'add').length;
  const deleted = edits.filter(e => e.type === 'del').length;
  const modified = edits.filter(e => e.type === 'modify').length;
  const unchanged = edits.filter(e => e.type === 'eq').length;
  const oldTotal = deleted + unchanged + modified;

  let meaningfulAdded = 0, meaningfulDeleted = 0;
  edits.forEach(e => {
    if (e.type === 'add') meaningfulAdded += isEmptyOrWhitespaceWorker(e.newLine) ? 0.1 : 1;
    else if (e.type === 'del') meaningfulDeleted += isEmptyOrWhitespaceWorker(e.oldLine) ? 0.1 : 1;
  });

  const weightedChanges = meaningfulAdded + meaningfulDeleted;

  const meaningfulOldTotal = edits.filter(e =>
    (e.type === 'del' || e.type === 'eq' || e.type === 'modify') && !isEmptyOrWhitespaceWorker(e.oldLine)
  ).length || oldTotal || 1;

  const changeRatio = Math.min(meaningfulOldTotal > 0 ? weightedChanges / meaningfulOldTotal : (added > 0 ? 1 : 0), 1.0);

  return { added, deleted, modified, unchanged, changed: added + deleted + modified, changeRatio, oldTotal };
}

// ===== Pure public API =====

/**
 * Compute a full diff between two texts.
 * @param {string} oldText
 * @param {string} newText
 * @param {{ legacy?: boolean }} [opts] — when `legacy === true`, use the simple
 *   position-based pipeline; otherwise the new block-based engine (default).
 * @returns {{ edits: Array, stats: Object }}
 */
export function computeDiff(oldText, newText, opts = {}) {
  const edits = opts.legacy === true
    ? computeEditsLegacy(oldText, newText)
    : computeEditsNewEngine(oldText, newText);
  const stats = computeStatsFromEdits(edits);
  return { edits, stats };
}

/**
 * Compute only the stats for a diff between two texts.
 * @param {string} oldText
 * @param {string} newText
 * @param {{ legacy?: boolean }} [opts]
 * @returns {Object} stats (output of computeStatsFromEdits)
 */
export function computeDiffStats(oldText, newText, opts = {}) {
  const edits = opts.legacy === true
    ? computeEditsLegacyStats(oldText, newText)
    : computeEditsNewEngineStats(oldText, newText);
  return computeStatsFromEdits(edits);
}
