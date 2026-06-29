// Table pure logic — extracted from MdReviewer.jsx (Phase 1 refactor)
// Pure functions only (no React). Shared by the UI and by unit tests.
// Covers: markdown/HTML table <-> grid conversion, incl. colspan/rowspan.

const PIPE_PLACEHOLDER = '\x00PIPE\x00';
const PIPE_PLACEHOLDER_RE = new RegExp(PIPE_PLACEHOLDER, 'g');

/** Parse a markdown table row, correctly handling escaped \| in cell content */
export function parseTableRow(l) {
  const safe = l.replace(/\\\|/g, PIPE_PLACEHOLDER);
  const parts = safe.split('|').map(c => c.replace(PIPE_PLACEHOLDER_RE, '|').trim());
  if (parts.length && parts[0] === '') parts.shift();
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Escape literal | in cell content for markdown table output */
export function escapePipe(s) { return s.replace(/\|/g, '\\|'); }

export function parseMdTableToGrid(raw) {
  const lines = raw.trim().split('\n').filter(l => l.trim());
  if (!lines.length || !lines[0].includes('|')) return null;
  // 先檢查原始文本是否有分隔行（只有有分隔行時，第一行才是 header）
  const hasSeparatorLine = lines.some(l => /^\|?[\s\-:]+\|[\s\-:|]+\|?$/.test(l.trim()));

  // 檢測原始格式：是否為緊湊格式（如 |||）
  const isCompactFormat = lines.some(l => /^\|[^|\s]*\|/.test(l.trim()) || /\|\|/.test(l));

  const grid = [];
  let passedSeparator = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|?[\s\-:]+\|[\s\-:|]+\|?$/.test(lines[i].trim())) { passedSeparator = true; continue; }
    const cells = parseTableRow(lines[i]);
    // 只有在原始文本有分隔行時，第一行才標記為 header
    // 這樣可以避免沒有分隔行的表格（如 ||| 格式）被自動加上分隔行
    if (cells.length) grid.push({ cells, isHeader: hasSeparatorLine && !passedSeparator && grid.length === 0 });
  }
  if (!grid.length) return null;

  // 修復：確保所有行的 cells 數量一致（補足到最大列數）
  // 這樣可以避免不規則表格（如 ||| 格式）導致的編輯問題
  const maxCols = Math.max(...grid.map(r => r.cells.length));
  grid.forEach(row => {
    while (row.cells.length < maxCols) {
      row.cells.push('');
    }
  });

  // 附加原始格式資訊到 grid（用於序列化時還原）
  grid._originalFormat = {
    hasSeparatorLine,
    isCompactFormat,
    rawText: raw  // 保留原始文字以供比對
  };

  return grid;
}

export function parseHtmlTableToGrid(raw) {
  // Advanced HTML table parser - supports colspan/rowspan
  // Step 1: Extract all rows with cell metadata
  const rawRows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(raw)) !== null) {
    const rowHtml = trMatch[1];
    const cells = [];
    const tdRe = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let tdMatch;
    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
      const tag = tdMatch[1].toLowerCase();
      const attrs = tdMatch[2];
      const content = tdMatch[3];
      const colspan = parseInt((attrs.match(/colspan\s*=\s*["']?(\d+)/i) || [, '1'])[1]) || 1;
      const rowspan = parseInt((attrs.match(/rowspan\s*=\s*["']?(\d+)/i) || [, '1'])[1]) || 1;
      // Extract style for reconstruction
      const style = (attrs.match(/style\s*=\s*"([^"]*)"/i) || [, ''])[1];
      const align = (attrs.match(/align\s*=\s*"([^"]*)"/i) || [, ''])[1];
      const height = (attrs.match(/height\s*=\s*"([^"]*)"/i) || [, ''])[1];
      // Clean content to text
      let text = content
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      cells.push({ text, colspan, rowspan, isHeader: tag === 'th', style, align, height });
    }
    // Keep EVERY <tr> (even one with no <td> of its own) so that a row fully
    // covered by a rowspan from above survives the round-trip. Dropping empty
    // rows here collapsed merged tables (e.g. 2×2 merge → empty 2nd <tr>) on
    // reopen, breaking split-restore.
    rawRows.push(cells);
  }
  if (!rawRows.some(r => r.length)) return null;

  // Step 2: Determine grid dimensions
  let maxCols = 0;
  rawRows.forEach(row => {
    let w = 0;
    row.forEach(c => { w += c.colspan; });
    if (w > maxCols) maxCols = w;
  });
  // Account for rowspan stretching
  const totalRows = rawRows.length;

  // Step 3: Build expanded grid with occupied tracking
  const occupied = Array.from({ length: totalRows + 10 }, () => Array(maxCols + 10).fill(false));
  const grid = Array.from({ length: totalRows }, () => ({
    cells: Array(maxCols).fill(''),
    cellMeta: Array(maxCols).fill(null),
    isHeader: false
  }));

  rawRows.forEach((rowCells, ri) => {
    let ci = 0; // column cursor
    let cellIdx = 0;
    while (cellIdx < rowCells.length) {
      // Skip occupied cells (from previous rowspan)
      while (ci < maxCols && occupied[ri][ci]) ci++;
      if (ci >= maxCols) break;
      const cell = rowCells[cellIdx];
      // Place this cell
      for (let dr = 0; dr < cell.rowspan; dr++) {
        for (let dc = 0; dc < cell.colspan; dc++) {
          const r = ri + dr;
          const c = ci + dc;
          if (r < totalRows && c < maxCols) {
            occupied[r][c] = true;
            if (dr === 0 && dc === 0) {
              // Primary cell
              grid[r].cells[c] = cell.text;
              grid[r].cellMeta[c] = {
                colspan: cell.colspan,
                rowspan: cell.rowspan,
                isHeader: cell.isHeader,
                style: cell.style,
                align: cell.align,
                height: cell.height,
                primary: true
              };
              if (cell.isHeader) grid[r].isHeader = true;
            } else {
              // Spanned cell (reference back to primary)
              grid[r].cellMeta[c] = {
                colspan: 1, rowspan: 1,
                spannedBy: { r: ri, c: ci },
                primary: false
              };
            }
          }
        }
      }
      ci += cell.colspan;
      cellIdx++;
    }
  });

  // Fill nulls
  grid.forEach(row => {
    row.cellMeta = row.cellMeta.map((m, i) => m || {
      colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true
    });
  });

  return grid;
}

export function gridToMdTable(grid) {
  if (!grid || !grid.length) return '';
  const colCount = Math.max(...grid.map(r => r.cells.length));

  // 取得原始格式資訊（如果有的話）
  const origFormat = grid._originalFormat || {};
  const isCompact = origFormat.isCompactFormat;
  const hadSeparator = origFormat.hasSeparatorLine;

  const lines = [];
  grid.forEach((row, ri) => {
    let cells;
    if (isCompact) {
      cells = row.cells.map(c => escapePipe(c || ''));
    } else {
      cells = row.cells.map(c => c ? ' ' + escapePipe(c) + ' ' : '   ');
    }
    while (cells.length < colCount) cells.push(isCompact ? '' : '   ');
    lines.push('|' + cells.join('|') + '|');

    // 只有原本有分隔行，或者這是標準 header，才加分隔行
    if (ri === 0 && row.isHeader && hadSeparator !== false) {
      lines.push('|' + Array(colCount).fill('---').join('|') + '|');
    }
  });
  return lines.join('\n');
}

export function gridToHtmlTable(grid) {
  if (!grid || !grid.length) return '';
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let h = '<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">\n';
  grid.forEach((row, ri) => {
    h += '  <tr>\n';
    row.cells.forEach((cellText, ci) => {
      const meta = row.cellMeta?.[ci];
      if (!meta || !meta.primary) return; // skip spanned cells
      if (meta.spannedBy) return;
      const tag = meta.isHeader ? 'th' : 'td';
      let attrs = '';
      if (meta.colspan > 1) attrs += ` colspan="${meta.colspan}"`;
      if (meta.rowspan > 1) attrs += ` rowspan="${meta.rowspan}"`;
      // Rebuild style
      const styles = [];
      if (meta.style) styles.push(meta.style);
      if (meta.align) attrs += ` align="${meta.align}"`;
      if (meta.height) attrs += ` height="${meta.height}"`;
      const styleAttr = styles.length ? ` style="${styles.join('; ')}"` : '';
      // Convert newlines back to <br>
      const content = cellText.split('\n').map(l => esc(l)).join('<br>');
      h += `    <${tag}${attrs}${styleAttr}>${content}</${tag}>\n`;
    });
    h += '  </tr>\n';
  });
  h += '</table>';
  return h;
}

/* ===== MERGE / SPLIT CELLS (HTML only) ===== */

/** Deep clone a grid (cells + cellMeta + _originalFormat) without mutating input */
function cloneGridDeep(grid) {
  const cloned = grid.map(r => ({
    ...r,
    cells: [...r.cells],
    cellMeta: r.cellMeta ? r.cellMeta.map(m => m ? { ...m } : null) : null,
  }));
  if (grid._originalFormat) cloned._originalFormat = { ...grid._originalFormat };
  return cloned;
}

/** Ensure a cellMeta entry exists (normal primary cell) */
function defaultMeta() {
  return { colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true };
}

/**
 * Merge the rectangular range (r1,c1)-(r2,c2) into a single cell.
 * Top-left becomes the primary cell (colspan = cols, rowspan = rows).
 * All other cells in range become non-primary placeholders pointing back to the primary.
 * Text of the primary is kept; other cells are cleared. Returns a NEW grid (input untouched).
 * Coordinates are normalized so r1<=r2 and c1<=c2.
 */
export function mergeCells(grid, r1, c1, r2, c2) {
  if (!grid || !grid.length) return grid;
  // Normalize
  const rTop = Math.min(r1, r2), rBot = Math.max(r1, r2);
  const cLeft = Math.min(c1, c2), cRight = Math.max(c1, c2);
  const nd = cloneGridDeep(grid);
  // Ensure cellMeta exists for all rows (e.g. md grid promoted to html)
  nd.forEach(row => { if (!row.cellMeta) row.cellMeta = row.cells.map(() => defaultMeta()); });
  const cols = cRight - cLeft + 1;
  const rows = rBot - rTop + 1;
  if (cols <= 0 || rows <= 0) return nd;

  for (let r = rTop; r <= rBot; r++) {
    if (!nd[r]) continue;
    if (!nd[r].cellMeta) nd[r].cellMeta = nd[r].cells.map(() => defaultMeta());
    for (let c = cLeft; c <= cRight; c++) {
      if (c >= nd[r].cells.length) continue;
      if (r === rTop && c === cLeft) {
        // Primary cell
        const prev = nd[r].cellMeta[c] || defaultMeta();
        nd[r].cellMeta[c] = { ...prev, colspan: cols, rowspan: rows, primary: true };
        delete nd[r].cellMeta[c].spannedBy;
      } else {
        // Covered cell — clear text, mark non-primary
        nd[r].cells[c] = '';
        nd[r].cellMeta[c] = { colspan: 1, rowspan: 1, primary: false, spannedBy: { r: rTop, c: cLeft } };
      }
    }
  }
  return nd;
}

/**
 * Split a previously-merged primary cell at (r,c) back into normal cells.
 * Its colspan/rowspan reset to 1; the cells it used to cover become normal empty primary cells.
 * Returns a NEW grid (input untouched).
 */
export function splitCell(grid, r, c) {
  if (!grid || !grid.length || !grid[r]) return grid;
  const nd = cloneGridDeep(grid);
  const meta = nd[r].cellMeta?.[c];
  if (!meta || !meta.primary) return nd;
  const cols = meta.colspan || 1;
  const rows = meta.rowspan || 1;
  if (cols <= 1 && rows <= 1) return nd;

  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      const rr = r + dr, cc = c + dc;
      if (!nd[rr] || cc >= nd[rr].cells.length) continue;
      if (!nd[rr].cellMeta) nd[rr].cellMeta = nd[rr].cells.map(() => defaultMeta());
      if (dr === 0 && dc === 0) {
        nd[rr].cellMeta[cc] = { ...meta, colspan: 1, rowspan: 1, primary: true };
        delete nd[rr].cellMeta[cc].spannedBy;
      } else {
        nd[rr].cellMeta[cc] = defaultMeta();
      }
    }
  }
  return nd;
}

/* ===== CELL INLINE MD ===== */
export function renderCellMd(text) {
  if (!text) return '\u00A0';
  let h = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code class="cd">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" target="_blank">$1</a>');
  h = h.split('\n').join('<br>');
  return h;
}
