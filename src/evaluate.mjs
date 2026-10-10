// Turns claims plus evidence into receipts. The verdict functions are pure; collectReceipts does the I/O.
import { extractClaims, gitignoreMatcher } from './claims.mjs';
import { findAddedDependencies } from './deps.mjs';
import { lookupPackage } from './registry.mjs';

export const VERDICT = {
  VERIFIED: 'verified',
  CONTRADICTED: 'contradicted',
  UNPROVEN: 'unproven',
  PENDING: 'pending',
  WARNING: 'warning',
};

const BAD_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);

const NOT_STARTED = /not started|spending limit|account payments|billing|no runner|runner .*unavailable|startup failure/i;

/** A job that "failed" without running (billing, no runner) is not evidence about the tests. */
export function neverStarted(run) {
  if (run.conclusion === 'startup_failure') return true;
  if (NOT_STARTED.test(`${run.output?.title ?? ''} ${run.output?.summary ?? ''}`)) return true;
  // Real test jobs need more than a few seconds just to set up; a "failure" this fast means the job never ran.
  if (run.started_at && run.completed_at) return Date.parse(run.completed_at) - Date.parse(run.started_at) <= 10_000;
  return false;
}

// Checks that are about process, deploys, security scanning or AI review, not about whether the tests pass.
// They never count as test evidence either way (and are never waited on).
const NOT_TEST_EVIDENCE = /claim[- ]?receipts|^receipts$|label|auto-?merge|codecov|coverage upload|deploy|preview|vercel|netlify|cloudflare pages|\bcla\b|\bdco\b|semantic|pr title|title check|stale|triage|disposition|review|security agent|dependabot|greet|welcome|size-label|changeset|release-please|analy[sz]e|codeql|quiz|sonarcloud|snyk|socket security|gitguardian|license\/cla|conventional commit|assign|project board/i;

export function isTestEvidence(check) {
  return !NOT_TEST_EVIDENCE.test(String(check.name));
}

/** Normalise check runs and legacy commit statuses into one list. */
export function normaliseChecks(checkRuns = [], statuses = [], { selfJobId, selfJobName, ignore = [], include } = {}) {
  const ignoreSet = new Set(ignore.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const list = [];
  for (const run of checkRuns) {
    // Skip this job's own check run. Other jobs in the same workflow run still count as evidence.
    if (selfJobId && String(run.id) === String(selfJobId)) continue;
    if (!selfJobId && selfJobName && run.name === selfJobName && run.status !== 'completed') continue;
    let state = run.status !== 'completed' ? 'pending' : BAD_CONCLUSIONS.has(run.conclusion) ? 'failed' : run.conclusion === 'success' ? 'passed' : 'neutral';
    if (state === 'failed' && neverStarted(run)) state = 'not-run';
    list.push({
      name: run.name,
      url: run.html_url || run.details_url || null,
      state,
      detail: run.status !== 'completed' ? run.status : run.conclusion,
    });
  }
  for (const s of statuses) {
    list.push({
      name: s.context,
      url: s.target_url || null,
      state: s.state === 'pending' ? 'pending' : s.state === 'success' ? 'passed' : 'failed',
      detail: s.state,
    });
  }
  // The same job often runs twice on one commit (on push and on pull_request). Count identical results once;
  // differing results (one failed, one passed) both stay, so a failure is never hidden.
  const seen = new Set();
  return list.filter((c) => {
    if (ignoreSet.has(String(c.name).toLowerCase()) || (include && !include.test(c.name))) return false;
    const key = `${c.name}\u0000${c.state}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function judgeTestClaims(claims, allChecks) {
  if (!claims.length) return [];
  const quote = claims.map((c) => `“${c}”`).join(' / ');
  const notRun = allChecks.filter((c) => c.state === 'not-run');
  const ran = allChecks.filter((c) => c.state !== 'not-run');
  const relevant = ran.filter(isTestEvidence);
  const other = ran.filter((c) => !isTestEvidence(c));
  const failed = relevant.filter((c) => c.state === 'failed');
  const pending = relevant.filter((c) => c.state === 'pending');
  const passed = relevant.filter((c) => c.state === 'passed');
  const otherFailed = other.filter((c) => c.state === 'failed');
  const notes = [];
  if (notRun.length) notes.push(`${notRun.length} check${notRun.length === 1 ? '' : 's'} ended within seconds and probably never ran (often a billing or runner problem): ${notRun.slice(0, 4).map(linkCheck).join(', ')}.`);
  if (otherFailed.length) notes.push(`Not counted as test evidence: ${otherFailed.slice(0, 4).map(linkCheck).join(', ')} failed.`);
  let verdict;
  let evidence;
  if (failed.length) {
    verdict = VERDICT.CONTRADICTED;
    evidence = `${failed.length} of ${relevant.length} test and build checks failed: ${failed.slice(0, 6).map(linkCheck).join(', ')}.`;
  } else if (pending.length) {
    verdict = VERDICT.PENDING;
    evidence = `${pending.length} of ${relevant.length} test and build checks are still running: ${pending.slice(0, 6).map(linkCheck).join(', ')}.`;
  } else if (passed.length) {
    verdict = VERDICT.VERIFIED;
    evidence = `${passed.length} of ${relevant.length} test and build checks passed${relevant.length > passed.length ? ' (the rest were skipped or neutral)' : ''}: ${passed.slice(0, 6).map(linkCheck).join(', ')}${passed.length > 6 ? ', …' : ''}.`;
  } else if (relevant.length) {
    verdict = VERDICT.UNPROVEN;
    evidence = 'Every test and build check on this commit was skipped or neutral, so none shows the tests passing.';
  } else {
    verdict = VERDICT.UNPROVEN;
    evidence = 'No test or build checks ran on this commit, so nothing shows the tests passing.';
  }
  if (notes.length) evidence += ` ${notes.join(' ')}`;
  return [{ kind: 'tests', claim: quote, verdict, evidence }];
}

function linkCheck(c) {
  return c.url ? `[${c.name}](${c.url})` : `\`${c.name}\``;
}

export function judgeIssue(link, issue, thisRepo) {
  const ref = link.repo.toLowerCase() === thisRepo.toLowerCase() ? `#${link.number}` : `${link.repo}#${link.number}`;
  const claim = `“${link.text}”`;
  if (!issue) {
    const sameRepo = link.repo.toLowerCase() === thisRepo.toLowerCase();
    return {
      kind: 'issue', claim,
      verdict: sameRepo ? VERDICT.CONTRADICTED : VERDICT.UNPROVEN,
      evidence: sameRepo ? `${ref} does not exist in this repository.` : `${ref} could not be found (it may be private).`,
    };
  }
  if (issue.pull_request) {
    return { kind: 'issue', claim, verdict: VERDICT.WARNING, evidence: `${ref} is a pull request, not an issue: “${issue.title}”.` };
  }
  return { kind: 'issue', claim, verdict: VERDICT.VERIFIED, evidence: `${ref} exists (${issue.state}): “${issue.title}”.` };
}

export function judgeFile(path, { changed, existsAtHead, foundAt }) {
  const claim = `mentions \`${path}\``;
  if (changed) return { kind: 'file', claim, verdict: VERDICT.VERIFIED, evidence: `Changed in this pull request (${changed}).` };
  if (existsAtHead === true) return { kind: 'file', claim, verdict: VERDICT.VERIFIED, evidence: `Exists in the repository${foundAt ? ` as \`${foundAt}\`` : ''} (not changed by this pull request).` };
  if (existsAtHead === false) return { kind: 'file', claim, verdict: VERDICT.UNPROVEN, evidence: 'Not found in this pull request or in the repository at this commit.' };
  return { kind: 'file', claim, verdict: VERDICT.UNPROVEN, evidence: 'Could not check whether this file exists.' };
}

export function judgeSymbol(symbol, files) {
  const name = symbol.split(/\.|::|#/).pop();
  const re = new RegExp(`(^|[^\\w$])${name.replace(/[$]/g, '\\$')}($|[^\\w$])`);
  let added = null;
  let context = null;
  for (const f of files) {
    for (const line of (f.patch || '').split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (!re.test(line.slice(1))) continue;
      if (line.startsWith('+')) added ??= f.filename;
      else context ??= f.filename;
    }
  }
  const claim = `mentions \`${symbol}()\``;
  if (added) return { kind: 'symbol', claim, verdict: VERDICT.VERIFIED, evidence: `Added or changed in \`${added}\`.` };
  if (context) return { kind: 'symbol', claim, verdict: VERDICT.VERIFIED, evidence: `Appears next to the changes in \`${context}\`.` };
  return { kind: 'symbol', claim, verdict: VERDICT.UNPROVEN, evidence: 'Not found anywhere in this pull request’s changes (it may exist elsewhere in the code).' };
}

export function judgeDependency(dep, info, { minAgeDays = 30, minWeeklyDownloads = 50 } = {}) {
  const where = dep.ecosystem === 'npm' ? 'npm' : 'PyPI';
  const claim = `adds \`${dep.name}\` (${where}) in \`${dep.file}\``;
  if (info.error) return { kind: 'dependency', claim, verdict: VERDICT.UNPROVEN, evidence: `Could not check: ${info.error}.` };
  if (info.exists === false) {
    return {
      kind: 'dependency', claim, verdict: VERDICT.CONTRADICTED,
      evidence: `No package with this name exists on ${where}. AI tools often invent package names, and attackers register them (“slopsquatting”).${info.nearMiss ? ` Did you mean \`${info.nearMiss}\`?` : ''}`,
    };
  }
  const notes = [];
  if (info.placeholder) notes.push('its registry page says it is a placeholder with no real code');
  if (info.weeklyDownloads !== null && info.weeklyDownloads !== undefined && info.weeklyDownloads < minWeeklyDownloads) notes.push(`it was downloaded only ${info.weeklyDownloads} time${info.weeklyDownloads === 1 ? '' : 's'} last week`);
  if (info.nearMiss) notes.push(`its name is one or two letters away from the popular \`${info.nearMiss}\``);
  if (info.ageDays !== null && info.ageDays < minAgeDays) notes.push(`it was first published ${info.ageDays} day${info.ageDays === 1 ? '' : 's'} ago`);
  if (notes.length) return { kind: 'dependency', claim, verdict: VERDICT.WARNING, evidence: `Exists, but ${notes.join(' and ')}. Check it is the package you meant.` };
  return { kind: 'dependency', claim, verdict: VERDICT.VERIFIED, evidence: `Exists on ${where}${info.createdAt ? `, first published ${info.createdAt.slice(0, 10)}` : ''}.` };
}

export function summarise(receipts) {
  const counts = Object.fromEntries(Object.values(VERDICT).map((v) => [v, 0]));
  for (const r of receipts) counts[r.verdict]++;
  return counts;
}

export function shouldFail(counts, failOn) {
  if (failOn === 'never') return false;
  if (failOn === 'unproven') return counts.contradicted + counts.unproven > 0;
  if (failOn === 'warning') return counts.contradicted + counts.unproven + counts.warning > 0;
  return counts.contradicted > 0;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function collectReceipts({
  client, repo, number, selfJobId, selfJobName, options = {}, fetchImpl = fetch, sleep = defaultSleep, log = () => {}, now = Date.now(),
}) {
  const {
    waitMinutes = 10, pollSeconds = 20, ignoreChecks = [], testChecks, minPackageAgeDays = 30,
    checkFiles = true, checkDependencies = true, maxFiles = 25,
  } = options;
  const pr = await client.getPull(repo, number);
  const headRepo = pr.head?.repo?.full_name || repo;
  const sha = pr.head.sha;
  const claims = extractClaims(pr.body || '', repo);
  const files = await client.listPullFiles(repo, number);
  const receipts = [];

  // 1. Test / CI claims
  if (claims.tests.length) {
    const include = testChecks ? new RegExp(testChecks, 'i') : undefined;
    const deadline = now + waitMinutes * 60_000;
    let elapsed = 0;
    let checks;
    for (;;) {
      const [runs, combined] = await Promise.all([client.listCheckRuns(repo, sha), client.getCombinedStatus(repo, sha)]);
      checks = normaliseChecks(runs, combined?.statuses ?? [], { selfJobId, selfJobName, ignore: ignoreChecks, include });
      const waiting = checks.filter((c) => c.state === 'pending' && isTestEvidence(c));
      if (!waiting.length || now + elapsed >= deadline) break;
      log(`Waiting for ${waiting.length} check(s) to finish: ${waiting.map((c) => c.name).join(', ')}`);
      await sleep(pollSeconds * 1000);
      elapsed += pollSeconds * 1000;
    }
    receipts.push(...judgeTestClaims(claims.tests, checks));
  }

  // 2. Linked issues
  for (const link of claims.issues) {
    receipts.push(judgeIssue(link, await client.getIssue(link.repo, link.number), repo));
  }

  // 3. Files mentioned
  if (checkFiles) {
    const changed = new Map();
    for (const f of files) {
      changed.set(f.filename, f.status);
      if (f.previous_filename) changed.set(f.previous_filename, `renamed to \`${f.filename}\``);
    }
    let tree;
    const findInTree = async (path) => {
      if (tree === undefined) {
        try { tree = await client.listTree(headRepo, sha); } catch { tree = null; }
      }
      if (tree) {
        if (tree.paths.has(path)) return path;
        for (const p of tree.paths) if (p.endsWith(`/${path}`)) return p;
        if (!tree.truncated) return false;
      }
      try { return (await client.pathExists(headRepo, path, sha)) ? path : false; } catch { return null; }
    };
    let ignored;
    const isIgnored = async (path) => {
      if (path.split('/').includes('node_modules')) return true;
      if (ignored === undefined) {
        const text = client.getText ? await client.getText(headRepo, '.gitignore', sha).catch(() => null) : null;
        ignored = gitignoreMatcher(text);
      }
      return ignored(path);
    };
    for (const path of claims.files.slice(0, maxFiles)) {
      // Authors often write a short path (`utils.ts`) for a longer one (`src/lib/utils.ts`).
      const suffixKey = changed.has(path) ? null : [...changed.keys()].find((k) => k.endsWith(`/${path}`));
      const changedStatus = changed.get(path) ?? (suffixKey ? changed.get(suffixKey) : null);
      let existsAtHead = null;
      let foundAt = null;
      if (!changedStatus) {
        const hit = await findInTree(path);
        existsAtHead = hit === null ? null : Boolean(hit);
        foundAt = hit && hit !== path ? hit : null;
        // Local secrets, build output and the like are never committed, so "not found" says nothing.
        if (hit === false && (await isIgnored(path))) continue;
      }
      receipts.push(judgeFile(path, { changed: changedStatus, existsAtHead, foundAt }));
    }
    for (const symbol of claims.symbols.slice(0, maxFiles)) receipts.push(judgeSymbol(symbol, files));
  }

  // 4. Dependencies the diff adds
  if (checkDependencies) {
    for (const dep of findAddedDependencies(files)) {
      const info = await lookupPackage(dep, { fetchImpl, now });
      receipts.push(judgeDependency(dep, info, { minAgeDays: minPackageAgeDays }));
    }
  }

  return { pr: { number, title: pr.title, url: pr.html_url, sha, author: pr.user?.login }, claims, receipts, counts: summarise(receipts) };
}
