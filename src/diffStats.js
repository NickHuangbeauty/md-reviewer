// Shared change-magnitude ("變更幅度") logic — single source of truth for both
// the main thread (MdReviewer.jsx, DiffViewer severity bar) and the diff Web
// Worker (diffWorker.js, Dashboard stats). Previously this lived in two copies
// that had silently diverged: the worker classified bare structural HTML tags
// (<tr>, </table>, <br>, …) as low-weight while the JSX copy did not, so the
// two surfaces could report different ratios for the same diff. This module
// keeps the more complete worker behaviour as canonical.
//
// Pure functions only — no React, DOM, or worker globals — so both contexts can
// import it (the worker is instantiated with { type: 'module' }).

// A line counts as "empty / structural" (weight 0.1 instead of 1) when it carries
// no meaningful reviewable content: blank lines, Markdown table separators, empty
// cells, and bare structural HTML tags.
export function isEmptyOrWhitespace(line) {
  if (!line) return true;
  const t = line.trim();
  if (!t) return true;

  // Markdown 表格分隔行 |---|---|---| 視為結構標記，降低權重
  if (/^\|[\s-:]+\|[\s-:|]*$/.test(t)) return true;

  // Markdown 空表格行 |||| 或 |   |   |   | 視為無意義
  if (/^\|[\s|]*\|$/.test(t)) {
    const content = t.replace(/\|/g, '').trim();
    if (!content) return true;
  }

  // HTML 結構屬性（colspan, rowspan, height）視為有意義
  if (/colspan|rowspan|height/i.test(t)) return false;

  // 純空的 <td></td> 或 <th></th>（無任何屬性）才算無意義
  if (/^<(td|th)>\s*<\/(td|th)>$/i.test(t)) return true;

  // 只有空白的標籤（無文字內容）
  if (/^<\w+[^>]*>\s*<\/\w+>$/.test(t) && !/colspan|rowspan/i.test(t)) {
    const content = t.replace(/<[^>]*>/g, '').trim();
    if (!content) return true;
  }

  // 自封閉 / 結構 HTML 區塊標籤
  if (/^<\/?(?:br|hr|p|div|tr|td|th|table|thead|tbody)[\s/>]*$/i.test(t)) return true;

  return false;
}

// 變更幅度：(有意義新增 + 有意義刪除) ÷ 有意義原始行數，微調(空行/結構行)以 0.1 權重計入，上限 100%。
export function computeDiffStats(edits) {
  const total = edits.length;
  const added = edits.filter(e => e.type === 'add').length;
  const deleted = edits.filter(e => e.type === 'del').length;
  const modified = edits.filter(e => e.type === 'modify').length;
  const unchanged = edits.filter(e => e.type === 'eq').length;

  // 原始文件總行數（eq + del + modify 都來自舊文件）
  const oldTotal = deleted + unchanged + modified;

  let meaningfulAdded = 0;
  let meaningfulDeleted = 0;
  edits.forEach(e => {
    if (e.type === 'add') meaningfulAdded += isEmptyOrWhitespace(e.newLine) ? 0.1 : 1;
    else if (e.type === 'del') meaningfulDeleted += isEmptyOrWhitespace(e.oldLine) ? 0.1 : 1;
  });

  const weightedChanges = meaningfulAdded + meaningfulDeleted;

  // 有意義的原始行數（排除空行/結構行）
  const meaningfulOldTotal = edits.filter(e =>
    (e.type === 'del' || e.type === 'eq' || e.type === 'modify') &&
    !isEmptyOrWhitespace(e.oldLine)
  ).length || oldTotal || 1;

  const rawRatio = meaningfulOldTotal > 0 ? weightedChanges / meaningfulOldTotal : (added > 0 ? 1 : 0);
  const changeRatio = Math.min(rawRatio, 1.0);

  return { total, added, deleted, modified, unchanged, changed: added + deleted + modified, changeRatio, oldTotal };
}
