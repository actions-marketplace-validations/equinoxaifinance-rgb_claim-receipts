// GitHub Action entry point. No dependencies: reads inputs from the environment GitHub sets.
import { appendFileSync, readFileSync } from 'node:fs';
import { createClient } from './github.mjs';
import { collectReceipts, shouldFail } from './evaluate.mjs';
import { renderMarkdown, toJson, headline } from './report.mjs';

export function input(name, fallback = '', env = process.env) {
  const v = env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

export function readOptions(env = process.env) {
  const bool = (n, d) => /^(true|yes|1|on)$/i.test(input(n, String(d), env));
  const num = (n, d) => {
    const v = Number(input(n, String(d), env));
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  const failOn = input('fail-on', 'contradicted', env).toLowerCase();
  return {
    token: input('github-token', env.GITHUB_TOKEN || '', env),
    comment: bool('comment', true),
    failOn: ['never', 'contradicted', 'unproven', 'warning'].includes(failOn) ? failOn : 'contradicted',
    waitMinutes: num('wait-minutes', 10),
    pollSeconds: num('poll-seconds', 20),
    ignoreChecks: input('ignore-checks', '', env).split(',').map((s) => s.trim()).filter(Boolean),
    testChecks: input('test-checks', '', env) || undefined,
    minPackageAgeDays: num('min-package-age-days', 30),
    checkFiles: bool('check-files', true),
    checkDependencies: bool('check-dependencies', true),
  };
}

function setOutput(name, value, env = process.env) {
  if (!env.GITHUB_OUTPUT) return;
  const delim = `EOF_${Math.random().toString(36).slice(2)}`;
  appendFileSync(env.GITHUB_OUTPUT, `${name}<<${delim}\n${value}\n${delim}\n`);
}

export async function run({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const options = readOptions(env);
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const repo = env.GITHUB_REPOSITORY;
  const number = Number(input('pr-number', '', env)) || event.pull_request?.number || event.issue?.number;
  if (!repo || !number) {
    log('::warning::Claim Receipts runs on pull requests. No pull request number found, so there is nothing to check.');
    return { exitCode: 0 };
  }
  const client = createClient({ token: options.token, apiUrl: env.GITHUB_API_URL || 'https://api.github.com', fetchImpl });
  const selfJobId = await client.findOwnJobId(repo, env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT, env.RUNNER_NAME);
  const result = await collectReceipts({ client, repo, number, selfJobId, selfJobName: env.GITHUB_JOB, options, fetchImpl, log });
  const markdown = renderMarkdown(result);

  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${renderMarkdown(result, { includeMarker: false })}\n`);
  if (options.comment) {
    try {
      await client.upsertComment(repo, number, markdown);
    } catch (err) {
      // Pull requests from forks get a read-only token; the job summary still has the receipts.
      log(`::warning::Could not post the receipts comment (${err.status ?? err.message}). See the job summary instead. Pull requests from forks get a read-only token unless the workflow uses pull_request_target.`);
    }
  }
  setOutput('contradicted', String(result.counts.contradicted), env);
  setOutput('unproven', String(result.counts.unproven), env);
  setOutput('verified', String(result.counts.verified), env);
  setOutput('report-json', toJson(result), env);

  const fail = shouldFail(result.counts, options.failOn);
  log(headline(result.counts));
  for (const r of result.receipts) log(`- [${r.verdict}] ${r.claim}: ${r.evidence}`);
  if (fail) log(`::error::Claim Receipts: ${headline(result.counts)} (fail-on: ${options.failOn}).`);
  return { exitCode: fail ? 1 : 0, result };
}
