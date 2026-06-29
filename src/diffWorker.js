// Diff Worker - Three-phase pipeline for accurate Markdown diff
// Pure diff logic now lives in ./lib/diff.js (reusable by Node/MCP).
// This worker is the streaming adapter: it calls the pure core and relays
// edits/stats back to the UI via self.postMessage, preserving the exact
// streaming/batching behavior the renderer depends on.
import {
  parseBlocks,
  matchBlocks,
  diffWithinBlock,
  computeStatsFromEdits,
  computeEditsLegacy,
  computeEditsLegacyStats,
  normalizeTextForDiff,
} from './lib/diff.js';
import { validateEdits, validateStats, mergeReports } from './canary.js';

// ===== Main Pipeline (new engine, streamed) =====

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
  const edits = computeEditsLegacy(oldText, newText);

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
  const edits = computeEditsLegacyStats(oldText, newText);
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
