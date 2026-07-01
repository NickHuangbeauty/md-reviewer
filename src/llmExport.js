// src/llmExport.js
// Pure helpers: turn a file's markdown + review marks into LLM-friendly output.
// A mark: { blockId: 'block-<n>', issue?: string, quote?: string }
import { splitMdBlocks, joinMdBlocks } from './mdBlocks.js';

const EMPTY_ISSUE = '（未填述，標示此處有誤）';

// Neutralize every HTML-comment terminator so user text can't break out of the
// <!-- ... --> wrapper. Both '-->' and '--!>' close a comment per the HTML spec.
export function escapeComment(s) { return (s || '').replace(/--!?>/g, '—>'); }

// A short, human-readable excerpt of a block for anchoring an annotation.
export function blockQuote(blockText, max = 24) {
  let s = (blockText || '').split('\n')[0];
  s = s.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').replace(/^>\s?/, '');
  s = s.replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function markNumberMap(marks) {
  const byBlock = {};
  marks.forEach(m => { (byBlock[m.blockId] = byBlock[m.blockId] || []).push(m); });
  return byBlock;
}

function quoteOf(mark, blockText) {
  return escapeComment(mark.quote && mark.quote.trim() ? mark.quote.trim() : blockQuote(blockText));
}
function issueOf(mark) {
  return escapeComment(mark.issue && mark.issue.trim() ? mark.issue.trim() : EMPTY_ISSUE);
}

// Annotate the markdown: inline anchored comments after each marked block, plus a
// leading header. `header` controls that leading block:
//   'full'    — full explanatory header + 問題總表 (for a standalone downloaded .md)
//   'summary' — just the 問題總表 index, no instructions (for the copy-prompt path,
//               where the preamble already carries the instructions — avoids dupes)
//   'none'    — body only
export function buildAnnotatedMd(content, marks, opts = {}) {
  if (!marks || !marks.length) return content;
  const header = opts.header || 'full';
  const blocks = splitMdBlocks(content);
  const byBlock = markNumberMap(marks);
  const maxIdx = blocks.length - 1;

  // Single pass: assign the global 1-based number as each mark is emitted, so the
  // inline annotation and the summary line always carry the same #n.
  let n = 0;
  const summary = [];
  const out = [];
  const emit = (m, blockText) => {
    n += 1;
    const q = quoteOf(m, blockText), i = issueOf(m);
    out.push(`<!-- [審核問題 #${n}] 段落:「${q}」｜問題:${i} -->`);
    summary.push(`    #${n}「${q}」— ${i}`);
  };
  blocks.forEach((b, bi) => {
    out.push(b);
    (byBlock['block-' + bi] || []).forEach(m => emit(m, b));
  });
  // Orphan marks (blockId out of range / not 'block-<n>') appended at the end.
  marks.forEach(m => {
    const mi = /^block-(\d+)$/.exec(m.blockId || '');
    if (!mi || parseInt(mi[1], 10) > maxIdx) emit(m, '');
  });

  const body = joinMdBlocks(out);
  if (header === 'none') return body;
  if (header === 'summary') {
    return `<!-- 問題總表（共 ${n} 處，詳見文中各 [審核問題 #n]）：\n${summary.join('\n')}\n-->` + '\n\n' + body;
  }
  const full =
`<!-- ═══ 審核回饋｜給 LLM 的說明 ═══
  本檔含 ${n} 處審核標記，格式 [審核問題 #n]，置於所指段落正下方。
  請逐條產出問題清單報告，欄位：編號／位置(第幾段)／原文摘錄／問題描述／建議修正／嚴重度。
  只依標記與內文判斷，不要杜撰。
  問題總表：
${summary.join('\n')}
═══════════════════════════ -->`;
  return full + '\n\n' + body;
}

// A ready-to-paste review prompt: a general (domain-agnostic) instruction preamble
// + the annotated MD with only the 問題總表 embedded (no duplicate instructions).
export function buildLlmPrompt(fileName, content, marks) {
  if (!marks || !marks.length) return null;
  const preamble =
`你是專業的文件審核助手。以下 Markdown（檔名：${fileName}）是一份「解析後的文件」，內含審核者就地標記的問題，格式為 <!-- [審核問題 #n] 段落:「…」｜問題:… -->，緊接在它所指的段落下方。

請對照每個標記與其上方段落，產出一份「問題清單報告」，逐條列出，每條包含：
1. 編號（對應 #n）
2. 位置（第幾個段落／原文摘錄）
3. 標記者描述的問題
4. 你的判斷與佐證（依內文）
5. 建議修正
6. 嚴重度（高／中／低）

只依標記與文件內文判斷，不要杜撰未出現的內容。若標記未附描述，仍請依內文推測可能疑點並註明「僅標示、未描述」。

===== 待審文件開始 =====`;
  return preamble + '\n\n' + buildAnnotatedMd(content, marks, { header: 'summary' }) + '\n\n===== 待審文件結束 =====';
}
