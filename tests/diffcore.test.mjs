// Diff Core Tests — exercise the pure functional API in src/lib/diff.js
// directly (no Worker, no postMessage). This guards the Node/MCP-reusable core.
// Usage: node tests/diffcore.test.mjs
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { computeDiff, computeDiffStats } from '../src/lib/diff.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'test-data');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name} — ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function loadFixture(name) {
  const json = JSON.parse(readFileSync(join(dataDir, name), 'utf-8'));
  return json.files;
}

console.log('\n--- Diff Core Tests (src/lib/diff.js) ---\n');

const FIXTURES = ['mixed-changes.json', 'delete-only.json', 'table-2row.json'];

for (const fixture of FIXTURES) {
  const files = loadFixture(fixture);
  for (const f of files) {
    const oldText = f.originalContent ?? '';
    const newText = f.content ?? '';

    test(`${fixture} [${f.name}] — computeDiff 回傳結構正確`, () => {
      const { edits, stats } = computeDiff(oldText, newText);
      assert(Array.isArray(edits), 'edits 應為陣列');
      assert(stats && typeof stats === 'object', 'stats 應為物件');
      assert(typeof stats.added === 'number', 'stats.added 應為數字');
      assert(typeof stats.deleted === 'number', 'stats.deleted 應為數字');
      assert(typeof stats.modified === 'number', 'stats.modified 應為數字');
      assert(typeof stats.unchanged === 'number', 'stats.unchanged 應為數字');
    });

    test(`${fixture} [${f.name}] — 計數總和等於 edits 長度`, () => {
      const { edits, stats } = computeDiff(oldText, newText);
      const sum = stats.added + stats.deleted + stats.modified + stats.unchanged;
      assert(sum === edits.length, `期望 ${edits.length}，得到 ${sum}`);
    });

    test(`${fixture} [${f.name}] — changeRatio 落在 [0,1]`, () => {
      const { stats } = computeDiff(oldText, newText);
      assert(stats.changeRatio >= 0 && stats.changeRatio <= 1,
        `changeRatio=${stats.changeRatio} 超出 [0,1]`);
    });

    test(`${fixture} [${f.name}] — computeDiffStats 與 computeDiff.stats 一致`, () => {
      const { stats } = computeDiff(oldText, newText);
      const statsOnly = computeDiffStats(oldText, newText);
      assert(statsOnly.added === stats.added && statsOnly.deleted === stats.deleted
        && statsOnly.modified === stats.modified && statsOnly.unchanged === stats.unchanged,
        'computeDiffStats 與 computeDiff 的 stats 不一致');
    });
  }
}

// 全相同內容：modified/added/deleted 皆為 0
test('全相同內容 — added/deleted/modified 皆為 0', () => {
  const text = '# 標題\n\n這是一段不變的內容。\n\n| 名稱 | 數量 |\n|------|------|\n| 蘋果 | 3 |';
  const { edits, stats } = computeDiff(text, text);
  assert(stats.added === 0, `added 應為 0，得到 ${stats.added}`);
  assert(stats.deleted === 0, `deleted 應為 0，得到 ${stats.deleted}`);
  assert(stats.modified === 0, `modified 應為 0，得到 ${stats.modified}`);
  assert(stats.changeRatio === 0, `changeRatio 應為 0，得到 ${stats.changeRatio}`);
  assert(edits.length === stats.unchanged, '全相同時所有 edits 應為 eq');
});

// legacy 引擎也要能運作並維持計數不變量
test('legacy 引擎 — 計數總和等於 edits 長度', () => {
  const files = loadFixture('mixed-changes.json');
  const f = files[0];
  const { edits, stats } = computeDiff(f.originalContent ?? '', f.content ?? '', { legacy: true });
  const sum = stats.added + stats.deleted + stats.modified + stats.unchanged;
  assert(sum === edits.length, `期望 ${edits.length}，得到 ${sum}`);
  assert(stats.changeRatio >= 0 && stats.changeRatio <= 1, 'changeRatio 超出 [0,1]');
});

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) {
  console.error('Diff core tests FAILED.');
  process.exit(1);
} else {
  console.log('All diff core tests passed.');
}
