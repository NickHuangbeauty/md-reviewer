// Golden tests for the shared change-magnitude formula (src/diffStats.js).
// Run: node tests/diffStats.test.mjs
import { isEmptyOrWhitespace, computeDiffStats } from '../src/diffStats.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

console.log('isEmptyOrWhitespace:');
check('blank line is empty', isEmptyOrWhitespace('   ') === true);
check('plain text is meaningful', isEmptyOrWhitespace('hello world') === false);
check('md table separator is structural', isEmptyOrWhitespace('|---|---|') === true);
check('empty td is structural', isEmptyOrWhitespace('<td></td>') === true);
check('td with colspan is meaningful', isEmptyOrWhitespace('<td colspan="2"></td>') === false);
check('bare <tr> is structural (unified worker rule)', isEmptyOrWhitespace('<tr>') === true);
check('bare </table> is structural', isEmptyOrWhitespace('</table>') === true);
check('<br> is structural', isEmptyOrWhitespace('<br>') === true);

console.log('computeDiffStats:');
// Counts add up and match edits.length (canary COUNT_MISMATCH invariant)
{
  const edits = [
    { type: 'eq', oldLine: 'a', newLine: 'a' },
    { type: 'add', newLine: 'new line' },
    { type: 'del', oldLine: 'gone' },
    { type: 'modify', oldLine: 'x', newLine: 'y' },
  ];
  const s = computeDiffStats(edits);
  check('counts sum to total', s.added + s.deleted + s.modified + s.unchanged === edits.length);
  check('total reported', s.total === 4);
  check('oldTotal = del+eq+modify', s.oldTotal === 3);
  check('changed = add+del+modify', s.changed === 3);
  check('changeRatio within [0,1]', s.changeRatio >= 0 && s.changeRatio <= 1);
}
// Whitespace edits weigh 0.1 not 1
{
  const meaningful = computeDiffStats([{ type: 'add', newLine: 'real content' }, { type: 'eq', oldLine: 'base', newLine: 'base' }]);
  const blank = computeDiffStats([{ type: 'add', newLine: '   ' }, { type: 'eq', oldLine: 'base', newLine: 'base' }]);
  check('blank add weighs less than real add', blank.changeRatio < meaningful.changeRatio);
  check('real single add over 1 base = 1.0 ratio', approx(meaningful.changeRatio, 1.0));
  check('blank single add over 1 base = 0.1 ratio', approx(blank.changeRatio, 0.1));
}
// changeRatio capped at 1.0 even with many additions
{
  const edits = [{ type: 'del', oldLine: 'one' }, ...Array.from({ length: 20 }, () => ({ type: 'add', newLine: 'x' }))];
  const s = computeDiffStats(edits);
  check('changeRatio capped at 1.0', s.changeRatio === 1.0);
}
// Empty edits → no NaN
{
  const s = computeDiffStats([]);
  check('empty edits → ratio is finite number', Number.isFinite(s.changeRatio));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
