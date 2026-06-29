// Review-mark injection — extracted from MdReviewer.jsx (Phase 1 refactor)
// Appends review marks as HTML comments after their target block. No React.

import { splitMdBlocks } from './markdown.js';

/* ===== INJECT MARKS ===== */
export function injectMarksToMd(content, marks) {
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
