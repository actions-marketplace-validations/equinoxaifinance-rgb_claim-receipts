// Wording taken from real AI-agent pull requests in a 103-PR trial, so parser changes can't regress on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTestClaims, findFileMentions, gitignoreMatcher } from '../src/claims.mjs';
import { judgeTestClaims, normaliseChecks, collectReceipts } from '../src/evaluate.mjs';

const CLAIMS = [
  'Tests: 52 passed, ruff clean.',
  '- `dotnet test --filter Foo`: 16/16 passed (10 existing, 6 new).',
  '`anchor.test.mjs` and `retrospect.test.mjs` pass; `py_compile` clean.',
  '- All code coverage, type validation, and unit tests continue to pass.',
  '- `npx tsc --noEmit` passed cleanly with 0 errors.',
  '- `pnpm test --runInBand` passed 92 active test suites (1153 passed tests, 0 failures).',
  '- [x] `npm test` (684 total / 677 pass / 0 fail / 7 cancelled)',
  '- `scripts/fetch-sdk-test.sh` passes with bash 5.',
  '- `go test ./...` → all pass',
  '- `openspec validate --all`: passes.',
  'Executed Python unit test suite (`python3 -m unittest discover tests`). All 34 tests passed cleanly.',
  'Local: 582 hashtag/caption/publisher tests pass, including 4 new ones.',
];
const NOT_CLAIMS = [
  'It passes `{ hoc: [] }` and expects the default.',
  '- [ ] I ran `node test-all.mjs` and all tests pass',
  'Item: b01-p6. Check the changed files, the changed tests and the unit job, then merge on pass.',
  'Tests would pass if the fixture existed.',
];

test('real test-pass wording is recognised', () => {
  for (const line of CLAIMS) assert.equal(findTestClaims(line).length, 1, line);
});

test('real non-claims are ignored', () => {
  for (const line of NOT_CLAIMS) assert.deepEqual(findTestClaims(line), [], line);
});

test('branch prefixes and globs are not file mentions', () => {
  assert.deepEqual(findFileMentions('Branches `claude/`, `codex/`, `cursor/`; files `*-db.ts` and `-db.ts`.'), []);
});

test('jobs that never started are not test failures (billing-blocked CI)', () => {
  const runs = [
    { id: 1, name: 'Tests (Python 3.11)', status: 'completed', conclusion: 'failure', started_at: '2026-10-08T05:00:00Z', completed_at: '2026-10-08T05:00:01Z' },
    { id: 2, name: 'Tests (Python 3.14)', status: 'completed', conclusion: 'failure', started_at: '2026-10-08T05:00:00Z', completed_at: '2026-10-08T05:00:30Z', output: { title: 'The job was not started because your account payments have failed.' } },
  ];
  const r = judgeTestClaims(['582 tests pass'], normaliseChecks(runs));
  assert.equal(r[0].verdict, 'unproven');
  assert.match(r[0].evidence, /probably never ran/);
});

test('a red deploy-preview or PR bot does not contradict "tests pass"', () => {
  const checks = [{ name: 'unit', state: 'passed' }, { name: 'Vercel Preview', state: 'failed' }, { name: 'PR Issue Disposition', state: 'failed' }];
  const r = judgeTestClaims(['tests pass'], checks)[0];
  assert.equal(r.verdict, 'verified');
  assert.match(r.evidence, /Not counted as test evidence: `Vercel Preview`, `PR Issue Disposition` failed/);
  assert.equal(judgeTestClaims(['tests pass'], [...checks, { name: 'e2e', state: 'failed' }])[0].verdict, 'contradicted');
});

test('short file names are found anywhere in the repository tree', async () => {
  const client = {
    getPull: async () => ({ title: 'T', body: 'Updated `auth.json` and `youtube.service.ts` and `ghost.py`.', head: { sha: 'abc1234', repo: { full_name: 'o/r' } } }),
    listPullFiles: async () => [],
    listTree: async () => ({ paths: new Set(['config/auth.json', 'src/services/youtube.service.ts']), truncated: false }),
    pathExists: async () => { throw new Error('should use the tree'); },
  };
  const result = await collectReceipts({ client, repo: 'o/r', number: 1, options: { waitMinutes: 0 } });
  const v = Object.fromEntries(result.receipts.map((r) => [r.claim, r]));
  assert.equal(v['mentions `auth.json`'].verdict, 'verified');
  assert.match(v['mentions `auth.json`'].evidence, /config\/auth\.json/);
  assert.equal(v['mentions `ghost.py`'].verdict, 'unproven');
});

test('label bots, AI reviewers and CodeQL never contradict or hold up a test claim', () => {
  const checks = [
    { name: 'devCheck', state: 'passed' },
    { name: 'check-labels', state: 'failed' },
    { name: 'Analyze (javascript-typescript)', state: 'failed' },
    { name: 'PR Agent Review', state: 'pending' },
    { name: 'Cursor Security Agent: Security Reviewer', state: 'pending' },
  ];
  assert.equal(judgeTestClaims(['tests pass'], checks)[0].verdict, 'verified');
  assert.equal(judgeTestClaims(['tests pass'], [...checks, { name: 'devCheck (nightly)', state: 'failed' }])[0].verdict, 'contradicted');
});

test('gitignore matcher', () => {
  const m = gitignoreMatcher('# comment\nauth.json\n*.key\n/dist\n.generated/\nlogs/**/*.log\n!keep.key\n');
  assert.equal(m('auth.json'), true);
  assert.equal(m('config/auth.json'), true);
  assert.equal(m('bir_key.key'), true);
  assert.equal(m('dist/app.js'), true);
  assert.equal(m('src/dist/app.js'), false, 'anchored to the root');
  assert.equal(m('.generated/giscus/plan.json'), true);
  assert.equal(m('logs/a/b/x.log'), true);
  assert.equal(m('src/auth.ts'), false);
  assert.equal(gitignoreMatcher(null)('x'), false);
});

test('mentions of git-ignored files are skipped, not flagged', async () => {
  const client = {
    getPull: async () => ({ title: 'T', body: 'Reads `auth.json` and `node_modules/x/money.ts`; see `ghost.py`.', head: { sha: 'abc1234', repo: { full_name: 'o/r' } } }),
    listPullFiles: async () => [],
    listTree: async () => ({ paths: new Set(['src/a.py']), truncated: false }),
    getText: async () => 'auth.json\n',
  };
  const result = await collectReceipts({ client, repo: 'o/r', number: 1, options: { waitMinutes: 0 } });
  assert.deepEqual(result.receipts.map((r) => r.claim), ['mentions `ghost.py`']);
});
