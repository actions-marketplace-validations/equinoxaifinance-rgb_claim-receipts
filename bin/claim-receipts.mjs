#!/usr/bin/env node
// Check a pull request from your terminal (or from an AI agent before it says "done").
import { createClient } from '../src/github.mjs';
import { collectReceipts, shouldFail } from '../src/evaluate.mjs';
import { renderMarkdown, toJson } from '../src/report.mjs';
import { parseArgs } from '../src/cli-args.mjs';

const USAGE = `Usage: claim-receipts <owner/repo#number | pull request URL> [options]

Options:
  --json                 print machine-readable receipts
  --fail-on <level>      never | contradicted (default) | unproven | warning
  --wait <minutes>       wait for running checks (default 0)
  --test-checks <regex>  only count checks whose name matches
  --help

Set GITHUB_TOKEN for private repositories and higher rate limits.`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.target) {
    console.log(USAGE);
    return opts.help ? 0 : 2;
  }
  const client = createClient({ token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN, apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com' });
  const result = await collectReceipts({
    client,
    repo: opts.target.repo,
    number: opts.target.number,
    options: { waitMinutes: opts.wait, testChecks: opts.testChecks },
    log: (m) => console.error(m),
  });
  console.log(opts.json ? toJson(result) : renderMarkdown(result, { includeMarker: false }));
  return shouldFail(result.counts, opts.failOn) ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }, (err) => {
  console.error(`claim-receipts: ${err.message}`);
  process.exitCode = 2;
});
