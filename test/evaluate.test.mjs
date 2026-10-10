import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseChecks, judgeTestClaims, judgeIssue, judgeFile, judgeSymbol, judgeDependency, summarise, shouldFail, collectReceipts } from '../src/evaluate.mjs';

const run = (name, status, conclusion, runId = 1, id = Math.floor(Math.random() * 1e9)) => ({ id, name, status, conclusion, details_url: `https://github.com/o/r/actions/runs/${runId}/job/9`, html_url: `https://github.com/o/r/runs/${runId}` });

test('normaliseChecks drops only this job, plus ignored and non-matching names', () => {
  // Same workflow run (99) for "unit-tests" and "receipts": a sibling job is still evidence.
  const checks = normaliseChecks(
    [run('unit-tests', 'in_progress', null, 99, 1), run('receipts', 'in_progress', null, 99, 2), run('lint', 'completed', 'failure', 3, 3)],
    [{ context: 'ci/legacy', state: 'pending', target_url: null }],
    { selfJobId: 2, ignore: ['lint'] },
  );
  assert.deepEqual(checks.map((c) => `${c.name}:${c.state}`), ['unit-tests:pending', 'ci/legacy:pending']);
  const byName = normaliseChecks([run('receipts', 'in_progress', null), run('receipts-old', 'completed', 'success')], [], { selfJobName: 'receipts' });
  assert.deepEqual(byName.map((c) => c.name), ['receipts-old']);
  const onlyTests = normaliseChecks([run('unit tests', 'completed', 'success'), run('deploy', 'completed', 'failure')], [], { include: /test/i });
  assert.deepEqual(onlyTests.map((c) => c.name), ['unit tests']);
});

test('tests claim: verified, contradicted, pending, unproven', () => {
  const passed = [{ name: 'test', state: 'passed' }];
  assert.equal(judgeTestClaims(['tests pass'], passed)[0].verdict, 'verified');
  assert.equal(judgeTestClaims(['tests pass'], [...passed, { name: 'e2e', state: 'failed' }])[0].verdict, 'contradicted');
  assert.equal(judgeTestClaims(['tests pass'], [...passed, { name: 'e2e', state: 'pending' }])[0].verdict, 'pending');
  assert.equal(judgeTestClaims(['tests pass'], [])[0].verdict, 'unproven');
  assert.equal(judgeTestClaims(['tests pass'], [{ name: 'x', state: 'neutral' }])[0].verdict, 'unproven');
  assert.deepEqual(judgeTestClaims([], passed), []);
});

test('issue links', () => {
  assert.equal(judgeIssue({ repo: 'o/r', number: 5, text: 'fixes #5' }, null, 'o/r').verdict, 'contradicted');
  assert.equal(judgeIssue({ repo: 'x/y', number: 5, text: 'fixes x/y#5' }, null, 'o/r').verdict, 'unproven');
  assert.equal(judgeIssue({ repo: 'o/r', number: 5, text: 'fixes #5' }, { title: 'PR', pull_request: {} }, 'o/r').verdict, 'warning');
  assert.equal(judgeIssue({ repo: 'o/r', number: 5, text: 'fixes #5' }, { title: 'Bug', state: 'open' }, 'o/r').verdict, 'verified');
});

test('files and symbols', () => {
  assert.equal(judgeFile('a.ts', { changed: 'modified' }).verdict, 'verified');
  assert.equal(judgeFile('a.ts', { existsAtHead: true }).verdict, 'verified');
  assert.equal(judgeFile('a.ts', { existsAtHead: false }).verdict, 'unproven');
  const files = [{ filename: 'src/a.js', patch: '@@\n function keep() {}\n+export function parseConfig(x) {\n-old()' }];
  assert.equal(judgeSymbol('parseConfig', files).verdict, 'verified');
  assert.match(judgeSymbol('Store.keep', files).evidence, /next to the changes/);
  assert.equal(judgeSymbol('missingFn', files).verdict, 'unproven');
  assert.equal(judgeSymbol('parse', files).verdict, 'unproven', 'must match whole names only');
});

test('dependencies', () => {
  const dep = { ecosystem: 'npm', name: 'expres', file: 'package.json' };
  assert.equal(judgeDependency(dep, { exists: false, nearMiss: 'express' }).verdict, 'contradicted');
  assert.match(judgeDependency(dep, { exists: false, nearMiss: 'express' }).evidence, /Did you mean `express`/);
  assert.equal(judgeDependency(dep, { exists: true, nearMiss: 'express', ageDays: 900 }).verdict, 'warning');
  assert.equal(judgeDependency(dep, { exists: true, nearMiss: null, ageDays: 3 }).verdict, 'warning');
  assert.equal(judgeDependency(dep, { exists: true, nearMiss: null, ageDays: 400, createdAt: '2025-01-01T00:00:00Z' }).verdict, 'verified');
  assert.equal(judgeDependency(dep, { error: 'npm registry answered 503' }).verdict, 'unproven');
  const placeholder = judgeDependency({ ecosystem: 'npm', name: 'react-codeshift', file: 'package.json' }, { exists: true, nearMiss: null, ageDays: 267, placeholder: true, weeklyDownloads: 3 });
  assert.equal(placeholder.verdict, 'warning');
  assert.match(placeholder.evidence, /placeholder/);
  assert.match(placeholder.evidence, /only 3 times last week/);
});

test('fail-on levels', () => {
  const c = summarise([{ verdict: 'unproven' }, { verdict: 'verified' }]);
  assert.equal(shouldFail(c, 'contradicted'), false);
  assert.equal(shouldFail(c, 'unproven'), true);
  assert.equal(shouldFail(summarise([{ verdict: 'contradicted' }]), 'never'), false);
  assert.equal(shouldFail(summarise([{ verdict: 'warning' }]), 'warning'), true);
});

function fakeClient({ body, files = [], checkRounds, issues = {}, paths = [] }) {
  let round = 0;
  return {
    getPull: async () => ({ title: 'T', html_url: 'u', body, head: { sha: 'abcdef1234', repo: { full_name: 'o/r' } }, user: { login: 'bot' } }),
    listPullFiles: async () => files,
    listCheckRuns: async () => checkRounds[Math.min(round++, checkRounds.length - 1)],
    getCombinedStatus: async () => ({ statuses: [] }),
    getIssue: async (_repo, n) => issues[n] ?? null,
    pathExists: async (_repo, p) => paths.includes(p),
  };
}

test('collectReceipts: a slop PR gets caught end to end', async () => {
  const client = fakeClient({
    body: 'Fixes #404. Added `parseConfig()` in `src/config.ts`. All tests pass.',
    files: [
      { filename: 'src/other.ts', status: 'modified', patch: '@@\n+const x = 1;' },
      { filename: 'package.json', status: 'modified', patch: '@@\n   "dependencies": {\n+    "react-codeshift": "^1.0.0",' },
    ],
    checkRounds: [[run('test', 'in_progress', null)], [run('test', 'completed', 'failure')]],
  });
  const slept = [];
  const fetchImpl = async () => ({ status: 404, ok: false });
  const result = await collectReceipts({ client, repo: 'o/r', number: 1, options: { waitMinutes: 5, pollSeconds: 1 }, fetchImpl, sleep: async (ms) => slept.push(ms) });
  const byKind = Object.fromEntries(result.receipts.map((r) => [r.kind, r.verdict]));
  assert.deepEqual(byKind, { tests: 'contradicted', issue: 'contradicted', file: 'unproven', symbol: 'unproven', dependency: 'contradicted' });
  assert.equal(slept.length, 1, 'waited once for the running check');
  assert.equal(result.counts.contradicted, 3);
});

test('collectReceipts: an honest PR is all proven, with short-path matching', async () => {
  const client = fakeClient({
    body: 'Closes #7. Added `parseConfig()` to `config.ts` and documented it in `README.md`. Tests pass.',
    files: [{ filename: 'src/config.ts', status: 'modified', patch: '@@\n+export function parseConfig() {}' }],
    checkRounds: [[run('test', 'completed', 'success')]],
    issues: { 7: { title: 'Config bug', state: 'open' } },
    paths: ['README.md'],
  });
  const result = await collectReceipts({ client, repo: 'o/r', number: 2, options: { waitMinutes: 0 }, fetchImpl: async () => { throw new Error('no network expected'); } });
  assert.equal(result.counts.verified, 5);
  assert.equal(result.receipts.length, 5);
});

test('collectReceipts: gives up waiting after the deadline and reports pending', async () => {
  const client = fakeClient({ body: 'CI is green', checkRounds: [[run('slow', 'queued', null)]] });
  let sleeps = 0;
  const result = await collectReceipts({ client, repo: 'o/r', number: 3, options: { waitMinutes: 1, pollSeconds: 20 }, sleep: async () => { sleeps++; } });
  assert.equal(result.receipts[0].verdict, 'pending');
  assert.equal(sleeps, 3);
});

test('the same job run twice on one commit (push and pull_request) counts once, unless the results differ', () => {
  const passed = (id) => ({ id, name: 'test (20)', status: 'completed', conclusion: 'success' });
  assert.equal(normaliseChecks([passed(1), passed(2)]).length, 1);
  const failed = { id: 3, name: 'test (20)', status: 'completed', conclusion: 'failure', started_at: '2026-10-09T10:00:00Z', completed_at: '2026-10-09T10:05:00Z' };
  assert.deepEqual(normaliseChecks([passed(1), failed]).map((c) => c.state), ['passed', 'failed']);
});

test('another Claim Receipts check (the hosted app, or the Action job) is never test evidence, so they never wait on each other', () => {
  const running = (name) => ({ id: 9, name, status: 'in_progress', conclusion: null });
  for (const name of ['Claim Receipts', 'claim-receipts', 'receipts']) {
    const [c] = normaliseChecks([running(name)]);
    assert.equal(judgeTestClaims(['All tests pass.'], [c])[0].verdict === 'pending', false, name);
  }
});
