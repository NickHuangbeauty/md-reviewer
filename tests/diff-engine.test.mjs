// Diff Engine Canary Tests
// Direct Node.js test — no browser needed
// Usage: node tests/diff-engine.test.mjs

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock Worker environment
const postedMessages = [];
globalThis.self = {
  postMessage: (msg) => postedMessages.push(msg),
  onmessage: null,
};

// Import diff and canary modules
const { validateEdits, validateStats, mergeReports } = await import(join(__dirname, '..', 'src', 'canary.js'));

// We cannot import diffWorker.js directly because it uses `import { diffTrimmedLines } from 'diff'`
// which requires the diff package to be resolvable. Use dynamic import with createRequire.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Make 'diff' available for the worker's ES import
// Since diffWorker.js uses ESM imports, we need to handle this differently.
// The simplest approach: test the canary validators directly with synthetic data.

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \u2705 ${name}`);
    passed++;
  } catch (err) {
    console.error(`  \u274c ${name} — ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

console.log('\n--- Diff Engine Canary Tests ---\n');

// ===== Test validateEdits =====

console.log('validateEdits:');

await test('Valid eq edits pass', () => {
  const edits = [
    { type: 'eq', oldLine: 'hello', newLine: 'hello', oldIdx: 0, newIdx: 0 },
    { type: 'eq', oldLine: 'world', newLine: 'world', oldIdx: 1, newIdx: 1 },
  ];
  const r = validateEdits(edits);
  assert(r.violations.length === 0, `Expected 0 violations, got ${r.violations.length}: ${r.violations.map(v=>v.message).join('; ')}`);
  assert(r.suspicious.length === 0);
});

await test('Valid mixed edits pass', () => {
  const edits = [
    { type: 'eq', oldLine: '# Title', newLine: '# Title', oldIdx: 0, newIdx: 0 },
    { type: 'del', oldLine: 'removed', oldIdx: 1 },
    { type: 'add', newLine: 'added', newIdx: 1 },
    { type: 'modify', oldLine: 'old text', newLine: 'new text', oldIdx: 2, newIdx: 2, similarity: 0.7 },
  ];
  const r = validateEdits(edits);
  assert(r.violations.length === 0, `Got violations: ${r.violations.map(v=>v.message).join('; ')}`);
});

await test('Invalid edit type detected', () => {
  const edits = [{ type: 'invalid', oldLine: 'x' }];
  const r = validateEdits(edits);
  assert(r.violations.length === 1);
  assert(r.violations[0].code === 'INVALID_EDIT_TYPE');
});

await test('Missing newLine on add detected', () => {
  const edits = [{ type: 'add' }];
  const r = validateEdits(edits);
  assert(r.violations.some(v => v.code === 'ADD_MISSING_FIELDS'));
});

await test('Missing oldLine on del detected', () => {
  const edits = [{ type: 'del' }];
  const r = validateEdits(edits);
  assert(r.violations.some(v => v.code === 'DEL_MISSING_FIELDS'));
});

await test('Missing fields on modify detected', () => {
  const edits = [{ type: 'modify', newLine: 'x' }];
  const r = validateEdits(edits);
  assert(r.violations.some(v => v.code === 'MODIFY_MISSING_FIELDS'));
});

await test('Missing fields on eq detected', () => {
  const edits = [{ type: 'eq', oldLine: 'x' }];
  const r = validateEdits(edits);
  assert(r.violations.some(v => v.code === 'EQ_MISSING_FIELDS'));
});

await test('Duplicate oldIdx detected', () => {
  const edits = [
    { type: 'del', oldLine: 'a', oldIdx: 0 },
    { type: 'del', oldLine: 'b', oldIdx: 0 },
  ];
  const r = validateEdits(edits);
  assert(r.violations.some(v => v.code === 'DUP_OLD_IDX'));
});

await test('Duplicate newIdx detected', () => {
  const edits = [
    { type: 'add', newLine: 'a', newIdx: 5 },
    { type: 'add', newLine: 'b', newIdx: 5 },
  ];
  const r = validateEdits(edits);
  assert(r.violations.some(v => v.code === 'DUP_NEW_IDX'));
});

await test('All-modify low similarity flagged as suspicious', () => {
  const edits = Array.from({ length: 10 }, (_, i) => ({
    type: 'modify', oldLine: `old${i}`, newLine: `completely_different_${i}`,
    oldIdx: i, newIdx: i, similarity: 0.1,
  }));
  const r = validateEdits(edits);
  assert(r.suspicious.some(s => s.code === 'ALL_MODIFIED_LOW_SIM'));
});

await test('Non-array edits detected', () => {
  const r = validateEdits(null);
  assert(r.violations.some(v => v.code === 'EDITS_NOT_ARRAY'));
});

// ===== Test validateStats =====

console.log('\nvalidateStats:');

await test('Valid stats pass', () => {
  const edits = [
    { type: 'eq', oldLine: 'a', newLine: 'a', oldIdx: 0, newIdx: 0 },
    { type: 'add', newLine: 'b', newIdx: 1 },
    { type: 'del', oldLine: 'c', oldIdx: 1 },
    { type: 'modify', oldLine: 'd', newLine: 'e', oldIdx: 2, newIdx: 2, similarity: 0.8 },
  ];
  const stats = { added: 1, deleted: 1, modified: 1, unchanged: 1, changed: 3, changeRatio: 0.5, oldTotal: 3 };
  const r = validateStats(stats, edits);
  assert(r.violations.length === 0, `Got violations: ${r.violations.map(v=>v.message).join('; ')}`);
});

await test('Count mismatch detected', () => {
  const edits = [{ type: 'eq', oldLine: 'a', newLine: 'a' }];
  const stats = { added: 5, deleted: 0, modified: 0, unchanged: 0, changeRatio: 0.5 };
  const r = validateStats(stats, edits);
  assert(r.violations.some(v => v.code === 'COUNT_MISMATCH'));
});

await test('NaN changeRatio detected', () => {
  const stats = { added: 0, deleted: 0, modified: 0, unchanged: 0, changeRatio: NaN };
  const r = validateStats(stats, []);
  assert(r.violations.some(v => v.code === 'RATIO_NAN'));
});

await test('Infinity changeRatio detected', () => {
  const stats = { added: 0, deleted: 0, modified: 0, unchanged: 0, changeRatio: Infinity };
  const r = validateStats(stats, []);
  assert(r.violations.some(v => v.code === 'RATIO_NAN'));
});

await test('changeRatio out of range detected', () => {
  const stats = { added: 0, deleted: 0, modified: 0, unchanged: 0, changeRatio: 2.5 };
  const r = validateStats(stats, []);
  assert(r.violations.some(v => v.code === 'RATIO_OUT_OF_RANGE'));
});

await test('Negative changeRatio detected', () => {
  const stats = { added: 0, deleted: 0, modified: 0, unchanged: 0, changeRatio: -0.1 };
  const r = validateStats(stats, []);
  assert(r.violations.some(v => v.code === 'RATIO_OUT_OF_RANGE'));
});

await test('oldTotal mismatch detected', () => {
  const edits = [
    { type: 'eq', oldLine: 'a', newLine: 'a' },
    { type: 'del', oldLine: 'b' },
  ];
  const stats = { added: 0, deleted: 1, modified: 0, unchanged: 1, changeRatio: 0.5, oldTotal: 99 };
  const r = validateStats(stats, edits);
  assert(r.violations.some(v => v.code === 'OLD_TOTAL_MISMATCH'));
});

await test('High ratio without add/del flagged as suspicious', () => {
  const edits = Array.from({ length: 5 }, (_, i) => ({
    type: 'modify', oldLine: `o${i}`, newLine: `n${i}`, oldIdx: i, newIdx: i, similarity: 0.2,
  }));
  const stats = { added: 0, deleted: 0, modified: 5, unchanged: 0, changeRatio: 0.9, oldTotal: 5 };
  const r = validateStats(stats, edits);
  assert(r.suspicious.some(s => s.code === 'HIGH_RATIO_NO_ADD_DEL'));
});

await test('Null stats detected', () => {
  const r = validateStats(null, []);
  assert(r.violations.some(v => v.code === 'STATS_INVALID'));
});

// ===== Test mergeReports =====

console.log('\nmergeReports:');

await test('Merge combines violations and suspicious', () => {
  const a = { violations: [{ code: 'A' }], suspicious: [{ code: 'SA' }] };
  const b = { violations: [{ code: 'B' }], suspicious: [] };
  const merged = mergeReports(a, b);
  assert(merged.violations.length === 2);
  assert(merged.suspicious.length === 1);
});

// ===== Fixture-based tests =====

console.log('\nFixture validation:');

const fixtureFiles = ['single-file.json', 'mixed-changes.json', 'delete-only.json', 'all-identical.json', 'no-original.json', 'large-set.json'];

for (const fname of fixtureFiles) {
  await test(`Fixture: ${fname} — files have valid structure`, () => {
    const fpath = join(__dirname, '..', 'test-data', fname);
    const data = JSON.parse(readFileSync(fpath, 'utf-8'));
    assert(data.version === 1, 'version should be 1');
    assert(Array.isArray(data.files), 'files should be array');
    for (const f of data.files) {
      assert(typeof f.name === 'string' && f.name.length > 0, `file name missing`);
      assert(typeof f.content === 'string', `content should be string for ${f.name}`);
      assert(Array.isArray(f.marks), `marks should be array for ${f.name}`);
    }
  });
}

// ===== Summary =====
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
console.log('All canary tests passed.\n');
