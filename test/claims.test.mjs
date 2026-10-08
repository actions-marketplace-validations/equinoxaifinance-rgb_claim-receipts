import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTestClaims, findIssueLinks, findFileMentions, findSymbolMentions, stripNonClaims } from '../src/claims.mjs';

test('finds common "tests pass" claims', () => {
  const body = [
    'Refactored the parser.',
    '- [x] All tests pass',
    'CI is green.',
    'npm test passes locally.',
    'Ran pytest, 42 passed.',
  ].join('\n');
  const claims = findTestClaims(body);
  assert.equal(claims.length, 4);
  assert.ok(claims.includes('All tests pass'));
  assert.ok(claims.includes('CI is green.'));
});

test('ignores negated, future and unticked test statements', () => {
  const body = [
    "Tests don't pass yet.",
    'Tests will pass once the fixture lands.',
    '- [ ] Tests pass',
    'Some tests failed on Windows; the rest pass.',
    'Tests are not passing.',
  ].join('\n');
  assert.deepEqual(findTestClaims(body), []);
});

test('ignores claims inside code fences, quotes and template comments', () => {
  const body = '<!-- Confirm all tests pass -->\n> tests pass\n```\nall tests passed\n```\nNothing else.';
  assert.deepEqual(findTestClaims(body), []);
  assert.equal(stripNonClaims(body).includes('pass'), false);
});

test('finds linked issues, same repo and cross repo, once each', () => {
  const links = findIssueLinks('Fixes #12. Also closes acme/web#7 and fixes #12 again. Resolves: #3', 'me/app');
  assert.deepEqual(links.map((l) => `${l.repo}#${l.number}`), ['me/app#12', 'acme/web#7', 'me/app#3']);
});

test('finds file paths in backticks and bare paths, not URLs or versions', () => {
  const body = 'Updated `src/parser.ts` and `README.md`, see https://x.com/a/b.js and src/lib/util.py. Bumped to `1.2.3`. Line `src/a.ts:42`. Not `npm install foo` or `@scope/pkg`.';
  const files = findFileMentions(body);
  assert.deepEqual(files.sort(), ['README.md', 'src/a.ts', 'src/lib/util.py', 'src/parser.ts']);
});

test('finds function mentions written as name()', () => {
  assert.deepEqual(findSymbolMentions('Added `parseConfig()` and `Store.save()`; `notAFunction` is ignored.'), ['parseConfig', 'Store.save']);
});
