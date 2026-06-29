// Markdown / marks characterization tests — locks in behavior of
// src/lib/markdown.js + src/lib/marks.js. Pure Node.js (no browser).
// Usage: node tests/markdown.test.mjs

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { splitMdBlocks, joinMdBlocks } = await import(join(__dirname, '..', 'src', 'lib', 'markdown.js'));
const { injectMarksToMd } = await import(join(__dirname, '..', 'src', 'lib', 'marks.js'));

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}

console.log('\n--- splitMdBlocks ---');
check('empty -> []', JSON.stringify(splitMdBlocks('')) === '[]');
check('heading is its own block', (() => {
  const b = splitMdBlocks('# Title\n\npara text');
  return b.length === 2 && b[0] === '# Title' && b[1] === 'para text';
})());
check('code fence kept as one block', (() => {
  const b = splitMdBlocks('```js\nconst a=1;\nconst b=2;\n```');
  return b.length === 1 && b[0].includes('const a=1;') && b[0].includes('```');
})());
check('md table kept as one block', (() => {
  const b = splitMdBlocks('| a | b |\n| - | - |\n| 1 | 2 |');
  return b.length === 1 && b[0].split('\n').length === 3;
})());
check('html table kept as one block', (() => {
  const b = splitMdBlocks('<table><tr><td>x</td></tr></table>');
  return b.length === 1 && b[0].includes('<table>');
})());
check('blank line separates paragraphs', (() => {
  const b = splitMdBlocks('one\n\ntwo');
  return b.length === 2 && b[0] === 'one' && b[1] === 'two';
})());
check('blockquote grouped', (() => {
  const b = splitMdBlocks('> q1\n> q2\n\nafter');
  return b.length === 2 && b[0].startsWith('>') && b[1] === 'after';
})());

console.log('\n--- joinMdBlocks ---');
check('joins with blank line', joinMdBlocks(['a', 'b']) === 'a\n\nb');
check('split/join round-trip block count', (() => {
  const src = '# H\n\npara\n\n- a\n- b';
  return splitMdBlocks(joinMdBlocks(splitMdBlocks(src))).length === splitMdBlocks(src).length;
})());

console.log('\n--- injectMarksToMd ---');
check('no marks returns content unchanged', injectMarksToMd('hello', []) === 'hello');
check('mark injected after its block as HTML comment', (() => {
  const content = '# Title\n\npara';
  const out = injectMarksToMd(content, [{ blockId: 'block-1', issue: '錯字' }]);
  return out.includes('<!-- [審核問題] 錯字 -->') && out.indexOf('錯字') > out.indexOf('para');
})());
check('comment-terminator in issue is neutralized', (() => {
  const out = injectMarksToMd('x', [{ blockId: 'block-0', issue: 'a --> b' }]);
  return out.includes('a —> b') && !out.includes('a --> b -->');
})());

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) { console.log('Markdown tests FAILED.'); process.exit(1); }
console.log('All markdown tests passed.');
