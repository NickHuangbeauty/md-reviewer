// Golden tests for the pure table-grid model (src/tableModel.js).
// Run: node tests/tableModel.test.mjs
import {
  makeMeta, ensureMeta, canMerge, mergeCells, rangeHasContent,
  isMergedPrimary, splitCell, setDiagonal, clearDiagonal, isDiagonal,
  insertCol, deleteCol, insertRow, deleteRow,
} from '../src/tableModel.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } }

console.log('ensureMeta / makeMeta:');
check('makeMeta defaults primary 1x1', (() => { const m = makeMeta(); return m.primary && m.colspan === 1 && m.rowspan === 1; })());
{
  const g = ensureMeta([{ cells: ['a', 'b'], isHeader: true }]);
  check('ensureMeta adds cellMeta', Array.isArray(g[0].cellMeta) && g[0].cellMeta.length === 2);
  check('ensureMeta marks header', g[0].cellMeta[0].isHeader === true);
  // purity: mutating clone does not touch source
  const src = [{ cells: ['x'] }];
  const cl = ensureMeta(src); cl[0].cells[0] = 'y';
  check('ensureMeta is pure (no source mutation)', src[0].cells[0] === 'x');
}

console.log('canMerge / mergeCells:');
{
  const g = ensureMeta([{ cells: ['a', 'b', 'c'] }, { cells: ['d', 'e', 'f'] }]);
  check('canMerge true for 2x2', canMerge(g, { r1: 0, c1: 0, r2: 1, c2: 1 }));
  check('canMerge false for single cell', !canMerge(g, { r1: 0, c1: 0, r2: 0, c2: 0 }));
  const m = mergeCells(g, { r1: 0, c1: 0, r2: 1, c2: 1 });
  check('primary colspan/rowspan = 2', m[0].cellMeta[0].colspan === 2 && m[0].cellMeta[0].rowspan === 2);
  check('keeps top-left text', m[0].cells[0] === 'a');
  check('covered cell spannedBy 0,0', m[0].cellMeta[1].spannedBy && m[0].cellMeta[1].spannedBy.r === 0 && m[0].cellMeta[1].spannedBy.c === 0);
  check('covered cell text cleared', m[0].cells[1] === '' && m[1].cells[0] === '');
  check('untouched cell intact', m[0].cells[2] === 'c');
  check('canMerge false if overlaps existing span', !canMerge(m, { r1: 0, c1: 0, r2: 0, c2: 2 }));
  check('mergeCells pure (source unchanged)', g[0].cellMeta[0].colspan === 1);
}

console.log('rangeHasContent:');
{
  const g = ensureMeta([{ cells: ['title', '', ''] }]);
  check('false when only top-left has text', !rangeHasContent(g, { r1: 0, c1: 0, r2: 0, c2: 2 }));
  const g2 = ensureMeta([{ cells: ['title', 'x', ''] }]);
  check('true when another cell has text', rangeHasContent(g2, { r1: 0, c1: 0, r2: 0, c2: 2 }));
}

console.log('splitCell / isMergedPrimary:');
{
  let g = ensureMeta([{ cells: ['a', 'b'] }, { cells: ['c', 'd'] }]);
  g = mergeCells(g, { r1: 0, c1: 0, r2: 1, c2: 1 });
  check('isMergedPrimary true at 0,0', isMergedPrimary(g, 0, 0));
  check('isMergedPrimary false at 1,1', !isMergedPrimary(g, 1, 1));
  const s = splitCell(g, 0, 0);
  check('primary back to 1x1', s[0].cellMeta[0].colspan === 1 && s[0].cellMeta[0].rowspan === 1);
  check('covered cells restored primary', s[0].cellMeta[1].primary && !s[0].cellMeta[1].spannedBy && s[1].cellMeta[0].primary);
}

console.log('diagonal:');
{
  let g = ensureMeta([{ cells: ['事務分類', 'x'] }]);
  g = setDiagonal(g, 0, 0, '呈判層級', '事務分類');
  check('isDiagonal true', isDiagonal(g, 0, 0));
  check('diag labels set', g[0].cellMeta[0].diag.up === '呈判層級' && g[0].cellMeta[0].diag.lo === '事務分類');
  const c = clearDiagonal(g, 0, 0);
  check('isDiagonal false after clear', !isDiagonal(c, 0, 0));
}

console.log('span-aware insert/delete (BUG 4):');
{
  let g = ensureMeta([{ cells: ['A', 'B', 'C'] }]);
  g = mergeCells(g, { r1: 0, c1: 0, r2: 0, c2: 1 }); // A spans cols 0-1
  g = insertCol(g, 1); // inside the span
  check('insert inside span grows colspan to 3', g[0].cellMeta[0].colspan === 3);
  check('row width grew to 4', g[0].cells.length === 4);
  check('span coverage reindexed', g[0].cellMeta[1].spannedBy && g[0].cellMeta[2].spannedBy && !!g[0].cellMeta[3]);

  let g2 = ensureMeta([{ cells: ['A', 'B', 'C'] }]);
  g2 = mergeCells(g2, { r1: 0, c1: 0, r2: 0, c2: 1 });
  g2 = deleteCol(g2, 1); // delete a covered col
  check('delete covered col shrinks colspan to 1', g2[0].cellMeta[0].colspan === 1);
  check('after shrink, neighbour is primary', g2[0].cellMeta[1].primary && !g2[0].cellMeta[1].spannedBy);

  let g3 = ensureMeta([{ cells: ['X'] }, { cells: ['Y'] }, { cells: ['Z'] }]);
  g3 = mergeCells(g3, { r1: 0, c1: 0, r2: 1, c2: 0 }); // X spans rows 0-1
  g3 = deleteRow(g3, 1);
  check('delete covered row shrinks rowspan to 1', g3[0].cellMeta[0].rowspan === 1 && g3.length === 2);

  let g4 = ensureMeta([{ cells: ['X'] }, { cells: ['Y'] }]);
  g4 = mergeCells(g4, { r1: 0, c1: 0, r2: 1, c2: 0 });
  g4 = insertRow(g4, 1); // inside the rowspan
  check('insert inside rowspan grows rowspan to 3', g4[0].cellMeta[0].rowspan === 3 && g4.length === 3);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
