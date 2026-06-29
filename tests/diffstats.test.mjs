// computeDiffStats characterization test — locks in counting behavior of the
// pure diff-stats helpers that live in src/components/DiffViewer.jsx.
//
// DiffViewer.jsx is a React/JSX module that cannot be imported directly under
// plain Node, so this test extracts the two *pure* functions
// (isEmptyOrWhitespace, computeDiffStats) by source-slicing and evaluates them
// in isolation. They contain no React/JSX, so this is safe and deterministic.
//
// Usage: node tests/diffstats.test.mjs
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'src', 'components', 'DiffViewer.jsx'), 'utf8');

function sliceFn(name) {
  const marker = 'export function ' + name;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('function not found: ' + name);
  // Walk braces from the first '{' after the signature to find the body end.
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  // Strip the `export ` keyword so we can eval as a plain declaration.
  return src.slice(start, i).replace(/^export\s+/, '');
}

// eslint-disable-next-line no-new-func
const factory = new Function(
  sliceFn('isEmptyOrWhitespace') + '\n' +
  sliceFn('computeDiffStats') + '\n' +
  'return { isEmptyOrWhitespace, computeDiffStats };'
);
const { computeDiffStats, isEmptyOrWhitespace } = factory();

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}

console.log('\n--- isEmptyOrWhitespace ---');
check('empty string is empty', isEmptyOrWhitespace('') === true);
check('whitespace is empty', isEmptyOrWhitespace('   ') === true);
check('table separator row is empty', isEmptyOrWhitespace('|---|---|') === true);
check('plain text is not empty', isEmptyOrWhitespace('hello') === false);
check('cell with colspan is meaningful', isEmptyOrWhitespace('<td colspan="2"></td>') === false);

console.log('\n--- computeDiffStats counts ---');
const edits = [
  { type: 'eq', oldLine: 'a', newLine: 'a', oldIdx: 0, newIdx: 0 },
  { type: 'add', newLine: 'new1' },
  { type: 'add', newLine: 'new2' },
  { type: 'del', oldLine: 'old1' },
  { type: 'modify', oldLine: 'x', newLine: 'y' },
];
const s = computeDiffStats(edits);
check('total = 5', s.total === 5);
check('added = 2', s.added === 2);
check('deleted = 1', s.deleted === 1);
check('modified = 1', s.modified === 1);
check('unchanged = 1', s.unchanged === 1);
check('changed = added+deleted+modified = 4', s.changed === 4);
check('changeRatio capped at <= 1', s.changeRatio <= 1.0);

const empty = computeDiffStats([]);
check('empty edits -> all zero counts', empty.total === 0 && empty.added === 0 && empty.changed === 0);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) { console.log('Diff-stats tests FAILED.'); process.exit(1); }
console.log('All diff-stats tests passed.');
