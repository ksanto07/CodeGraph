import assert from 'node:assert/strict';
import { evaluatePaths, pathGrammarLimitations, type PathMention } from '../lib/evals/paths.ts';

function check(body: string, shown: readonly string[], expected: readonly string[], invented: readonly string[] = [], ambiguous: readonly string[] = []): void {
  const result = evaluatePaths(body, shown);
  assert.deepEqual(result.checked.map(item => item.raw), expected, body);
  assert.deepEqual(result.invented.map(item => item.raw), invented, body);
  assert.deepEqual(result.ambiguous.map(item => item.raw), ambiguous, body);
  assert.equal(result.score, invented.length ? 0 : ambiguous.length ? null : 1);
  for (const mention of result.checked) assert.equal(body.slice(mention.start, mention.end), mention.raw);
}

const shown = ['src/a.ts', 'src/b.test.d.ts', '.env.local', 'src/util', 'src/é.ts'];
check('The service imports `src/a.ts` and **src/b.test.d.ts**.', shown, ['src/a.ts', 'src/b.test.d.ts']);
check('The service also imports `src/made-up.ts`.', shown, ['src/made-up.ts'], ['src/made-up.ts']);
check('src/a.ts,src/b.test.d.ts; src/a.ts:12:4.', shown, ['src/a.ts', 'src/b.test.d.ts', 'src/a.ts']);
check('Does src/a.ts? Yes!', shown, ['src/a.ts']);
check('- .env.local\n- src/util\n- src/é.ts.', shown, ['.env.local', 'src/util', 'src/é.ts']);
check('[src/a.ts](src/b.test.d.ts)', shown, ['src/a.ts', 'src/b.test.d.ts']);
check('[src/a.ts](https://example.com/src/a.ts)', shown, ['src/a.ts', 'https://example.com/src/a.ts'], ['https://example.com/src/a.ts']);
check('https://example.com:8443/src/a.ts?q=1', [], ['https://example.com:8443/src/a.ts?q=1'], ['https://example.com:8443/src/a.ts?q=1']);
check('`src/elsewhere.ts` exists in the repository but was not shown.', shown, ['src/elsewhere.ts'], ['src/elsewhere.ts']);
check('`a.ts` `./src/a.ts` `SRC/a.ts` `src/../src/a.ts` `src\\a.ts`', shown,
  ['a.ts', './src/a.ts', 'SRC/a.ts', 'src/../src/a.ts', 'src\\a.ts'],
  ['a.ts', './src/a.ts', 'SRC/a.ts', 'src/../src/a.ts', 'src\\a.ts']);
check('"src/my file.spec.tsx" and \'src/a(b),c.ts\'.', ['src/my file.spec.tsx', 'src/a(b),c.ts'], ['src/my file.spec.tsx', 'src/a(b),c.ts']);
check('`src/a.ts.`', ['src/a.ts'], ['src/a.ts.'], ['src/a.ts.']);
check('`src/a.ts.`', ['src/a.ts.'], ['src/a.ts.']);
check('src/a.ts.', ['src/a.ts.'], ['src/a.ts'], ['src/a.ts']);
check('``src/has`tick.ts`` and `src/[id]/page.tsx`', ['src/has`tick.ts', 'src/[id]/page.tsx'], ['src/has`tick.ts', 'src/[id]/page.tsx']);
check('`src/a%20b.ts` "src/a b.ts"', ['src/a b.ts'], ['src/a%20b.ts', 'src/a b.ts'], ['src/a%20b.ts']);
check('src/my file.ts', ['src/my file.ts'], ['src/my', 'file.ts'], ['file.ts'], ['src/my']);
check('This uses e.g. and config/service.', [], ['e.g', 'config/service'], [], ['e.g', 'config/service']);
check("It isn't a new path; don't guess.", [], []);
check('React/TypeScript controller/module create/update controller/module/test DTO/entity context/state', [],
  ['React/TypeScript', 'controller/module', 'create/update', 'controller/module/test', 'DTO/entity', 'context/state'], [],
  ['React/TypeScript', 'controller/module', 'create/update', 'controller/module/test', 'DTO/entity', 'context/state']);
check('config/service', [], ['config/service'], [], ['config/service']);
check('config/service', ['config/service'], ['config/service']);
check('`config/service` ./config/service /config/service', [],
  ['config/service', './config/service', '/config/service'], ['config/service', './config/service', '/config/service']);
check('context/state `missing/path`', [], ['context/state', 'missing/path'], ['missing/path'], ['context/state']);
check('a.c', [], ['a.c'], [], ['a.c']);
check('a.c', ['a.c'], ['a.c']);
check('Next.js', [], ['Next.js'], ['Next.js']);
check('C:\\src\\a.ts:22', [], ['C:\\src\\a.ts'], ['C:\\src\\a.ts']);
check('```ts\nsrc/a.ts\nsrc/missing.ts\n```', shown, ['src/a.ts', 'src/missing.ts'], ['src/missing.ts']);
const text = '😀 `src/é.ts` followed by src/a.ts.';
const expectedSpans: PathMention[] = [
  { raw: 'src/é.ts', start: 4, end: 12 },
  { raw: 'src/a.ts', start: 26, end: 34 },
];
assert.deepEqual(evaluatePaths(text, shown).checked, expectedSpans);
const repeat = evaluatePaths('src/a.ts src/a.ts', shown);
assert.equal(repeat.checked.length, 2);
assert.equal(evaluatePaths('No filenames mentioned.', []).score, 1);
assert.equal(evaluatePaths('No filenames mentioned.', []).checked.length, 0);
console.log('Exact path evaluation catches invented and unshown paths, preserves framed literal bytes and UTF-16 offsets, and rejects normalization aliases.');
console.log(pathGrammarLimitations);
