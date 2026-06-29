// Pure, framework-free table-grid operations shared by the table editor.
// A grid: Array<{ cells: string[], isHeader?: bool, cellMeta?: Array<Meta|null> }>
// Meta: { colspan, rowspan, isHeader, style, align, height, primary, spannedBy?, diag? }
//   primary:true = a real cell; spannedBy:{r,c} = covered by a merge; diag:{up,lo} = diagonal-split cell.
// All functions are pure: they return a new deep-cloned grid and never mutate the input.

export function makeMeta(over = {}) {
  return { colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true, ...over };
}

// Deep clone the grid with cellMeta guaranteed on every cell.
export function ensureMeta(grid) {
  return grid.map(row => ({
    ...row,
    cells: [...row.cells],
    cellMeta: row.cells.map((_, c) => {
      const src = row.cellMeta && row.cellMeta[c];
      if (src) {
        const m = { ...src };
        if (src.spannedBy) m.spannedBy = { ...src.spannedBy };
        if (src.diag) m.diag = { ...src.diag };
        return m;
      }
      return makeMeta({ isHeader: !!row.isHeader });
    }),
  }));
}

function norm(range) {
  return {
    r1: Math.min(range.r1, range.r2), c1: Math.min(range.c1, range.c2),
    r2: Math.max(range.r1, range.r2), c2: Math.max(range.c1, range.c2),
  };
}

function rectCells(range) {
  const { r1, c1, r2, c2 } = norm(range);
  const a = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) a.push([r, c]);
  return a;
}

const colCountOf = (g) => Math.max(...g.map(r => r.cells.length), 1);

// Expand a selection rectangle so it fully covers any already-merged cell that
// overlaps its boundary — lets you merge across existing colspan/rowspan cells
// (e.g. several full-width colspan=6 rows) without splitting them.
function expandRange(grid, range) {
  let { r1, c1, r2, c2 } = norm(range);
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const m = grid[r] && grid[r].cellMeta && grid[r].cellMeta[c];
      if (!m) continue;
      let pr = r, pc = c;
      if (m.spannedBy) { pr = m.spannedBy.r; pc = m.spannedBy.c; }
      const pm = grid[pr] && grid[pr].cellMeta && grid[pr].cellMeta[pc];
      if (!pm) continue;
      const er = pr + (pm.rowspan || 1) - 1, ec = pc + (pm.colspan || 1) - 1;
      if (pr < r1) { r1 = pr; changed = true; }
      if (pc < c1) { c1 = pc; changed = true; }
      if (er > r2) { r2 = er; changed = true; }
      if (ec > c2) { c2 = ec; changed = true; }
    }
  }
  return { r1, c1, r2, c2 };
}

// Count distinct primary cells inside a range.
function countPrimaries(grid, s) {
  let n = 0;
  for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) {
    const m = grid[r] && grid[r].cellMeta && grid[r].cellMeta[c];
    if (m && m.primary && !m.spannedBy) n++;
  }
  return n;
}

// Mergeable when the (expanded) range covers more than one primary cell.
export function canMerge(grid, range) {
  return countPrimaries(grid, expandRange(grid, range)) >= 2;
}

// True if more than one cell in the range carries text (informational only — merge
// never discards: it concatenates).
export function rangeHasContent(grid, range) {
  const s = expandRange(grid, range);
  let withText = 0;
  for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) {
    const m = grid[r] && grid[r].cellMeta && grid[r].cellMeta[c];
    if (m && m.primary && !m.spannedBy && (grid[r].cells[c] || '').trim()) withText++;
  }
  return withText > 1;
}

// Merge the range into a single cell. Range auto-expands to cover overlapped merges.
// CONCATENATES every primary cell's non-empty text (newline-joined) so NOTHING is lost —
// critical for merging text-heavy rows (e.g. 總說明 / 填寫說明 / 1 / 2 / 3). The top-left
// cell's background style/header flag are preserved.
export function mergeCells(grid, range) {
  const s = expandRange(grid, range);
  if (countPrimaries(grid, s) < 2) return grid;
  const g = ensureMeta(grid);
  const texts = [];
  for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) {
    const m = g[r].cellMeta[c];
    if (m.primary && !m.spannedBy) { const t = (g[r].cells[c] || '').trim(); if (t) texts.push(t); }
  }
  const tl = g[s.r1].cellMeta[s.c1];
  g[s.r1].cells[s.c1] = texts.join('\n');
  g[s.r1].cellMeta[s.c1] = makeMeta({
    colspan: s.c2 - s.c1 + 1, rowspan: s.r2 - s.r1 + 1,
    isHeader: tl.isHeader, style: tl.style, align: tl.align, height: tl.height,
  });
  for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) {
    if (r === s.r1 && c === s.c1) continue;
    g[r].cells[c] = '';
    g[r].cellMeta[c] = makeMeta({ primary: false, spannedBy: { r: s.r1, c: s.c1 }, isHeader: g[r].cellMeta[c].isHeader });
  }
  return g;
}

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

// Rebuild all spannedBy back-references by re-deriving them from primaries' spans.
// Called after any structural splice so coordinates stay correct (fixes BUG 4).
function reindexSpans(grid) {
  const g = ensureMeta(grid);
  // 1) clear stale spannedBy markers.
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].cellMeta.length; c++) {
    if (g[r].cellMeta[c].spannedBy) g[r].cellMeta[c] = makeMeta({ isHeader: g[r].cellMeta[c].isHeader });
  }
  // 2) re-stamp coverage from each primary's span.
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

export function insertCol(grid, at) {
  const g = ensureMeta(grid);
  for (let r = 0; r < g.length; r++) {
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
