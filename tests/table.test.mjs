// Table logic characterization tests — locks in behavior of src/lib/table.js
// Pure Node.js test (no browser). Usage: node tests/table.test.mjs

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const {
  parseTableRow, escapePipe,
  parseMdTableToGrid, parseHtmlTableToGrid,
  gridToMdTable, gridToHtmlTable, renderCellMd,
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

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) { console.log('Table tests FAILED.'); process.exit(1); }
console.log('All table tests passed.');
