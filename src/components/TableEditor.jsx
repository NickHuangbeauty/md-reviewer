// Inline table editor component — extracted from MdReviewer.jsx (Phase 2 refactor)
// Visual editor for markdown/HTML tables (incl. colspan/rowspan) with a context menu.
import React, { useState, useRef, useEffect } from 'react';
import { Check } from 'lucide-react';
import { gridToHtmlTable, gridToMdTable, renderCellMd } from '../lib/table.js';

export function InlineTableEditor({ grid, outputFormat, onSave, onCancel }) {
  // Deep clone grid including cellMeta AND _originalFormat
  const cloneGrid = (g) => {
    const cloned = g.map(r => ({
      ...r,
      cells: [...r.cells],
      cellMeta: r.cellMeta ? r.cellMeta.map(m => m ? { ...m } : null) : null
    }));
    // 保留原始格式資訊
    if (g._originalFormat) {
      cloned._originalFormat = { ...g._originalFormat };
    }
    return cloned;
  };

  // 正規化儲存格內容用於比較（忽略空白差異）
  const normalizeCell = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // 比較兩個 grid 的內容是否有意義地不同（忽略空白）
  const gridsAreDifferent = (g1, g2) => {
    if (g1.length !== g2.length) return true;
    for (let ri = 0; ri < g1.length; ri++) {
      if (g1[ri].cells.length !== g2[ri].cells.length) return true;
      for (let ci = 0; ci < g1[ri].cells.length; ci++) {
        if (normalizeCell(g1[ri].cells[ci]) !== normalizeCell(g2[ri].cells[ci])) {
          return true;
        }
      }
    }
    return false;
  };

  const [data, setData] = useState(() => cloneGrid(grid));
  const [focusCell, setFocusCell] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [structureChanged, setStructureChanged] = useState(false); // 結構變化（新增/刪除行列）
  const wrapRef = useRef(null);
  const dataRef = useRef(data);
  const initialGridRef = useRef(cloneGrid(grid)); // 保存原始 grid 用於比較
  dataRef.current = data;

  const hasMeta = data.some(r => r.cellMeta && r.cellMeta.some(m => m && (m.colspan > 1 || m.rowspan > 1)));
  const serialize = (d) => outputFormat === 'html' ? gridToHtmlTable(d) : gridToMdTable(d);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        // 檢查是否有意義地修改了內容
        const hasRealChanges = structureChanged || gridsAreDifferent(initialGridRef.current, dataRef.current);

        if (hasRealChanges) {
          onSave(serialize(dataRef.current));
        } else {
          onCancel(); // 沒有有意義的修改，保留原始 HTML
        }
      }
    };
    const timer = setTimeout(() => { document.addEventListener('mousedown', handler); }, 100);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [onSave, onCancel, outputFormat, structureChanged]);

  const updateCell = (ri, ci, val) => {
    setData(prev => prev.map((r, i) => i === ri ? { ...r, cells: r.cells.map((c, j) => j === ci ? val : c) } : r));
  };

  const colCount = Math.max(...data.map(r => r.cells.length), 1);

  // Row & Column operations (simple mode — for tables without colspan/rowspan)
  const addRowBelow = (ri) => {
    const nd = cloneGrid(data);
    const newRow = { cells: Array(colCount).fill(''), isHeader: false };
    if (hasMeta) {
      newRow.cellMeta = Array(colCount).fill(null).map(() => ({ colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true }));
    }
    nd.splice(ri + 1, 0, newRow);
    setStructureChanged(true); setData(nd); setCtxMenu(null);
  };
  const addRowAbove = (ri) => {
    const nd = cloneGrid(data);
    const newRow = { cells: Array(colCount).fill(''), isHeader: false };
    if (hasMeta) {
      newRow.cellMeta = Array(colCount).fill(null).map(() => ({ colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true }));
    }
    nd.splice(ri, 0, newRow);
    setStructureChanged(true); setData(nd); setCtxMenu(null);
  };
  const deleteRow = (ri) => {
    if (data.length <= 1) return;
    setStructureChanged(true); setData(prev => prev.filter((_, i) => i !== ri)); setCtxMenu(null);
  };
  const addColRight = (ci) => {
    setStructureChanged(true);
    setData(prev => prev.map(r => {
      const cells = [...r.cells.slice(0, ci + 1), '', ...r.cells.slice(ci + 1)];
      let cellMeta = r.cellMeta;
      if (cellMeta) {
        const newMeta = { colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true };
        cellMeta = [...cellMeta.slice(0, ci + 1), newMeta, ...cellMeta.slice(ci + 1)];
      }
      return { ...r, cells, cellMeta };
    }));
    setCtxMenu(null);
  };
  const addColLeft = (ci) => {
    setStructureChanged(true);
    setData(prev => prev.map(r => {
      const cells = [...r.cells.slice(0, ci), '', ...r.cells.slice(ci)];
      let cellMeta = r.cellMeta;
      if (cellMeta) {
        const newMeta = { colspan: 1, rowspan: 1, isHeader: false, style: '', align: '', height: '', primary: true };
        cellMeta = [...cellMeta.slice(0, ci), newMeta, ...cellMeta.slice(ci)];
      }
      return { ...r, cells, cellMeta };
    }));
    setCtxMenu(null);
  };
  const deleteCol = (ci) => {
    if (colCount <= 1) return;
    setStructureChanged(true);
    setData(prev => prev.map(r => ({
      ...r,
      cells: r.cells.filter((_, j) => j !== ci),
      cellMeta: r.cellMeta ? r.cellMeta.filter((_, j) => j !== ci) : null
    })));
    setCtxMenu(null);
  };
  const clearCell = (ri, ci) => {
    updateCell(ri, ci, '');
    setCtxMenu(null);
  };

  const handleCtxMenu = (e, ri, ci) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, ri, ci });
  };

  // Render table: with or without cellMeta
  const renderRow = (row, ri) => {
    const cellElements = [];
    row.cells.forEach((cell, ci) => {
      const meta = row.cellMeta?.[ci];
      // If this cell is spanned by another, skip rendering
      if (meta && !meta.primary && meta.spannedBy) return;

      const Tag = (meta?.isHeader || row.isHeader) ? 'th' : 'td';
      const isFocused = focusCell && focusCell[0] === ri && focusCell[1] === ci;
      const spanProps = {};
      if (meta && meta.colspan > 1) spanProps.colSpan = meta.colspan;
      if (meta && meta.rowspan > 1) spanProps.rowSpan = meta.rowspan;

      cellElements.push(
        <Tag key={ci}
          {...spanProps}
          className={isFocused ? 'cell-focus' : 'cell-normal'}
          onClick={() => setFocusCell([ri, ci])}
          onContextMenu={e => handleCtxMenu(e, ri, ci)}>
          {isFocused ? (
            <textarea value={cell}
              onChange={e => updateCell(ri, ci, e.target.value)}
              onBlur={() => setFocusCell(null)}
              onKeyDown={e => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  // Find next editable cell
                  let nextR = ri, nextC = ci + 1;
                  while (nextR < data.length) {
                    while (nextC < data[nextR].cells.length) {
                      const nm = data[nextR].cellMeta?.[nextC];
                      if (!nm || nm.primary) { setFocusCell([nextR, nextC]); return; }
                      nextC++;
                    }
                    nextR++; nextC = 0;
                  }
                  setFocusCell(null);
                }
                if (e.key === 'Escape') onSave(serialize(data));
              }}
              autoFocus className="cell-input"
              rows={Math.max(1, cell.split('\n').length)}
              style={{ resize: 'vertical', minHeight: 34 }} />
          ) : (
            <span className="cell-text" dangerouslySetInnerHTML={{ __html: renderCellMd(cell) }} />
          )}
        </Tag>
      );
    });
    return cellElements;
  };

  return (
    <div className="table-editor" ref={wrapRef}>
      {/* Column add buttons on top */}
      <div className="te-col-btns">
        <button className="te-add-col" title="在最左邊插入欄"
          onClick={() => addColLeft(0)}>+</button>
        {Array.from({ length: colCount }).map((_, ci) => (
          <div key={ci} className="te-col-btn-group">
            {colCount > 1 && <button className="te-del-col" title="刪除此欄"
              onClick={() => deleteCol(ci)}>×</button>}
            <button className="te-add-col" title="在右邊插入欄"
              onClick={() => addColRight(ci)}>+</button>
          </div>
        ))}
      </div>
      <div className="te-scroll">
        <table>
          <tbody>
            {data.map((row, ri) => (
              <tr key={ri}>
                {/* Row add button on left */}
                <td className="te-row-ctrl"
                  onContextMenu={e => handleCtxMenu(e, ri, 0)}>
                  <button className="te-add-row" title="在上方插入列"
                    onClick={() => addRowAbove(ri)}>+</button>
                  {data.length > 1 && <button className="te-del-row" title="刪除此列"
                    onClick={() => deleteRow(ri)}>×</button>}
                </td>
                {renderRow(row, ri)}
              </tr>
            ))}
            {/* Bottom add row button */}
            <tr>
              <td className="te-row-ctrl"></td>
              <td colSpan={colCount} className="te-add-row-bottom">
                <button onClick={() => addRowBelow(data.length - 1)} className="te-add-full">+ 新增一列</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="table-editor-actions">
        <span className="te-hint">右鍵 = 行列操作 · Tab 跳格 · 點外面自動存</span>
        <button onClick={onCancel} className="te-btn te-cancel">取消</button>
        <button onClick={() => onSave(serialize(data))} className="te-btn te-save">
          <Check style={{ width: 12, height: 12 }} /> 儲存
        </button>
      </div>
      {/* Context menu */}
      {ctxMenu && <TableCtxMenu pos={ctxMenu}
        onAddRowAbove={() => addRowAbove(ctxMenu.ri)}
        onAddRowBelow={() => addRowBelow(ctxMenu.ri)}
        onDeleteRow={() => deleteRow(ctxMenu.ri)}
        onAddColLeft={() => addColLeft(ctxMenu.ci)}
        onAddColRight={() => addColRight(ctxMenu.ci)}
        onDeleteCol={() => deleteCol(ctxMenu.ci)}
        onClearCell={() => clearCell(ctxMenu.ri, ctxMenu.ci)}
        canDeleteRow={data.length > 1}
        canDeleteCol={colCount > 1}
        onClose={() => setCtxMenu(null)} />}
    </div>
  );
}

function TableCtxMenu({ pos, onAddRowAbove, onAddRowBelow, onDeleteRow, onAddColLeft, onAddColRight, onDeleteCol, onClearCell, canDeleteRow, canDeleteCol, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  const sections = [
    { title: '列操作', items: [
      { label: '上方插入列', icon: '⬆', action: onAddRowAbove },
      { label: '下方插入列', icon: '⬇', action: onAddRowBelow },
      { label: '刪除此列', icon: '🗑', action: onDeleteRow, disabled: !canDeleteRow, danger: true },
    ]},
    { title: '欄操作', items: [
      { label: '左邊插入欄', icon: '⬅', action: onAddColLeft },
      { label: '右邊插入欄', icon: '➡', action: onAddColRight },
      { label: '刪除此欄', icon: '🗑', action: onDeleteCol, disabled: !canDeleteCol, danger: true },
    ]},
    { title: '格子操作', items: [
      { label: '清空此格', icon: '⬜', action: onClearCell },
    ]},
  ];

  return (
    <div ref={ref} className="tctx-menu" style={{ left: Math.min(pos.x, window.innerWidth - 200), top: Math.min(pos.y, window.innerHeight - 300) }}>
      {sections.map((sec, si) => (
        <div key={si}>
          {si > 0 && <div className="tctx-divider" />}
          <div className="tctx-title">{sec.title}</div>
          {sec.items.map((it, ii) => (
            <button key={ii} className={'tctx-item' + (it.danger ? ' tctx-danger' : '')}
              disabled={it.disabled}
              onClick={() => { it.action(); onClose(); }}>
              <span className="tctx-ico">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
