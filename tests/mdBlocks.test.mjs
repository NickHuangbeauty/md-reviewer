import { splitMdBlocks, joinMdBlocks } from '../src/mdBlocks.js';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

check('splits paragraphs on blank line', splitMdBlocks('A\n\nB').length === 2);
check('heading is its own block', splitMdBlocks('# H\n\ntext').length === 2 && splitMdBlocks('# H\n\ntext')[0] === '# H');
check('code fence stays one block', splitMdBlocks('```\na\n\nb\n```').length === 1);
check('html table stays one block', splitMdBlocks('<table>\n<tr><td>x</td></tr>\n</table>').length === 1);
check('empty input -> []', splitMdBlocks('').length === 0);
check('joinMdBlocks round-trips paragraphs', joinMdBlocks(['A', 'B']) === 'A\n\nB');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
