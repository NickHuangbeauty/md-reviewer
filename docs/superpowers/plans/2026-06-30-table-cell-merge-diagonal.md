# Table Cell Merge/Split + Diagonal Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-select cell merge/split, diagonal-split header cells, and undo/redo to the table editor, fixing the colspan/rowspan edit corruption (BUG 4) and a dark-mode cell-edit invert bug along the way.

**Architecture:** Extract the table grid operations (merge, split, diagonal, span-remap on row/col insert-delete) from the `InlineTableEditor` closure into a pure, unit-testable module `src/tableModel.js`. The editor consumes those pure functions, adds drag-select + a floating toolbar + an undo/redo history stack, and serializes via the existing `gridToHtmlTable` (extended for diagonal cells). DOMPurify is widened to allow `<svg>/<line>` for the diagonal while still blocking script vectors.

**Tech Stack:** React 18 (function components, hooks), Vite 4, DOMPurify 3, Node test runner (`tests/*.test.mjs`, hand-rolled assert), Playwright canary BDD (`window.mdReviewer.loadFiles`).

**Spec:** `docs/superpowers/specs/2026-06-29-table-cell-merge-diagonal-design.md`

**Branch:** `feat/table-cell-merge-diagonal`

**Grid/cell shape (existing):** a grid is `Array<{ cells: string[], isHeader?: bool, cellMeta?: Array<Meta|null> }>`. `Meta = { colspan, rowspan, isHeader, style, align, height, primary, spannedBy?: {r,c}, diag?: {up, lo} }`. `primary: true` = a real cell; `spannedBy` = covered by a merge. `diag` (NEW) = diagonal-split cell.

---

## Phase 1 — Pure grid model module (TDD, Node-tested)

Extract/author the pure operations first so they are covered before any UI wiring. New file `src/tableModel.js`; tests in `tests/tableModel.test.mjs` (mirrors `tests/diffStats.test.mjs` style — hand-rolled `check()`).

### Task 1.1: Scaffold module + normalize helper

**Files:**
- Create: `src/tableModel.js`
- Create: `tests/tableModel.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/tableModel.test.mjs
import { makeMeta, ensureMeta } from '../src/tableModel.js';
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } }

console.log('makeMeta / ensureMeta:');
check('makeMeta defaults primary 1x1', (() => { const m = makeMeta(); return m.primary && m.colspan === 1 && m.rowspan === 1; })());
const g = [{ cells: ['a', 'b'], isHeader: true }];
const g2 = ensureMeta(g);
check('ensureMeta adds cellMeta array', Array.isArray(g2[0].cellMeta) && g2[0].cellMeta.length === 2);
check('ensureMeta marks header', g2[0].cellMeta[0].isHeader === true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tableModel.test.mjs`
Expected: FAIL — `Cannot find module '../src/tableModel.js'` / export not defined.

- [ ] **Step 3: Write minimal implementation**

```js
// src/tableModel.js
// Pure, framework-free table-grid operations shared by the table editor.
// A grid: Array<{ cells: string[], isHeader?: bool, cellMeta?: Array<Meta|null> }>
// Meta: { colspan, rowspan, isHeader, style, align, height, primary, spannedBy?, diag? }

export function makeMeta(over = {}) {
  return { colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true, ...over };
}

// Return a deep clone of grid with cellMeta guaranteed on every cell.
export function ensureMeta(grid) {
  return grid.map(row => ({
    ...row,
    cells: [...row.cells],
    cellMeta: row.cells.map((_, c) => row.cellMeta && row.cellMeta[c]
      ? { ...row.cellMeta[c] }
      : makeMeta({ isHeader: !!row.isHeader })),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/tableModel.test.mjs`
Expected: PASS — `3 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/tableModel.js tests/tableModel.test.mjs
git commit -m "feat(table): scaffold pure tableModel module + ensureMeta"
```

### Task 1.2: mergeCells

**Files:**
- Modify: `src/tableModel.js`
- Modify: `tests/tableModel.test.mjs`

- [ ] **Step 1: Write the failing test** (append before the summary line)

```js
import { mergeCells, canMerge } from '../src/tableModel.js';
console.log('mergeCells:');
{
  const g = ensureMeta([{ cells: ['a', 'b', 'c'] }, { cells: ['d', 'e', 'f'] }]);
  check('canMerge true for 2x2', canMerge(g, { r1: 0, c1: 0, r2: 1, c2: 1 }));
  const m = mergeCells(g, { r1: 0, c1: 0, r2: 1, c2: 1 });
  check('primary colspan/rowspan = 2', m[0].cellMeta[0].colspan === 2 && m[0].cellMeta[0].rowspan === 2);
  check('keeps top-left text', m[0].cells[0] === 'a');
  check('covered cell marked spannedBy', m[0].cellMeta[1].spannedBy && m[0].cellMeta[1].spannedBy.r === 0 && m[0].cellMeta[1].spannedBy.c === 0);
  check('covered cell text cleared', m[0].cells[1] === '' && m[1].cells[0] === '');
  check('untouched cell intact', m[0].cells[2] === 'c');
  check('canMerge false if range overlaps existing span', !canMerge(m, { r1: 0, c1: 0, r2: 0, c2: 2 }));
  check('canMerge false for single cell', !canMerge(g, { r1: 0, c1: 0, r2: 0, c2: 0 }));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tableModel.test.mjs`
Expected: FAIL — `mergeCells`/`canMerge` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/tableModel.js`)

```js
function rectCells(range) {
  const { r1, c1, r2, c2 } = norm(range);
  const a = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) a.push([r, c]);
  return a;
}
function norm(range) {
  return { r1: Math.min(range.r1, range.r2), c1: Math.min(range.c1, range.c2), r2: Math.max(range.r1, range.r2), c2: Math.max(range.c1, range.c2) };
}

// True only if the range spans >1 cell and every covered cell is a plain 1x1 primary.
export function canMerge(grid, range) {
  const s = norm(range);
  if (s.r1 === s.r2 && s.c1 === s.c2) return false;
  return rectCells(s).every(([r, c]) => {
    const m = grid[r] && grid[r].cellMeta && grid[r].cellMeta[c];
    return m && m.primary && !m.spannedBy && m.colspan === 1 && m.rowspan === 1;
  });
}

// Merge the range: top-left becomes the primary spanning the rectangle, the rest
// become spannedBy placeholders with cleared text. Keeps top-left content.
export function mergeCells(grid, range) {
  if (!canMerge(grid, range)) return grid;
  const s = norm(range);
  const g = ensureMeta(grid);
  g[s.r1].cellMeta[s.c1].colspan = s.c2 - s.c1 + 1;
  g[s.r1].cellMeta[s.c1].rowspan = s.r2 - s.r1 + 1;
  for (const [r, c] of rectCells(s)) {
    if (r === s.r1 && c === s.c1) continue;
    g[r].cells[c] = '';
    g[r].cellMeta[c] = makeMeta({ primary: false, spannedBy: { r: s.r1, c: s.c1 }, isHeader: g[r].cellMeta[c].isHeader });
  }
  return g;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/tableModel.test.mjs`
Expected: PASS — all merge checks green.

- [ ] **Step 5: Commit**

```bash
git add src/tableModel.js tests/tableModel.test.mjs
git commit -m "feat(table): mergeCells + canMerge (keep top-left)"
```

### Task 1.3: rangeHasContent (for the discard-confirm prompt)

**Files:**
- Modify: `src/tableModel.js`
- Modify: `tests/tableModel.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { rangeHasContent } from '../src/tableModel.js';
console.log('rangeHasContent:');
{
  const g = ensureMeta([{ cells: ['title', '', ''] }]);
  check('false when only top-left has text', !rangeHasContent(g, { r1: 0, c1: 0, r2: 0, c2: 2 }));
  const g2 = ensureMeta([{ cells: ['title', 'x', ''] }]);
  check('true when another cell has text', rangeHasContent(g2, { r1: 0, c1: 0, r2: 0, c2: 2 }));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tableModel.test.mjs`
Expected: FAIL — `rangeHasContent` not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// True if any cell OTHER than the top-left has non-whitespace text (→ confirm before merge).
export function rangeHasContent(grid, range) {
  const s = norm(range);
  return rectCells(s).some(([r, c]) => (r !== s.r1 || c !== s.c1) && (grid[r].cells[c] || '').trim() !== '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/tableModel.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tableModel.js tests/tableModel.test.mjs
git commit -m "feat(table): rangeHasContent for merge discard confirm"
```

### Task 1.4: splitCell

**Files:**
- Modify: `src/tableModel.js`
- Modify: `tests/tableModel.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { splitCell, isMergedPrimary } from '../src/tableModel.js';
console.log('splitCell:');
{
  let g = ensureMeta([{ cells: ['a', 'b'] }, { cells: ['c', 'd'] }]);
  g = mergeCells(g, { r1: 0, c1: 0, r2: 1, c2: 1 });
  check('isMergedPrimary true at 0,0', isMergedPrimary(g, 0, 0));
  check('isMergedPrimary false at 1,1', !isMergedPrimary(g, 1, 1));
  const s = splitCell(g, 0, 0);
  check('primary back to 1x1', s[0].cellMeta[0].colspan === 1 && s[0].cellMeta[0].rowspan === 1);
  check('covered cells restored as primary', s[0].cellMeta[1].primary && !s[0].cellMeta[1].spannedBy && s[1].cellMeta[0].primary);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tableModel.test.mjs`
Expected: FAIL — `splitCell`/`isMergedPrimary` not exported.

- [ ] **Step 3: Write minimal implementation**

```js
export function isMergedPrimary(grid, r, c) {
  const m = grid[r] && grid[r].cellMeta && grid[r].cellMeta[c];
  return !!(m && m.primary && (m.colspan > 1 || m.rowspan > 1));
}

// Un-merge a merged primary: reset its span and restore covered cells as empty 1x1 primaries.
export function splitCell(grid, r, c) {
  if (!isMergedPrimary(grid, r, c)) return grid;
  const g = ensureMeta(grid);
  const cs = g[r].cellMeta[c].colspan, rs = g[r].cellMeta[c].rowspan;
  for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
    g[r + dr].cellMeta[c + dc] = makeMeta({ isHeader: g[r + dr].cellMeta[c + dc].isHeader });
  }
  return g;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/tableModel.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tableModel.js tests/tableModel.test.mjs
git commit -m "feat(table): splitCell + isMergedPrimary"
```

### Task 1.5: setDiagonal / clearDiagonal

**Files:**
- Modify: `src/tableModel.js`
- Modify: `tests/tableModel.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { setDiagonal, clearDiagonal, isDiagonal } from '../src/tableModel.js';
console.log('diagonal:');
{
  let g = ensureMeta([{ cells: ['事務分類', 'x'] }]);
  g = setDiagonal(g, 0, 0, '呈判層級', '事務分類');
  check('isDiagonal true', isDiagonal(g, 0, 0));
  check('diag labels set', g[0].cellMeta[0].diag.up === '呈判層級' && g[0].cellMeta[0].diag.lo === '事務分類');
  const c = clearDiagonal(g, 0, 0);
  check('isDiagonal false after clear', !isDiagonal(c, 0, 0));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tableModel.test.mjs`
Expected: FAIL — diagonal fns not exported.

- [ ] **Step 3: Write minimal implementation**

```js
export function isDiagonal(grid, r, c) {
  const m = grid[r] && grid[r].cellMeta && grid[r].cellMeta[c];
  return !!(m && m.diag);
}
export function setDiagonal(grid, r, c, up, lo) {
  const g = ensureMeta(grid);
  g[r].cellMeta[c].diag = { up: up || '', lo: lo || '' };
  g[r].cells[c] = '';
  return g;
}
export function clearDiagonal(grid, r, c) {
  const g = ensureMeta(grid);
  if (g[r].cellMeta[c].diag) delete g[r].cellMeta[c].diag;
  return g;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/tableModel.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tableModel.js tests/tableModel.test.mjs
git commit -m "feat(table): setDiagonal/clearDiagonal/isDiagonal"
```

### Task 1.6: Span-aware row/column insert + delete (BUG 4 fix)

**Files:**
- Modify: `src/tableModel.js`
- Modify: `tests/tableModel.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { insertCol, deleteCol, insertRow, deleteRow } from '../src/tableModel.js';
console.log('span-aware insert/delete (BUG 4):');
{
  // Row 0: [A(colspan2)] [C]; insert a column at index 1 (inside the span) → primary colspan grows to 3.
  let g = ensureMeta([{ cells: ['A', 'B', 'C'] }]);
  g = mergeCells(g, { r1: 0, c1: 0, r2: 0, c2: 1 });
  g = insertCol(g, 1);
  check('insert inside span grows colspan to 3', g[0].cellMeta[0].colspan === 3);
  check('row width grew', g[0].cells.length === 4);
  // Delete a column inside the span → colspan shrinks back to 1 (was 2, lost one covered col + the original).
  let g2 = ensureMeta([{ cells: ['A', 'B', 'C'] }]);
  g2 = mergeCells(g2, { r1: 0, c1: 0, r2: 0, c2: 1 });
  g2 = deleteCol(g2, 1);
  check('delete covered col shrinks colspan to 1', g2[0].cellMeta[0].colspan === 1);
  // Vertical: merge rowspan, delete a covered row → rowspan shrinks.
  let g3 = ensureMeta([{ cells: ['X'] }, { cells: ['Y'] }, { cells: ['Z'] }]);
  g3 = mergeCells(g3, { r1: 0, c1: 0, r2: 1, c2: 0 });
  g3 = deleteRow(g3, 1);
  check('delete covered row shrinks rowspan to 1', g3[0].cellMeta[0].rowspan === 1 && g3.length === 2);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tableModel.test.mjs`
Expected: FAIL — insert/delete fns not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// Rebuild all spannedBy back-references by re-deriving them from primaries' spans.
// Called after any structural splice so coordinates stay correct (fixes BUG 4).
function reindexSpans(grid) {
  const g = ensureMeta(grid);
  // First clear stale spannedBy on non-primary cells.
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].cellMeta.length; c++) {
    if (g[r].cellMeta[c].spannedBy) g[r].cellMeta[c] = makeMeta({ primary: false, isHeader: g[r].cellMeta[c].isHeader, _tmpCovered: false });
  }
  // Re-stamp coverage from each primary's span.
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].cellMeta.length; c++) {
    const m = g[r].cellMeta[c];
    if (!m.primary || (m.colspan === 1 && m.rowspan === 1)) continue;
    for (let dr = 0; dr < m.rowspan; dr++) for (let dc = 0; dc < m.colspan; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (g[r + dr] && g[r + dr].cellMeta[c + dc]) {
        g[r + dr].cells[c + dc] = '';
        g[r + dr].cellMeta[c + dc] = makeMeta({ primary: false, spannedBy: { r, c }, isHeader: g[r + dr].cellMeta[c + dc].isHeader });
      }
    }
  }
  return g;
}

const colCountOf = (g) => Math.max(...g.map(r => r.cells.length), 1);

export function insertCol(grid, at) {
  const g = ensureMeta(grid);
  for (let r = 0; r < g.length; r++) {
    // grow any primary in this row whose span straddles `at`
    for (let c = 0; c < at; c++) {
      const m = g[r].cellMeta[c];
      if (m.primary && m.colspan > 1 && c + m.colspan > at) m.colspan += 1;
    }
    g[r].cells.splice(at, 0, '');
    g[r].cellMeta.splice(at, 0, makeMeta({ isHeader: !!g[r].isHeader }));
  }
  return reindexSpans(g);
}

export function deleteCol(grid, at) {
  const g = ensureMeta(grid);
  if (colCountOf(g) <= 1) return g;
  for (let r = 0; r < g.length; r++) {
    for (let c = 0; c < at; c++) {
      const m = g[r].cellMeta[c];
      if (m.primary && m.colspan > 1 && c + m.colspan > at) m.colspan -= 1;
    }
    g[r].cells.splice(at, 1);
    g[r].cellMeta.splice(at, 1);
  }
  return reindexSpans(g);
}

export function insertRow(grid, at) {
  const g = ensureMeta(grid);
  const cols = colCountOf(g);
  for (let r = 0; r < at; r++) for (let c = 0; c < g[r].cellMeta.length; c++) {
    const m = g[r].cellMeta[c];
    if (m.primary && m.rowspan > 1 && r + m.rowspan > at) m.rowspan += 1;
  }
  const newRow = { cells: Array(cols).fill(''), isHeader: false, cellMeta: Array.from({ length: cols }, () => makeMeta()) };
  g.splice(at, 0, newRow);
  return reindexSpans(g);
}

export function deleteRow(grid, at) {
  const g = ensureMeta(grid);
  if (g.length <= 1) return g;
  for (let r = 0; r < at; r++) for (let c = 0; c < g[r].cellMeta.length; c++) {
    const m = g[r].cellMeta[c];
    if (m.primary && m.rowspan > 1 && r + m.rowspan > at) m.rowspan -= 1;
  }
  g.splice(at, 1);
  return reindexSpans(g);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/tableModel.test.mjs`
Expected: PASS — all span insert/delete checks green.

- [ ] **Step 5: Commit**

```bash
git add src/tableModel.js tests/tableModel.test.mjs
git commit -m "fix(table): span-aware row/col insert+delete (BUG 4) via reindexSpans"
```

---

## Phase 2 — Serialization round-trip (diagonal + spans)

Move/extend the existing `gridToHtmlTable` and `parseHtmlTableToGrid` so they handle the new `diag` field, then lock a parse→serialize round-trip with a golden test.

### Task 2.1: Serialize diagonal cells in gridToHtmlTable

**Files:**
- Modify: `src/MdReviewer.jsx` (`gridToHtmlTable`, ~L795-818)
- Modify: `src/index.css` (add `.diag-cell` styles)

- [ ] **Step 1: Add diagonal output branch** in `gridToHtmlTable`, inside the per-cell loop, BEFORE the normal content emit (after the `attrs` for colspan/rowspan are built):

```js
// diagonal-split header cell
if (meta.diag) {
  const up = esc(meta.diag.up || ''), lo = esc(meta.diag.lo || '');
  h += `    <${tag}${attrs} class="diag-cell"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" y1="0" x2="100" y2="100" stroke="currentColor" stroke-width="1"/></svg><span class="diag-up">${up}</span><span class="diag-lo">${lo}</span></${tag}>\n`;
  return; // skip the normal content emit for this cell
}
```

- [ ] **Step 2: Add CSS** to `src/index.css`:

```css
.pv .diag-cell { position: relative; min-width: 92px; height: 56px; }
.pv .diag-cell svg { position: absolute; inset: 0; width: 100%; height: 100%; color: var(--border-strong); pointer-events: none; }
.pv .diag-up { position: absolute; top: 4px; right: 8px; font-size: 0.85em; }
.pv .diag-lo { position: absolute; bottom: 4px; left: 8px; font-size: 0.85em; }
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/MdReviewer.jsx src/index.css
git commit -m "feat(table): serialize diagonal-split header cells to HTML+SVG"
```

### Task 2.2: Parse diagonal cells in parseHtmlTableToGrid

**Files:**
- Modify: `src/MdReviewer.jsx` (`parseHtmlTableToGrid`, ~L656-760)

- [ ] **Step 1: Detect `diag-cell` during cell parse.** Where each cell's `text`/attrs are extracted (after reading the raw cell HTML `inner`), add:

```js
// diagonal-split cell: recover the two labels, mark as diag
let diag = null;
if (/class\s*=\s*["'][^"']*\bdiag-cell\b/i.test(attrs) || /class\s*=\s*["'][^"']*\bdiag-cell\b/i.test(rawCell)) {
  const up = (inner.match(/diag-up["'][^>]*>([\s\S]*?)<\/span>/i) || [, ''])[1].replace(/<[^>]*>/g, '').trim();
  const lo = (inner.match(/diag-lo["'][^>]*>([\s\S]*?)<\/span>/i) || [, ''])[1].replace(/<[^>]*>/g, '').trim();
  diag = { up, lo };
}
```

Then when pushing the parsed cell meta, include `diag` if set:

```js
cells.push({ text: diag ? '' : text, colspan, rowspan, isHeader: tag === 'th', style, align, height, diag });
```

And in the grid-building stage where `cellMeta` objects are created for primaries, carry `diag` through onto the primary meta:

```js
colspan: cell.colspan, rowspan: cell.rowspan, /* ...existing... */ diag: cell.diag || undefined,
```

> Note: align the exact variable names (`attrs`, `rawCell`, `inner`, `text`, `cell`) to what `parseHtmlTableToGrid` already uses — read the function first. The intent: a cell carrying `diag-cell` parses back into `cellMeta.diag = {up, lo}`.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/MdReviewer.jsx
git commit -m "feat(table): parse diagonal-split cells back into grid model"
```

### Task 2.3: Round-trip golden (canary, via window API)

Pure round-trip is awkward to Node-test because the serializers live in MdReviewer.jsx and use DOM-free string ops but aren't exported. Verify on local canary instead.

- [ ] **Step 1: Start canary**

Run: `npx vite --config vite.config.canary.js --port 5175 --host` (background)

- [ ] **Step 2: Load an HTML table with colspan + a diag-cell, open the editor, save, re-load, assert preserved.** Drive with Playwright `browser_run_code_unsafe`:

```js
// load merged+diagonal HTML, enter editor (single-click block), click outside to save, read getState content
// assert: content still contains 'colspan="2"' and 'diag-cell' and both diag labels
```

Expected: saved content round-trips `colspan` and the `diag-cell` (with both labels) unchanged.

- [ ] **Step 3: Commit** (no code change if green; otherwise fix Task 2.1/2.2 and re-commit)

---

## Phase 3 — DOMPurify allows svg/line (XSS-safe)

### Task 3.1: Widen sanitizer for diagonal SVG, keep XSS blocked

**Files:**
- Modify: `src/MdReviewer.jsx` (`sanitizeUserHtml`, ~L13-19)
- Modify: `tests/diffStats.test.mjs`? No — XSS check is canary-level. Add a dedicated canary assertion in Phase 5 BDD.

- [ ] **Step 1: Extend the config**

```js
function sanitizeUserHtml(dirty) {
  return DOMPurify.sanitize(dirty, {
    ADD_TAGS: ['style', 'svg', 'line'],
    ADD_ATTR: ['colspan', 'rowspan', 'align', 'valign', 'target', 'viewBox', 'preserveAspectRatio', 'x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'foreignObject'],
    ALLOW_DATA_ATTR: false,
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 3: Canary XSS regression** — on local canary, load:
  `<svg onload="window.__x=1"><line x1=0 y1=0 x2=10 y2=10></svg>` and a legit `diag-cell`.
  Assert: `window.__x` is `undefined` (onload stripped), `[onload]` count 0, BUT the legit `diag-cell` svg/line renders (`.pv .diag-cell svg line` present).

- [ ] **Step 4: Commit**

```bash
git add src/MdReviewer.jsx
git commit -m "security(table): allow svg/line for diagonal cells, keep on*/script blocked"
```

---

## Phase 4 — Editor UI: drag-select, toolbar, merge/split/diagonal, undo/redo

All in `InlineTableEditor` (`src/MdReviewer.jsx`, ~L836+). Import the pure ops from `src/tableModel.js`. Replace the existing inline `addRowAbove/Below/addCol*/deleteRow/deleteCol` bodies with calls to the new span-aware `insertRow/insertCol/deleteRow/deleteCol`.

### Task 4.1: Wire pure ops + undo/redo history

- [ ] **Step 1:** Import at top of `MdReviewer.jsx`:

```js
import { ensureMeta, mergeCells, splitCell, canMerge, rangeHasContent, isMergedPrimary, setDiagonal, clearDiagonal, isDiagonal, insertRow, insertCol, deleteRow, deleteCol } from './tableModel.js';
```

- [ ] **Step 2:** In `InlineTableEditor`, add history + commit:

```js
const histRef = useRef([cloneGrid(grid)]);
const hiRef = useRef(0);
const commitGrid = (ng) => {
  histRef.current = histRef.current.slice(0, hiRef.current + 1);
  histRef.current.push(cloneGrid(ng));
  hiRef.current++;
  setStructureChanged(true); setData(ng);
};
const undoEdit = () => { if (hiRef.current > 0) { hiRef.current--; setData(cloneGrid(histRef.current[hiRef.current])); } };
const redoEdit = () => { if (hiRef.current < histRef.current.length - 1) { hiRef.current++; setData(cloneGrid(histRef.current[hiRef.current])); } };
```

- [ ] **Step 3:** Replace each row/col op body to use the pure span-aware fns + `commitGrid`, e.g.:

```js
const addRowBelow = (ri) => { commitGrid(insertRow(data, ri + 1)); setCtxMenu(null); };
const addRowAbove = (ri) => { commitGrid(insertRow(data, ri)); setCtxMenu(null); };
const delRow = (ri) => { commitGrid(deleteRow(data, ri)); setCtxMenu(null); };
const addColRightOp = (ci) => { commitGrid(insertCol(data, ci + 1)); setCtxMenu(null); };
const addColLeftOp = (ci) => { commitGrid(insertCol(data, ci)); setCtxMenu(null); };
const delColOp = (ci) => { commitGrid(deleteCol(data, ci)); setCtxMenu(null); };
```

(Rewire the existing menu/button handlers to these.)

- [ ] **Step 4:** Verify build (`npm run build`) → `✓ built`. Commit:

```bash
git add src/MdReviewer.jsx
git commit -m "feat(table-editor): use pure span-aware ops + undo/redo history"
```

### Task 4.2: Drag-select range + selection highlight

- [ ] **Step 1:** Add selection state + a drag ref:

```js
const [selRange, setSelRange] = useState(null);
const dragRef = useRef(false);
```

- [ ] **Step 2:** On each rendered `<td>` add `data-r`/`data-c` and handlers (delegate on the table element): `onMouseDown` → set `dragRef.current = true`, `setSelRange({r1,c1,r2,c2: same})`; `onMouseOver` while `dragRef.current` → update `r2/c2`; global `mouseup` → `dragRef.current = false`. Distinguish click vs drag: if `selRange` collapsed to one cell on mouseup, fall through to existing `focusCell` edit; if multi-cell, suppress edit.

- [ ] **Step 3:** Add a `.cell-sel` class to cells inside the normalized `selRange` (blue tint, matching prototype: `background: var(--bg-accent)`).

- [ ] **Step 4:** Verify build + commit:

```bash
git add src/MdReviewer.jsx src/index.css
git commit -m "feat(table-editor): drag-select cell range with highlight"
```

### Task 4.3: Floating toolbar + merge/split/diagonal actions

- [ ] **Step 1:** Render a `position:absolute` toolbar inside the editor's `position:relative` wrap, shown when `selRange` exists, positioned above the selection's bounding box (see prototype `updateBar`). Buttons:
  - 合併 — enabled when `canMerge(data, selRange)`. onClick: if `rangeHasContent(data, selRange)` → `window.confirm('其餘格內容將被清除，確定？')`; if confirmed/none → `commitGrid(mergeCells(data, selRange))`; if `outputFormat !== 'html'` set it to `'html'` (state). Collapse selection.
  - 分割 — enabled when selection is a single `isMergedPrimary`. onClick: `commitGrid(splitCell(data, r, c))`.
  - 斜線 — enabled when selection is a single non-merged cell. Toggles: if `isDiagonal` → `commitGrid(clearDiagonal(...))`; else `commitGrid(setDiagonal(data, r, c, '', ''))` and switch `outputFormat='html'`.
  - 復原 / 重做 — call `undoEdit` / `redoEdit`.

- [ ] **Step 2:** `outputFormat` must be stateful (it arrives as a prop). Add `const [outFmt, setOutFmt] = useState(outputFormat)` and serialize via `outFmt`.

- [ ] **Step 3:** Diagonal label editing: when a cell `isDiagonal`, render two small inputs (up/lo) inside the cell in edit mode; onChange → `commitGrid(setDiagonal(data, r, c, up, lo))` (debounced is fine but not required).

- [ ] **Step 4:** Verify build + commit:

```bash
git add src/MdReviewer.jsx src/index.css
git commit -m "feat(table-editor): floating toolbar — merge/split/diagonal/undo/redo"
```

### Task 4.4: Canary BDD — merge/split/diagonal/undo (light + dark)

- [ ] **Step 1:** Start canary (5175). Use Playwright `browser_run_code_unsafe` + `window.mdReviewer.loadFiles`. Per the canary-test-injection playbook, the table editor opens on single-click of the table block; cells are `td`; drag-select via mousedown on a `td` then mouseover another then mouseup.

- [ ] **Step 2:** Run scenarios (assert via the saved `getState().content` HTML and/or DOM): merge 2×1 → `colspan="2"`; merge 1×2 → `rowspan="2"`; merge 2×2; header merge → `<th colspan`; split → spans gone; merge-with-content → confirm dialog (use `browser_handle_dialog`); undo restores; redo; MD table merge → output is `<table>`; diagonal create + labels → `diag-cell` in output; merge then insert column → span still correct (BUG 4); each in light AND dark theme (`window.mdReviewer.setTheme`). Screenshot each to `screenshots/`.

- [ ] **Step 3:** Local production gate: repeat the always-active subset on `localhost:5174/md-reviewer/` (flags off).

- [ ] **Step 4:** Commit screenshots are gitignored; commit any fixups found.

---

## Phase 5 — Dark-mode cell-edit invert fix + final verification

### Task 5.1: Fix dark-mode cell-edit invert

**Files:**
- Modify: `src/index.css` and/or `InlineTableEditor` inline cell styles

- [ ] **Step 1:** Reproduce on canary in dark mode: load a table, single-click a cell to edit → observe the white/inverted background. Inspect the focused/edit cell's computed `background` to find the hardcoded light value (likely a `background:#fff` or `var(--surface-2)` that doesn't flip, or an input inside the cell).

- [ ] **Step 2:** Replace the offending hardcoded color with a theme variable that flips (e.g. the editor cell/input `background` → `var(--surface-2)` / `var(--bg)` that is dark in dark mode; text → `var(--text)`).

- [ ] **Step 3:** Canary verify in dark mode: clicking/editing a cell keeps a dark background (screenshot). Also light mode unaffected.

- [ ] **Step 4:** Commit:

```bash
git add src/index.css src/MdReviewer.jsx
git commit -m "fix(table-editor): dark-mode cell-edit no longer renders white/inverted"
```

### Task 5.2: Full regression + deploy to online canary

- [ ] **Step 1:** Run `node tests/tableModel.test.mjs`, `node tests/diffStats.test.mjs`, `node tests/diff-engine.test.mjs` → all pass.
- [ ] **Step 2:** `npm run build` → `✓ built`.
- [ ] **Step 3:** Re-run the XSS regression (bare/wrapped `img onerror`, `svg onload`) on canary → all neutralized; legit diagonal renders.
- [ ] **Step 4:** Push `feat/table-cell-merge-diagonal` to `origin`, then `git push origin HEAD:canary` (with user approval) → watch deploy → online canary BDD (subset) → report.

---

## Self-review notes

- **Spec coverage:** merge (1.2,4.3), split (1.4,4.3), keep-top-left+confirm (1.3,4.3), undo/redo (4.1,4.3), drag-select+toolbar (4.2,4.3), diagonal create/edit/render (1.5,2.1,2.2,4.3), MD→HTML auto-convert (4.3 outFmt), BUG 4 span remap (1.6,4.1,4.4), DOMPurify svg + XSS-safe (3.1,5.2), dark-mode invert (5.1), round-trip (2.3), BDD light+dark (4.4). All spec sections mapped.
- **Type consistency:** Meta field names (`colspan`, `rowspan`, `primary`, `spannedBy`, `diag.{up,lo}`) and fn names (`mergeCells`, `splitCell`, `canMerge`, `rangeHasContent`, `isMergedPrimary`, `setDiagonal`, `clearDiagonal`, `isDiagonal`, `insertRow/Col`, `deleteRow/Col`) are used consistently across tasks.
- **Known integration caveat:** Phase 4 must align new handlers with the existing `InlineTableEditor` menu wiring and `cloneGrid` (extend `cloneGrid` to deep-copy `diag`). Read the function before editing.
