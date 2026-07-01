# LLM 友善審核輸出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BU 用傻瓜級標記(段落 hover 🚩 + 選字標記,描述選填)把問題就地標好,下載的 MD 帶「錨定註解 + 問題總表」,再加「複製 LLM 提示」一鍵，直接餵 LLM 產問題清單報告，取代截圖+Excel。

**Architecture:** 把純邏輯抽成兩個 framework-free 模組(`src/mdBlocks.js` 區塊切分、`src/llmExport.js` 註解/提示產生)以便單元測試；MdReviewer.jsx 只做接線與 UI。標記資料模型從 `{blockId, issue}` 擴充為 `{blockId, issue?, quote?}`，issue 改選填。

**Tech Stack:** React 18 + Vite 4，純模組用 ES modules + node 內建執行 golden tests(仿 `tests/tableModel.test.mjs`)，UI 用 Playwright BDD 驗證。

**Spec:** `docs/superpowers/specs/2026-07-01-llm-review-export-design.md`

---

## File Structure

- `src/mdBlocks.js` (新) — `splitMdBlocks` / `joinMdBlocks`(自 MdReviewer.jsx:35-147 抽出，單一真相來源)
- `src/llmExport.js` (新) — `blockQuote` / `escapeComment` / `annotationFor` / `buildAnnotatedMd` / `buildLlmPrompt`
- `tests/mdBlocks.test.mjs` (新) — 抽出後的回歸 golden
- `tests/llmExport.test.mjs` (新) — 匯出邏輯 golden
- `src/MdReviewer.jsx` (改) — import 兩模組、下載改用 buildAnnotatedMd、MarkPopup 選填、hover 🚩、選字標記、複製提示按鈕、導覽步驟
- `src/releases.js` (改) — v1.4.0 一筆
- `package.json` (改) — version 1.4.0

---

## Task 1: 抽出 `src/mdBlocks.js`（共用區塊切分）

**Files:**
- Create: `src/mdBlocks.js`
- Create: `tests/mdBlocks.test.mjs`
- Modify: `src/MdReviewer.jsx:35-147`（移除本地定義，改 import）

- [ ] **Step 1: 建立 `src/mdBlocks.js`（把 splitMdBlocks/joinMdBlocks 原封搬過來並 export）**

複製 MdReviewer.jsx 現有第 35–147 行的 `splitMdBlocks` 與 `joinMdBlocks`（邏輯一字不改，只加 `export`）：

```js
// src/mdBlocks.js
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
```

- [ ] **Step 2: 寫 golden test `tests/mdBlocks.test.mjs`**

```js
import { splitMdBlocks, joinMdBlocks } from '../src/mdBlocks.js';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

check('splits paragraphs on blank line', splitMdBlocks('A\n\nB').length === 2);
check('heading is its own block', splitMdBlocks('# H\n\ntext').length === 2 && splitMdBlocks('# H\n\ntext')[0] === '# H');
check('code fence stays one block', splitMdBlocks('```\na\n\nb\n```').length === 1);
check('html table stays one block', splitMdBlocks('<table>\n<tr><td>x</td></tr>\n</table>').length === 1);
check('empty input -> []', splitMdBlocks('').length === 0);
check('joinMdBlocks round-trips paragraphs', joinMdBlocks(['A', 'B']) === 'A\n\nB');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: 執行測試確認通過**

Run: `node tests/mdBlocks.test.mjs`
Expected: `6 passed, 0 failed`

- [ ] **Step 4: 讓 MdReviewer.jsx 改用共用模組**

在 MdReviewer.jsx 最上方 import 區塊之後（第 3 行附近，`import { RELEASES, CURRENT_VERSION } from './releases.js';` 下一行）新增：

```js
import { splitMdBlocks, joinMdBlocks } from './mdBlocks.js';
```

然後刪除 MdReviewer.jsx 內第 35–147 行的本地 `function splitMdBlocks(...)` 與 `function joinMdBlocks(...)` 定義（整段移除）。

- [ ] **Step 5: 編譯確認無誤**

Run: `npx vite build --config vite.config.canary.js`
Expected: `✓ built`，無 `splitMdBlocks is not defined` 之類錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/mdBlocks.js tests/mdBlocks.test.mjs src/MdReviewer.jsx
git commit -m "refactor: extract splitMdBlocks/joinMdBlocks to src/mdBlocks.js"
```

---

## Task 2: `src/llmExport.js` + golden tests

**Files:**
- Create: `src/llmExport.js`
- Create: `tests/llmExport.test.mjs`

- [ ] **Step 1: 寫失敗測試 `tests/llmExport.test.mjs`**

```js
import { blockQuote, buildAnnotatedMd, buildLlmPrompt } from '../src/llmExport.js';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

console.log('blockQuote:');
check('strips heading marks + truncates', blockQuote('## 保險費率為千分之三，保額上限為重置成本', 8) === '保險費率為千分之三…' || blockQuote('## 保險費率為千分之三', 8).startsWith('保險費率'));
check('collapses whitespace', blockQuote('a   b\n c') === 'a b c');

console.log('buildAnnotatedMd:');
{
  const md = 'A 段\n\nB 段\n\nC 段';
  const marks = [{ blockId: 'block-1', issue: 'B 有誤' }];
  const out = buildAnnotatedMd(md, marks);
  check('inline anchored comment after its block', /B 段\n<!-- \[審核問題 #1\][^>]*問題:B 有誤 -->/.test(out));
  check('header summary present with #1', out.includes('問題總表') && out.includes('#1'));
  check('quote defaults to block excerpt', out.includes('段落:「B 段'));
}
{
  const out = buildAnnotatedMd('X', []);
  check('no marks -> unchanged, no header', out === 'X');
}
{
  const marks = [{ blockId: 'block-0', issue: '', quote: '千分之三' }];
  const out = buildAnnotatedMd('保險費率為千分之三', marks);
  check('empty issue -> placeholder', out.includes('未填述'));
  check('quote overrides block excerpt', out.includes('段落:「千分之三」'));
}
{
  const marks = [{ blockId: 'block-0', issue: 'a --> b' }];
  const out = buildAnnotatedMd('para', marks);
  check('escapes --> in issue', !out.replace('<!--', '').includes('-->' + ' b') && out.includes('a —> b'));
}

console.log('buildLlmPrompt:');
check('null when no marks', buildLlmPrompt('f.md', 'X', []) === null);
{
  const p = buildLlmPrompt('f.md', 'A\n\nB', [{ blockId: 'block-1', issue: 'bad' }]);
  check('prompt has instruction preamble', /問題清單|審核/.test(p) && p.includes('不'));
  check('prompt embeds annotated md', p.includes('[審核問題 #1]'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tests/llmExport.test.mjs`
Expected: FAIL（`Cannot find module '../src/llmExport.js'`）

- [ ] **Step 3: 實作 `src/llmExport.js`**

```js
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
  // Global 1-based numbering in block order, then mark order.
  const byBlock = {};
  marks.forEach(m => { (byBlock[m.blockId] = byBlock[m.blockId] || []).push(m); });
  return byBlock;
}

function annotationLine(mark, blockText, n) {
  const quote = escapeComment(mark.quote && mark.quote.trim() ? mark.quote.trim() : blockQuote(blockText));
  const issue = escapeComment(mark.issue && mark.issue.trim() ? mark.issue.trim() : EMPTY_ISSUE);
  return `<!-- [審核問題 #${n}] 段落:「${quote}」｜問題:${issue} -->`;
}

// Enriched download MD: header summary + inline anchored comments after each block.
export function buildAnnotatedMd(content, marks) {
  if (!marks || !marks.length) return content;
  const blocks = splitMdBlocks(content);
  const byBlock = markNumberMap(marks);
  // assign global numbers in block order
  let n = 0;
  const numbered = []; // {mark, blockText, num}
  blocks.forEach((b, bi) => {
    (byBlock['block-' + bi] || []).forEach(m => { n += 1; numbered.push({ mark: m, blockText: b, num: n }); });
  });
  // orphan marks (block index out of range) appended at end
  const maxIdx = blocks.length - 1;
  marks.forEach(m => {
    const mi = /^block-(\d+)$/.exec(m.blockId || '');
    if (!mi || parseInt(mi[1], 10) > maxIdx) { n += 1; numbered.push({ mark: m, blockText: '', num: n }); }
  });

  const summary = numbered.map(x => {
    const q = escapeComment(x.mark.quote && x.mark.quote.trim() ? x.mark.quote.trim() : blockQuote(x.blockText));
    const i = escapeComment(x.mark.issue && x.mark.issue.trim() ? x.mark.issue.trim() : EMPTY_ISSUE);
    return `    #${x.num}「${q}」— ${i}`;
  }).join('\n');

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
  // append orphan annotations
  numbered.filter(x => x.blockText === '' ).forEach(x => out.push(annotationLine(x.mark, '', x.num)));

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
```

- [ ] **Step 4: 執行確認通過**

Run: `node tests/llmExport.test.mjs`
Expected: `... passed, 0 failed`（全過；若引文截斷斷言邊界對不上，微調測試斷言為 `.startsWith` 形式，不改實作行為）

- [ ] **Step 5: Commit**

```bash
git add src/llmExport.js tests/llmExport.test.mjs
git commit -m "feat(llm-export): pure buildAnnotatedMd + buildLlmPrompt module"
```

---

## Task 3: 下載/ZIP 改用 buildAnnotatedMd

**Files:**
- Modify: `src/MdReviewer.jsx`（import；downloadFile ~3978、downloadZip ~3988）

- [ ] **Step 1: import 匯出模組**

在 Task 1 新增的 `import ... from './mdBlocks.js';` 下一行加：

```js
import { buildAnnotatedMd, buildLlmPrompt } from './llmExport.js';
```

- [ ] **Step 2: 下載改用 buildAnnotatedMd**

找到 `safeDownload(injectMarksToMd(f.content, f.marks), name, 'text/markdown;charset=utf-8');`
改為：
```js
safeDownload(buildAnnotatedMd(f.content, f.marks), name, 'text/markdown;charset=utf-8');
```

找到 ZIP 的 `createZip(done.map(f => ({ name: f.name, content: injectMarksToMd(f.content, f.marks) })))`
改為：
```js
createZip(done.map(f => ({ name: f.name, content: buildAnnotatedMd(f.content, f.marks) })))
```

刪除 MdReviewer.jsx 內舊的 `function injectMarksToMd(...)`（第 555–565 行），已被取代。

- [ ] **Step 3: 編譯確認**

Run: `npx vite build --config vite.config.canary.js`
Expected: `✓ built`，無 `injectMarksToMd is not defined`。

- [ ] **Step 4: Commit**

```bash
git add src/MdReviewer.jsx
git commit -m "feat(download): emit LLM-anchored annotated MD (replaces injectMarksToMd)"
```

---

## Task 4: 標記描述改「選填」+ saveMark 支援 quote

**Files:**
- Modify: `src/MdReviewer.jsx`（MarkPopup ~603；saveMark ~3895；onBlockMark ~3804）

- [ ] **Step 1: MarkPopup 允許空描述儲存**

找到（~603-604）：
```jsx
          <button onClick={() => { if (issue.trim()) onSave(issue.trim()); }} disabled={!issue.trim()}
            className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-40 flex items-center gap-1"><Check className="w-3.5 h-3.5" />儲存</button>
```
改為（移除 disabled、允許空、按鈕文案提示選填）：
```jsx
          <button onClick={() => onSave(issue.trim())}
            className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" />儲存</button>
```
並把 textarea 的 placeholder 改為提示選填：把 `placeholder="描述問題..."` 改為 `placeholder="描述問題（可留空，直接標示此處有誤）"`。

- [ ] **Step 2: onBlockMark 與 saveMark 支援 quote**

找到 onBlockMark（~3804），改為接受可選 quote：
```js
  const onBlockMark = useCallback((blockId, e, quote) => {
    if (!activeFile) return;
    setPopup({ blockId, position: { x: e.clientX, y: e.clientY }, mark: activeFile.marks.find(m => m.blockId === blockId), quote });
    setEditingBlock(null);
  }, [activeFile]);
```

找到 saveMark（~3895），改為帶入 popup.quote：
```js
  const saveMark = useCallback((issue) => {
    if (!popup || !activeFile) return;
    const ms = [...activeFile.marks]; const idx = ms.findIndex(m => m.blockId === popup.blockId);
    const patch = { blockId: popup.blockId, issue };
    if (popup.quote) patch.quote = popup.quote;
    if (idx >= 0) ms[idx] = { ...ms[idx], ...patch }; else ms.push(patch);
    updateFile(activeFile.id, { marks: ms }); setPopup(null);
  }, [popup, activeFile, updateFile]);
```

- [ ] **Step 3: 編譯確認**

Run: `npx vite build --config vite.config.canary.js`
Expected: `✓ built`

- [ ] **Step 4: Commit**

```bash
git add src/MdReviewer.jsx
git commit -m "feat(marks): optional description + quote field on marks"
```

---

## Task 5: 段落 hover 🚩 快標

**Files:**
- Modify: `src/MdReviewer.jsx`（InlineBlock ~1701 render；styles）

- [ ] **Step 1: InlineBlock 加 hover 🚩 按鈕**

在 InlineBlock 的預覽容器（`.preview-block` 所在的外層，非編輯狀態時）加入一顆 hover 才顯示的 🚩 按鈕。於 InlineBlock return 的最外層 wrapper（含 `group` class 以便 hover）內、`.preview-block` 旁加：

```jsx
{!isEditing && (
  <button
    className="mark-flag"
    title="標記此段有問題"
    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
    onClick={(e) => { e.stopPropagation(); onMark(blockId, e); }}
  >🚩</button>
)}
```
確保該 wrapper 有 `position:relative` 與 `group`（Tailwind），🚩 用 `group-hover` 顯示。

- [ ] **Step 2: 加樣式（styles 字串內，靠近 `.float-toolbar`）**

```css
.mark-flag{position:absolute;top:4px;right:6px;opacity:0;transition:opacity .12s;background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:1px 6px;font-size:13px;line-height:1.4;cursor:pointer;z-index:5}
.group:hover > .mark-flag{opacity:.85}
.mark-flag:hover{opacity:1;border-color:#fca5a5;background:#fef2f2}
```
（若外層 wrapper 尚無 `group` 與 `relative`，於該 div className 補上 `group relative`。）

- [ ] **Step 3: 編譯確認**

Run: `npx vite build --config vite.config.canary.js`
Expected: `✓ built`

- [ ] **Step 4: Commit**

```bash
git add src/MdReviewer.jsx
git commit -m "feat(marks): hover 🚩 quick-mark affordance on paragraphs"
```

---

## Task 6: 選字標記（帶 quote）

**Files:**
- Modify: `src/MdReviewer.jsx`（預覽 canvas ~4413 區域；新增 selMark 狀態與浮動按鈕）

- [ ] **Step 1: 新增 selMark 狀態**

在其他 useState 附近（~3400）加：
```js
  const [selMark, setSelMark] = useState(null); // { x, y, blockId, quote }
```

- [ ] **Step 2: 在預覽 canvas 掛選取偵測**

在預覽區外層容器（`.doc-canvas` 的父層 `div`，即 `viewMode==='preview'` 分支那個 `flex-1 overflow-auto`）加 onMouseUp：
```jsx
onMouseUp={() => {
  const sel = window.getSelection();
  const text = sel && sel.toString().trim();
  if (!text || !sel.rangeCount) { setSelMark(null); return; }
  let node = sel.getRangeAt(0).commonAncestorContainer;
  node = node.nodeType === 3 ? node.parentElement : node;
  const blockEl = node && node.closest ? node.closest('[id^="block-"]') : null;
  if (!blockEl) { setSelMark(null); return; }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  setSelMark({ x: r.left + r.width / 2, y: r.top, blockId: blockEl.id, quote: text.slice(0, 60) });
}}
```
（注意：block 的 id 屬性在渲染 InlineBlock 時為 `block-<i>`；確認外層元素帶 `id={blockId}`。若 `.preview-block` 沒有 id，於 InlineBlock 最外層 wrapper 加 `id={blockId}`。）

- [ ] **Step 3: 渲染浮動「🚩 標記」按鈕**

在 return 內接近其他浮層處（例如 `{popup&&<MarkPopup .../>}` 附近）加：
```jsx
{selMark && (
  <button
    className="sel-mark-btn"
    style={{ position:'fixed', left: Math.min(selMark.x, window.innerWidth-90), top: Math.max(selMark.y-40, 8) }}
    onMouseDown={(e)=>e.preventDefault()}
    onClick={() => { onBlockMark(selMark.blockId, { clientX: selMark.x, clientY: selMark.y }, selMark.quote); setSelMark(null); }}
  >🚩 標記</button>
)}
```

- [ ] **Step 4: 樣式（styles 內）**

```css
.sel-mark-btn{display:flex;align-items:center;gap:4px;background:#ef4444;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:70;animation:ftIn .12s ease}
```

- [ ] **Step 5: 編譯確認**

Run: `npx vite build --config vite.config.canary.js`
Expected: `✓ built`

- [ ] **Step 6: Commit**

```bash
git add src/MdReviewer.jsx
git commit -m "feat(marks): select text in preview → 🚩 mark with quote"
```

---

## Task 7: 「複製 LLM 提示」按鈕 + fallback

**Files:**
- Modify: `src/MdReviewer.jsx`（header ~4455；toast 狀態；fallback modal）

- [ ] **Step 1: 加 toast 狀態**

在 useState 群加：
```js
  const [copyToast, setCopyToast] = useState(null); // 'ok' | { text }
```

- [ ] **Step 2: 加複製處理函式（downloadFile 附近）**

```js
  const copyLlmPrompt = useCallback(async () => {
    if (!activeFile || !activeFile.marks.length) return;
    const text = buildLlmPrompt(activeFile.name, activeFile.content, activeFile.marks);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyToast('ok'); setTimeout(() => setCopyToast(null), 1800);
    } catch { setCopyToast({ text }); } // fallback modal
  }, [activeFile]);
```

- [ ] **Step 3: header 加按鈕（在「下載 MD」按鈕之前）**

在 `data-tour="download"` 那顆按鈕之前插入：
```jsx
<button onClick={copyLlmPrompt} disabled={!activeFile || !activeFile.marks.length} className="tbtn tbtn-violet" title="複製給 LLM review 的提示詞（含標記與內文）"><Clipboard className="w-3.5 h-3.5" />複製 LLM 提示</button>
```

- [ ] **Step 4: 渲染 toast 與 fallback modal（近其他浮層）**

```jsx
{copyToast === 'ok' && <div className="copy-toast">已複製 LLM 提示 ✓</div>}
{copyToast && copyToast.text && (
  <div className="fixed inset-0 z-[130] flex items-center justify-center" style={{background:'rgba(0,0,0,.5)'}} onClick={()=>setCopyToast(null)}>
    <div className="rn-panel" onClick={e=>e.stopPropagation()} style={{padding:16}}>
      <div className="flex items-center justify-between mb-2"><b style={{color:'var(--text)'}}>手動複製</b><button className="rn-x" onClick={()=>setCopyToast(null)}><X className="w-4 h-4"/></button></div>
      <textarea readOnly value={copyToast.text} style={{width:'100%',height:220,fontSize:12,fontFamily:'var(--mono)',background:'var(--surface2)',color:'var(--text)',border:'1px solid var(--border2)',borderRadius:8,padding:8}} onFocus={e=>e.target.select()} />
    </div>
  </div>
)}
```

- [ ] **Step 5: toast 樣式（styles 內）**

```css
.copy-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:8px 16px;border-radius:999px;font-size:12.5px;font-weight:600;z-index:140;box-shadow:0 8px 24px rgba(0,0,0,.25);animation:ftIn .15s ease}
```

- [ ] **Step 6: 編譯確認**

Run: `npx vite build --config vite.config.canary.js`
Expected: `✓ built`

- [ ] **Step 7: Commit**

```bash
git add src/MdReviewer.jsx
git commit -m "feat(llm-export): 複製 LLM 提示 button + clipboard fallback + toast"
```

---

## Task 8: 導覽新增「標記」步驟

**Files:**
- Modify: `src/MdReviewer.jsx`（TOUR_STEPS ~2538；InlineBlock 🚩 加 data-tour）

- [ ] **Step 1: 🚩 按鈕加錨點**

在 Task 5 的 `.mark-flag` 按鈕加 `data-tour="mark"` 屬性。

- [ ] **Step 2: TOUR_STEPS 插入一步（在 gestures 之後、download 之前）**

於 TOUR_STEPS 陣列 `{ sel: '[data-tour="gestures"]', ... }` 之後插入：
```js
  { sel: '[data-tour="mark"]', title: '⑤ 標記問題（超簡單）', body: '滑鼠移到段落會浮出 🚩，點一下就標好；也可以選取某句話再點「🚩 標記」。描述可留空。這些標記會寫進你下載的 MD，直接丟給 LLM 就能產出問題清單。' },
```
並把後續步驟的標號文案（⑤下載→⑥、⑥更新日誌→⑦…）順移，或直接把新步驟文字用「標記」不帶數字避免重編號（擇一，保持文案一致即可）。

- [ ] **Step 3: 編譯確認**

Run: `npx vite build --config vite.config.canary.js`
Expected: `✓ built`

- [ ] **Step 4: Commit**

```bash
git add src/MdReviewer.jsx
git commit -m "feat(tour): dedicated 標記 step highlighting the 🚩 affordance"
```

---

## Task 9: 版本 bump v1.4.0 + releases.js

**Files:**
- Modify: `src/releases.js`（最前面加一筆）
- Modify: `package.json`（version → 1.4.0）

- [ ] **Step 1: releases.js 加最新版**

在 `export const RELEASES = [` 之後、`{ version: '1.3.0', ... }` 之前插入：
```js
  {
    version: '1.4.0',
    date: '2026-07-01',
    added: [
      'LLM 友善審核輸出：下載的 MD 帶「問題錨定註解 + 開頭問題總表」，可直接丟 LLM 產出問題清單報告，取代截圖+Excel',
      '「複製 LLM 提示」按鈕：一鍵複製「提示詞 + 帶標記內文」，貼進 codex/Claude 即可跑',
      '傻瓜級標記：段落 hover 🚩 快標、選取文字直接標；問題描述改為選填',
    ],
  },
```

- [ ] **Step 2: package.json bump**

把 `"version": "1.3.0",` 改為 `"version": "1.4.0",`。

- [ ] **Step 3: 編譯 + 版號測試**

Run: `npx vite build --config vite.config.canary.js`
Expected: `md-reviewer@1.4.0 build` 出現於輸出、`✓ built`。

- [ ] **Step 4: Commit**

```bash
git add src/releases.js package.json
git commit -m "chore(release): v1.4.0 — LLM export + 傻瓜級 marking"
```

---

## Task 10: DevOps 驗證閘門（本機）→ 停，等 code review

> 本任務不改產品程式，是流程閘門。嚴格依 canary-first。全數截圖存 `screenshots/`。

- [ ] **Step 1: 跑純模組 golden（回歸）**

Run: `node tests/mdBlocks.test.mjs && node tests/llmExport.test.mjs && node tests/tableModel.test.mjs`
Expected: 三支皆 `0 failed`。

- [ ] **Step 2: 啟動本機 canary，跑 10 BDD（亮+暗）**

```bash
npx vite --config vite.config.canary.js --port 5175 &
```
用 Playwright 逐一驗證（載入示範檔 → 操作）：
1. hover 段落浮現 🚩　2. 點 🚩 開 popup　3. 空描述可存（bare flag，marks 有一筆 issue==''）
4. 選字 → 浮現「🚩 標記」→ 建含 quote 的標記　5. 下載內容(getState 走 buildAnnotatedMd 邏輯或攔 blob)含 `#1`+引文+「問題總表」
6. 「複製 LLM 提示」→ 攔截 clipboard 內容含前言 + `[審核問題 #1]`　7. 無標記時按鈕 disabled
8. 導覽走到 `[data-tour="mark"]` spotlight 命中 🚩　9. 區塊「下移」後標記仍對應同一段（remap 回歸）
10. 暗色主題 popup / 🚩 / 按鈕 / toast 可讀（背景非白）
每項截圖存 `screenshots/`。

- [ ] **Step 3: 本機 prod gate（flags off）**

```bash
npx vite --port 5174 &
```
於 `localhost:5174/md-reviewer/` 抽驗：無 canary banner、hover 🚩、複製提示、下載含錨定註解皆正常（功能非 flag-gated）。

- [ ] **Step 4: 關閉 dev server，STOP 交付 code review**

```bash
pkill -f "vite.*517"
```
**不 push、不部署。** 回報使用者：本機 canary+prod 全綠、附截圖，並進行 code review（使用者要求）。等使用者看過 code review 後，再繼續 push canary → 線上驗證 →（再停等點頭）→ merge main。

---

## Self-Review（計畫對 spec 覆蓋檢查）

- 傻瓜級標記(hover🚩 + 選字 + 選填描述) → Task 4/5/6 ✅
- 下載 MD 錨定註解 + 問題總表 → Task 2/3 ✅
- 複製 LLM 提示 + fallback → Task 7 ✅
- 純模組可測 → Task 1/2 ✅
- 導覽步驟 → Task 8 ✅
- 版本 v1.4.0 → Task 9 ✅
- DevOps + code review 閘門 → Task 10 ✅
- 標記錨定回歸(remap) → Task 10 BDD #9 ✅
- 型別一致：mark `{blockId, issue?, quote?}`；`buildAnnotatedMd(content, marks)`、`buildLlmPrompt(fileName, content, marks)`、`onBlockMark(blockId, e, quote)`、`saveMark(issue)` 讀 `popup.quote` — 全篇一致 ✅

已知限制（記錄，非缺陷）：每個 block 目前僅一筆 mark（saveMark 依 blockId 覆蓋）；選字標記會把 quote 併入該 block 既有 mark。多段同 block 精標為未來工作。
