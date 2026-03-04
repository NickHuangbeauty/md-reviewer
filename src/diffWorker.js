// Diff Worker - Three-phase pipeline for accurate Markdown diff
// Phase 1: Block segmentation & matching
// Phase 2: Similarity-based line pairing
// Phase 3: Enhanced normalization
import { diffTrimmedLines, diffChars } from 'diff';
import { validateEdits, validateStats, mergeReports } from './canary.js';

// ===== Utilities =====

/** Split value from jsdiff part into lines, dropping trailing empty string */
function splitLines(value) {
  return value.split('\n').filter((l, idx, arr) => !(idx === arr.length - 1 && l === ''));
}

// ===== Phase 3: Enhanced Normalization =====

function normalizeTextForDiff(text) {
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
function parseBlocks(text) {
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
function computeFingerprint(text) {
  return text
    .replace(/[|#*_`~>\-\[\](){}\\/<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

// ===== Phase 1: Block Matching =====

/** Token-Set Jaccard similarity between two texts (CJK-aware) */
function tokenSetJaccard(textA, textB) {
  const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/;
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
function matchBlocks(oldBlocks, newBlocks) {
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
function computeLineSimilarity(a, b) {
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
function pairBySimilarity(oldLines, newLines, startOldIdx, startNewIdx) {
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
function diffWithinBlock(oldBlock, newBlock) {
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

// ===== Main Pipeline =====

function computeAndStreamDiff(id, oldText, newText) {
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
  // Strategy: emit deleted blocks right before their next matched old-block's
  // corresponding position in the new document.
  const deletionsBeforeNewBlock = new Map(); // newBlockIdx → [oldBlock, ...]
  let deletionBuffer = [];
  for (let oi = 0; oi < oldBlocks.length; oi++) {
    if (unmatchedOld.has(oi)) {
      deletionBuffer.push(oldBlocks[oi]);
    } else {
      // Matched old block → flush pending deletions before this position
      const ni = oldToNew.get(oi);
      if (deletionBuffer.length > 0) {
        if (!deletionsBeforeNewBlock.has(ni)) deletionsBeforeNewBlock.set(ni, []);
        deletionsBeforeNewBlock.get(ni).push(...deletionBuffer);
        deletionBuffer = [];
      }
    }
  }
  // Remaining deletions after the last matched block → emit at end
  const trailingDeletions = deletionBuffer;

  // Streaming configuration
  const BATCH_SIZE = 200;
  let buffer = [];
  const allEditsForCanary = []; // Collect all edits for canary validation at complete
  const totalBlocks = newBlocks.length + (trailingDeletions.length > 0 ? 1 : 0);
  let processedBlocks = 0;

  const flush = () => {
    if (buffer.length > 0) {
      allEditsForCanary.push(...buffer);
      self.postMessage({
        id,
        type: 'progress',
        edits: buffer,
        progress: Math.min(99, Math.round((processedBlocks / Math.max(totalBlocks, 1)) * 100)),
      });
      buffer = [];
    }
  };

  // Walk through new blocks in order, interleaving deletions
  for (let ni = 0; ni < newBlocks.length; ni++) {
    // Emit deletions that belong before this new block
    if (deletionsBeforeNewBlock.has(ni)) {
      for (const block of deletionsBeforeNewBlock.get(ni)) {
        for (let li = 0; li < block.lines.length; li++) {
          buffer.push({ type: 'del', oldLine: block.lines[li], oldIdx: block.startLine + li });
        }
        if (buffer.length >= BATCH_SIZE) flush();
      }
    }

    if (pairs.has(ni)) {
      // Matched block → intra-block diff
      const oi = pairs.get(ni);
      const blockEdits = diffWithinBlock(oldBlocks[oi], newBlocks[ni]);
      buffer.push(...blockEdits);
    } else {
      // Unmatched new block → add
      const block = newBlocks[ni];
      for (let li = 0; li < block.lines.length; li++) {
        buffer.push({ type: 'add', newLine: block.lines[li], newIdx: block.startLine + li });
      }
    }

    processedBlocks++;
    if (buffer.length >= BATCH_SIZE) flush();
  }

  // Emit trailing deletions
  for (const block of trailingDeletions) {
    for (let li = 0; li < block.lines.length; li++) {
      buffer.push({ type: 'del', oldLine: block.lines[li], oldIdx: block.startLine + li });
    }
  }

  // Final flush
  flush();

  // Canary assertions on complete
  const canary = validateEdits(allEditsForCanary);
  if (canary.violations.length > 0) {
    canary.violations.forEach(v => console.warn('[Canary]', v.code, v.message));
  }
  if (canary.suspicious.length > 0) {
    canary.suspicious.forEach(s => console.warn('[Canary:Suspicious]', s.code, s.message));
  }

  self.postMessage({ id, type: 'complete', progress: 100, canary });
}

// ===== Stats-only computation (for Dashboard) =====

function isEmptyOrWhitespaceWorker(line) {
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

function computeStatsFromEdits(edits) {
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

function computeStatsOnly(id, oldText, newText) {
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

  const stats = computeStatsFromEdits(allEdits);

  // Canary assertions
  const canary = mergeReports(validateEdits(allEdits), validateStats(stats, allEdits));
  if (canary.violations.length > 0) {
    canary.violations.forEach(v => console.warn('[Canary]', v.code, v.message));
  }
  if (canary.suspicious.length > 0) {
    canary.suspicious.forEach(s => console.warn('[Canary:Suspicious]', s.code, s.message));
  }

  self.postMessage({ id, type: 'stats-complete', stats, canary });
}

// ===== Legacy Pipeline (Simple diffTrimmedLines + position-based pairing) =====
// Used when 'new-diff-engine' flag is OFF (production default)

function legacyComputeAndStreamDiff(id, oldText, newText) {
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
          edits.push({
            type: 'modify',
            oldLine: oldLines[j],
            newLine: newLines[j],
            oldIdx: oldIdx + j,
            newIdx: newIdx + j,
            similarity: computeLineSimilarity(oldLines[j], newLines[j]),
          });
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

  // Canary assertions
  const canary = validateEdits(edits);
  if (canary.violations.length > 0) {
    canary.violations.forEach(v => console.warn('[Canary]', v.code, v.message));
  }

  // Legacy sends all at once (no streaming)
  self.postMessage({ id, type: 'progress', edits, progress: 99 });
  self.postMessage({ id, type: 'complete', progress: 100, canary });
}

function legacyComputeStatsOnly(id, oldText, newText) {
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
          edits.push({ type: 'modify', oldLine: oldLines[j], newLine: newLines[j], oldIdx: oldIdx + j, newIdx: newIdx + j });
        } else if (j < oldLines.length) {
          edits.push({ type: 'del', oldLine: oldLines[j], oldIdx: oldIdx + j });
        } else {
          edits.push({ type: 'add', newLine: newLines[j], newIdx: newIdx + j });
        }
      }

      oldIdx += oldLines.length;
      newIdx += newLines.length;
      i++;
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

  const stats = computeStatsFromEdits(edits);

  const canary = mergeReports(validateEdits(edits), validateStats(stats, edits));
  if (canary.violations.length > 0) {
    canary.violations.forEach(v => console.warn('[Canary]', v.code, v.message));
  }

  self.postMessage({ id, type: 'stats-complete', stats, canary });
}

// ===== Worker Message Handler =====
self.onmessage = function (e) {
  const { id, oldText, newText, mode, flags } = e.data;
  // Determine engine: flags from main thread > compile-time VITE_CANARY > default OFF
  const useNewEngine = flags?.['new-diff-engine'] ?? !!import.meta.env.VITE_CANARY;

  try {
    if (mode === 'stats') {
      useNewEngine ? computeStatsOnly(id, oldText, newText) : legacyComputeStatsOnly(id, oldText, newText);
    } else {
      useNewEngine ? computeAndStreamDiff(id, oldText, newText) : legacyComputeAndStreamDiff(id, oldText, newText);
    }
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error.message });
  }
};
