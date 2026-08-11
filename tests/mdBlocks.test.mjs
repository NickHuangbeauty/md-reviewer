import { splitMdBlocks, joinMdBlocks, remapMarksByContent } from '../src/mdBlocks.js';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

check('splits paragraphs on blank line', splitMdBlocks('A\n\nB').length === 2);
check('heading is its own block', splitMdBlocks('# H\n\ntext').length === 2 && splitMdBlocks('# H\n\ntext')[0] === '# H');
check('code fence stays one block', splitMdBlocks('```\na\n\nb\n```').length === 1);
check('html table stays one block', splitMdBlocks('<table>\n<tr><td>x</td></tr>\n</table>').length === 1);
check('empty input -> []', splitMdBlocks('').length === 0);
check('joinMdBlocks round-trips paragraphs', joinMdBlocks(['A', 'B']) === 'A\n\nB');

console.log('remapMarksByContent (source-edit re-anchoring):');
{
  const before = 'A\n\nB\n\nC';
  // a block inserted ABOVE the marked one → mark must follow B from idx1 to idx2
  const after = 'NEW\n\nA\n\nB\n\nC';
  const out = remapMarksByContent(before, after, [{ blockId: 'block-1', issue: 'about B' }]);
  check('mark follows its block when a block is inserted above', out[0].blockId === 'block-2');
  check('mark payload preserved', out[0].issue === 'about B');
}
{
  // a block deleted above → mark shifts down
  const out = remapMarksByContent('A\n\nB\n\nC', 'B\n\nC', [{ blockId: 'block-2', issue: 'about C' }]);
  check('mark follows when a block is deleted above', out[0].blockId === 'block-0' || out[0].blockId === 'block-1');
}
{
  // unchanged content → identical marks (no churn)
  const md = 'A\n\nB';
  const marks = [{ blockId: 'block-1', issue: 'x' }];
  check('no change → mark untouched', remapMarksByContent(md, md, marks)[0].blockId === 'block-1');
}
{
  // the marked block's own text was edited → no confident match → left as-is
  const out = remapMarksByContent('A\n\nB', 'A\n\nB 改過了', [{ blockId: 'block-1', issue: 'x' }]);
  check('edited block text → mark left untouched (conservative)', out[0].blockId === 'block-1');
}
{
  // legacy non-positional ids are never touched
  const out = remapMarksByContent('A\n\nB', 'X\n\nA\n\nB', [{ blockId: 'cell-2-3', issue: 'x' }]);
  check('legacy cell-id untouched', out[0].blockId === 'cell-2-3');
}
{
  // duplicate block text: each new block claims at most one mark
  const out = remapMarksByContent('D\n\nD', 'Z\n\nD\n\nD', [{ blockId: 'block-0', issue: 'a' }, { blockId: 'block-1', issue: 'b' }]);
  check('duplicate texts map to distinct blocks', out[0].blockId !== out[1].blockId);
}
check('empty marks → returns empty', remapMarksByContent('A', 'A', []).length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
