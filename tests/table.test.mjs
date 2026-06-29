// Table logic characterization tests — locks in behavior of src/lib/table.js
// Pure Node.js test (no browser). Usage: node tests/table.test.mjs

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const {
  parseTableRow, escapePipe,
  parseMdTableToGrid, parseHtmlTableToGrid,
  gridToMdTable, gridToHtmlTable, renderCellMd,
  mergeCells, splitCell,
} = await import(join(__dirname, '..', 'src', 'lib', 'table.js'));

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}
function eq(name, a, b) { check(name + ` (got: ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b)); }

console.log('\n--- parseTableRow ---');
eq('basic row', parseTableRow('| a | b | c |'), ['a', 'b', 'c']);
eq('escaped pipe kept', parseTableRow('| a \\| b | c |'), ['a | b', 'c']);
eq('no outer pipes', parseTableRow('a|b'), ['a', 'b']);

console.log('\n--- escapePipe ---');
eq('escapes pipe', escapePipe('a|b'), 'a\\|b');
eq('no pipe unchanged', escapePipe('abc'), 'abc');

console.log('\n--- parseMdTableToGrid ---');
{
  const md = '| h1 | h2 |\n| --- | --- |\n| a | b |';
  const g = parseMdTableToGrid(md);
  check('header detected', g[0].isHeader === true && g[1].isHeader === false);
  eq('header cells', g[0].cells, ['h1', 'h2']);
  eq('body cells', g[1].cells, ['a', 'b']);
  check('records hasSeparatorLine', g._originalFormat.hasSeparatorLine === true);
}
{
  // Compact format ||| — no separator => no header
  const g = parseMdTableToGrid('|a|b|\n|c|d|');
  check('compact: no header', g[0].isHeader === false);
  check('compact: isCompactFormat', g._originalFormat.isCompactFormat === true);
  eq('compact: rows normalized to equal cols', [g[0].cells.length, g[1].cells.length], [2, 2]);
}
check('non-table returns null', parseMdTableToGrid('just text') === null);

console.log('\n--- gridToMdTable (round-trip) ---');
{
  const md = '| h1 | h2 |\n| --- | --- |\n| a | b |';
  const g = parseMdTableToGrid(md);
  const out = gridToMdTable(g);
  const g2 = parseMdTableToGrid(out);
  eq('round-trip header cells', g2[0].cells, ['h1', 'h2']);
  eq('round-trip body cells', g2[1].cells, ['a', 'b']);
}

console.log('\n--- parseHtmlTableToGrid (colspan/rowspan) ---');
{
  const html = '<table><tr><td colspan="2">A</td></tr><tr><td>B</td><td>C</td></tr></table>';
  const g = parseHtmlTableToGrid(html);
  check('2 rows', g.length === 2);
  check('colspan primary meta', g[0].cellMeta[0].colspan === 2 && g[0].cellMeta[0].primary === true);
  check('spanned cell marked non-primary', g[0].cellMeta[1].primary === false);
  eq('row2 cells', [g[1].cells[0], g[1].cells[1]], ['B', 'C']);
}
{
  const html = '<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>';
  const g = parseHtmlTableToGrid(html);
  check('rowspan primary', g[0].cellMeta[0].rowspan === 2 && g[0].cellMeta[0].primary === true);
  check('rowspan-occupied cell non-primary', g[1].cellMeta[0].primary === false);
  check('shifted cell placed', g[1].cells[1] === 'C');
}

console.log('\n--- gridToHtmlTable (round-trip colspan) ---');
{
  const html = '<table><tr><td colspan="2">A</td></tr><tr><td>B</td><td>C</td></tr></table>';
  const g = parseHtmlTableToGrid(html);
  const out = gridToHtmlTable(g);
  check('emits colspan="2"', out.includes('colspan="2"'));
  check('emits A/B/C', out.includes('>A<') && out.includes('>B<') && out.includes('>C<'));
  const g2 = parseHtmlTableToGrid(out);
  check('round-trip keeps colspan', g2[0].cellMeta[0].colspan === 2);
}

console.log('\n--- renderCellMd ---');
eq('empty -> nbsp', renderCellMd(''), ' ');
eq('bold', renderCellMd('**x**'), '<strong>x</strong>');
eq('italic', renderCellMd('*x*'), '<em>x</em>');
eq('code', renderCellMd('`x`'), '<code class="cd">x</code>');
check('escapes html', renderCellMd('<b>').includes('&lt;b&gt;'));
check('newline -> br', renderCellMd('a\nb') === 'a<br>b');

console.log('\n--- mergeCells / splitCell ---');
{
  // 水平合併兩格：colspan=2，被覆蓋格 primary=false
  const html = '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>';
  const g = parseHtmlTableToGrid(html);
  const merged = mergeCells(g, 0, 0, 0, 1);
  check('merge 不可變更原 grid', g[0].cellMeta[0].colspan === 1);
  check('水平合併 colspan=2', merged[0].cellMeta[0].colspan === 2 && merged[0].cellMeta[0].rowspan === 1);
  check('水平合併 primary', merged[0].cellMeta[0].primary === true);
  check('被覆蓋格 primary=false', merged[0].cellMeta[1].primary === false);
  check('被覆蓋格 spannedBy 指向 primary',
    merged[0].cellMeta[1].spannedBy && merged[0].cellMeta[1].spannedBy.r === 0 && merged[0].cellMeta[1].spannedBy.c === 0);
  check('合併保留左上角文字', merged[0].cells[0] === 'A' && merged[0].cells[1] === '');

  const out = gridToHtmlTable(merged);
  check('合併輸出含 colspan="2"', out.includes('colspan="2"'));
  // 被覆蓋格不輸出 → 第一列只剩一個 cell（td 數量比原本少一個）
  const tdCountRow1 = (out.split('</tr>')[0].match(/<t[dh]/g) || []).length;
  check('合併後第一列少一個 cell', tdCountRow1 === 1);

  // split 還原
  const split = splitCell(merged, 0, 0);
  check('split 後 colspan 還原為 1', split[0].cellMeta[0].colspan === 1 && split[0].cellMeta[0].rowspan === 1);
  check('split 後被覆蓋格還原 primary', split[0].cellMeta[1].primary === true);
  check('split 不可變更 merged grid', merged[0].cellMeta[0].colspan === 2);
  const outSplit = gridToHtmlTable(split);
  check('split 後不含 colspan', !outSplit.includes('colspan='));
  const tdCountSplit = (outSplit.split('</tr>')[0].match(/<t[dh]/g) || []).length;
  check('split 後第一列恢復兩個 cell', tdCountSplit === 2);
}
{
  // 垂直合併：rowspan=2
  const html = '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>';
  const g = parseHtmlTableToGrid(html);
  const merged = mergeCells(g, 0, 0, 1, 0);
  check('垂直合併 rowspan=2', merged[0].cellMeta[0].rowspan === 2 && merged[0].cellMeta[0].colspan === 1);
  check('垂直被覆蓋格 primary=false', merged[1].cellMeta[0].primary === false);
  const out = gridToHtmlTable(merged);
  check('垂直合併輸出含 rowspan="2"', out.includes('rowspan="2"'));
}
{
  // 座標正規化：傳入相反方向也要正確
  const html = '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>';
  const g = parseHtmlTableToGrid(html);
  const merged = mergeCells(g, 1, 1, 0, 0); // 2x2 區域，左上 (0,0)
  check('正規化後 primary 在左上', merged[0].cellMeta[0].colspan === 2 && merged[0].cellMeta[0].rowspan === 2);
  check('正規化後 (1,1) 非 primary', merged[1].cellMeta[1].primary === false);
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) { console.log('Table tests FAILED.'); process.exit(1); }
console.log('All table tests passed.');
