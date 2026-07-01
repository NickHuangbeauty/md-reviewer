// src/llmExport.js
// Pure helpers: turn a file's markdown + review marks into LLM-friendly output.
// A mark: { blockId: 'block-<n>', issue?: string, quote?: string }
import { splitMdBlocks, joinMdBlocks } from './mdBlocks.js';

const EMPTY_ISSUE = '（未填述，BU 標示此處有誤）';

export function escapeComment(s) { return (s || '').replace(/-->/g, '—>'); }

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
function annotationLine(mark, blockText, n) {
  return `<!-- [審核問題 #${n}] 段落:「${quoteOf(mark, blockText)}」｜問題:${issueOf(mark)} -->`;
}

// Enriched download MD: header summary + inline anchored comments after each block.
export function buildAnnotatedMd(content, marks) {
  if (!marks || !marks.length) return content;
  const blocks = splitMdBlocks(content);
  const byBlock = markNumberMap(marks);
  const maxIdx = blocks.length - 1;

  // Global 1-based numbering in block order, then orphans (out-of-range blockId).
  let n = 0;
  const numbered = []; // { mark, blockText, num }
  blocks.forEach((b, bi) => {
    (byBlock['block-' + bi] || []).forEach(m => { n += 1; numbered.push({ mark: m, blockText: b, num: n }); });
  });
  marks.forEach(m => {
    const mi = /^block-(\d+)$/.exec(m.blockId || '');
    if (!mi || parseInt(mi[1], 10) > maxIdx) { n += 1; numbered.push({ mark: m, blockText: '', num: n }); }
  });

  const summary = numbered.map(x => `    #${x.num}「${quoteOf(x.mark, x.blockText)}」— ${issueOf(x.mark)}`).join('\n');

  const header =
`<!-- ═══ 審核回饋｜給 LLM 的說明 ═══
  本檔含 ${numbered.length} 處 BU 標記，格式 [審核問題 #n]，置於所指段落正下方。
  請逐條產出問題清單報告，欄位：編號／位置(第幾段)／原文摘錄／問題描述／建議修正／嚴重度。
  只依標記與內文判斷，不要杜撰。
  問題總表：
${summary}
═══════════════════════════ -->`;

  const out = [];
  blocks.forEach((b, bi) => {
    out.push(b);
    (byBlock['block-' + bi] || []).forEach(m => {
      const num = numbered.find(x => x.mark === m).num;
      out.push(annotationLine(m, b, num));
    });
  });
  numbered.filter(x => x.blockText === '').forEach(x => out.push(annotationLine(x.mark, '', x.num)));

  return header + '\n\n' + joinMdBlocks(out);
}

// A ready-to-paste review prompt: instruction preamble + the annotated MD.
export function buildLlmPrompt(fileName, content, marks) {
  if (!marks || !marks.length) return null;
  const preamble =
`你是產險文件審核助手。以下 Markdown（檔名：${fileName}）內含業務單位(BU)標記的問題，格式為 <!-- [審核問題 #n] 段落:「…」｜問題:… -->，緊接在它所指的段落下方。

請產出一份「問題清單報告」，逐條列出，每條包含：
1. 編號（對應 #n）
2. 位置（第幾個段落／原文摘錄）
3. BU 描述的問題
4. 你的判斷與佐證（依內文）
5. 建議修正
6. 嚴重度（高／中／低）

只依據標記與文件內文判斷，不要杜撰未出現的內容。若 BU 未填述問題，仍請依內文推測可能疑點並註明「BU 僅標示、未描述」。

===== 待審文件開始 =====`;
  return preamble + '\n\n' + buildAnnotatedMd(content, marks) + '\n\n===== 待審文件結束 =====';
}
