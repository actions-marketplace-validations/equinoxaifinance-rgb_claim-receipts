import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, readOptions } from '../src/main.mjs';
import { parseArgs } from '../src/cli-args.mjs';
import { renderMarkdown } from '../src/report.mjs';

test('readOptions: defaults and bad values', () => {
  const o = readOptions({ 'INPUT_FAIL-ON': 'bogus', 'INPUT_WAIT-MINUTES': '-3', INPUT_COMMENT: 'false' });
  assert.equal(o.failOn, 'contradicted');
  assert.equal(o.waitMinutes, 10);
  assert.equal(o.comment, false);
});

test('CLI argument parsing', () => {
  assert.deepEqual(parseArgs(['o/r#12', '--json']).target, { repo: 'o/r', number: 12 });
  assert.deepEqual(parseArgs(['https://github.com/o/r/pull/9/files']).target, { repo: 'o/r', number: 9 });
  assert.equal(parseArgs(['nonsense']).target, null);
  assert.equal(parseArgs(['o/r#1', '--fail-on', 'never']).failOn, 'never');
});

test('report escapes table pipes and lists worst first', () => {
  const md = renderMarkdown({ pr: { sha: 'abcdef123' }, counts: { contradicted: 1, unproven: 0, warning: 0, pending: 0, verified: 1 }, receipts: [
    { kind: 'file', claim: 'a|b', verdict: 'verified', evidence: 'ok' },
    { kind: 'tests', claim: 't', verdict: 'contradicted', evidence: 'bad' },
  ] });
  assert.match(md, /a\\\|b/);
  assert.ok(md.indexOf('Contradicted') < md.indexOf('Proven |'));
  assert.match(md, /^<!-- claim-receipts -->/);
});

test('run(): full action against a fake GitHub API, posts one comment and fails on contradiction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'receipts-'));
  const eventPath = join(dir, 'event.json');
  const out = join(dir, 'out');
  const summary = join(dir, 'summary');
  writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 5 } }));
  writeFileSync(out, '');
  writeFileSync(summary, '');
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url.replace('https://api.github.com', '')}`);
    const ok = (body) => ({ status: 200, ok: true, json: async () => body, text: async () => '' });
    if (url.includes('/pulls/5/files')) return ok([]);
    if (url.endsWith('/pulls/5')) return ok({ title: 'T', html_url: 'u', body: 'Fixes #1', head: { sha: 'abc1234567', repo: { full_name: 'o/r' } } });
    if (url.includes('/issues/1')) return { status: 404, ok: false, text: async () => 'Not Found' };
    if (url.includes('/issues/5/comments') && (init.method || 'GET') === 'GET') return ok([{ id: 77, body: '<!-- claim-receipts --> old' }]);
    if (url.includes('/issues/comments/77')) return ok({});
    throw new Error(`unexpected ${url}`);
  };
  const logs = [];
  const { exitCode } = await run({
    env: { GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, INPUT_GITHUB_TOKEN: 't' },
    fetchImpl,
    log: (m) => logs.push(m),
  });
  assert.equal(exitCode, 1);
  assert.ok(calls.includes('PATCH /repos/o/r/issues/comments/77'), 'updates the existing comment instead of adding a new one');
  assert.match(readFileSync(out, 'utf8'), /contradicted<<EOF_\w+\n1\n/);
  assert.match(readFileSync(summary, 'utf8'), /does not exist/);
  assert.ok(logs.some((l) => l.startsWith('::error::')));
});

test('run(): no pull request in the event is a no-op, not a failure', async () => {
  const logs = [];
  const { exitCode } = await run({ env: { GITHUB_REPOSITORY: 'o/r' }, log: (m) => logs.push(m) });
  assert.equal(exitCode, 0);
  assert.match(logs[0], /nothing to check/);
});
