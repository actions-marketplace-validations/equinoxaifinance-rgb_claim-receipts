// Pulls checkable claims out of a pull request description.
// Everything here is deterministic text parsing: no model calls.

const CODE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts',
  'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'scala', 'sh', 'bash', 'ps1', 'sql', 'json',
  'yaml', 'yml', 'toml', 'md', 'mdx', 'html', 'css', 'scss', 'vue', 'svelte', 'lua', 'ex', 'exs',
  'erl', 'dart', 'r', 'jl', 'zig', 'tf', 'proto', 'graphql', 'gql', 'xml', 'ini', 'cfg', 'txt', 'lock',
]);

// Sentences that say tests, builds or checks pass. Each pattern must match a positive claim.
const PASS = String.raw`(?:pass(?:es|ed|ing)?|(?:are|is|all|were|was)\s+(?:passing|green)|green|succeed(?:s|ed)?|clean(?:ly)?|ok)`;
const TEST_CLAIM_PATTERNS = [
  // "all tests pass", "unit tests continue to pass", "the 34 tests passed"
  new RegExp(String.raw`\b(?:all\s+)?(?:the\s+)?(?:\d[\d,]*\s+)?(?:[\w/-]+\s+){0,4}?(?:tests?|specs?|test\s+suites?)\s+(?:now\s+|still\s+|continue\s+to\s+|all\s+)?${PASS}\b`, 'i'),
  // "CI is green", "build passes", "checks pass", "lint clean"
  new RegExp(String.raw`\b(?:ci|build|checks?|pipeline|test\s+suite|lint(?:ing)?|typecheck(?:ing)?|type\s+check)\s+(?:is\s+|are\s+|now\s+|also\s+)*${PASS}\b`, 'i'),
  // "Tests: 52 passed", "16/16 passed", "1153 passed tests", "ok=294 fail=0"
  /\btests?\s*:\s*\d[\d,]*\s+pass(?:ed|ing)?\b/i,
  /\b(\d+)\s*\/\s*\1\s+(?:tests?\s+)?pass(?:ed|ing)?\b/i,
  /\b\d[\d,]*\s+(?:tests?\s+)?passed(?:\s+tests?)?\b/i,
  // a command in backticks followed by "passes" / "→ all pass" / ": passes"
  new RegExp(String.raw`\`[^\`\n]*(?:test|spec|lint|tsc|build|check|validate|pytest|jest|vitest|mocha|cargo|go\s|gradle|mvn|npm|pnpm|yarn|bun|make|ruff|eslint|biome|unittest)[^\`\n]*\`[^.\n\`]{0,40}?\b${PASS}\b`, 'i'),
  /\b(?:pytest|cargo\s+test|go\s+test|jest|vitest|mocha|rspec|phpunit|mvn\s+test|gradle\s+test|unittest)\b[^.\n]{0,40}\b(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?|ok)\b/i,
  /\bverified\s+(?:that\s+)?(?:all\s+)?tests?\s+pass/i,
];

// "0 failures", "fail=0", "fails before the fix" describe passing runs, so they don't negate a claim.
const ZERO_FAIL = /\b0\s+fail(?:ures?|ed|s)?\b|\bfail(?:ures?)?\s*[=:]\s*0\b|\bno\s+fail(?:ures?|s)\b|\bfails?\s+(?:before|without)\s+the\s+(?:fix|change)\b/gi;
const NEGATION = /(?:\b(?:not|never|fail(?:s|ed|ing|ures?)?|broken|todo|tbd|yet to|still need|will|should|hopefully|could|would|if)\b|n't\b)/i;

const ISSUE_LINK = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+((?:[\w.-]+\/[\w.-]+)?#(\d+))/gi;

/** Remove parts of a description that are not the author's own claims. */
export function stripNonClaims(body) {
  if (!body) return '';
  return body
    .replace(/<!--[\s\S]*?-->/g, '') // template comments
    .replace(/```[\s\S]*?```/g, '') // fenced code / pasted logs
    .replace(/~~~[\s\S]*?~~~/g, '')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line)) // quoted text
    .filter((line) => !/^\s*[-*]\s+\[\s\]/.test(line)) // unticked checklist items
    .join('\n');
}

function sentences(text) {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[xX]\]\s+)?/, '').trim())
    .filter(Boolean);
}

export function findTestClaims(body) {
  const out = [];
  for (const s of sentences(stripNonClaims(body))) {
    if (!TEST_CLAIM_PATTERNS.some((re) => re.test(s))) continue;
    if (NEGATION.test(s.replace(ZERO_FAIL, ''))) continue;
    out.push(s.length > 160 ? `${s.slice(0, 157)}...` : s);
  }
  return [...new Set(out)];
}

export function findIssueLinks(body, thisRepo) {
  const text = stripNonClaims(body);
  const seen = new Map();
  for (const m of text.matchAll(ISSUE_LINK)) {
    const ref = m[1];
    const number = Number(m[2]);
    const repo = ref.includes('/') ? ref.split('#')[0] : thisRepo;
    const key = `${repo.toLowerCase()}#${number}`;
    if (!seen.has(key)) seen.set(key, { repo, number, text: m[0].trim() });
  }
  return [...seen.values()];
}

function looksLikePath(token) {
  if (!token || token.length > 200) return false;
  if (/^[a-z]+:\/\//i.test(token) || token.startsWith('www.')) return false;
  if (/\s/.test(token)) return false;
  if (/^[@~]/.test(token)) return false; // package scopes, home dirs
  if (/[*?<>|"'`(){}$]/.test(token)) return false; // globs, code
  const clean = token.replace(/^\.\//, '').replace(/[:#]L?\d+(?:-L?\d+)?$/, '');
  const last = clean.split('/').pop();
  if (!/^[\w.]/.test(last) || /^\.+$/.test(last)) return false;
  const dot = last.lastIndexOf('.');
  if (dot > 0) {
    const ext = last.slice(dot + 1).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) return false;
    // version numbers such as 1.2.3 or v2.0
    if (/^v?\d+(?:\.\d+)+$/.test(last)) return false;
    return true;
  }
  // Directories and extension-less names are too ambiguous (branch prefixes, commands, words).
  return false;
}

export function normalisePath(token) {
  return token.replace(/^\.\//, '').replace(/[:#]L?\d+(?:-L?\d+)?$/, '').replace(/\/$/, '');
}

export function findFileMentions(body) {
  const text = stripNonClaims(body);
  const found = new Set();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    if (looksLikePath(m[1].trim())) found.add(normalisePath(m[1].trim()));
  }
  // bare paths need a slash and a known extension to count
  for (const m of text.replace(/`[^`\n]*`/g, ' ').replace(/\]\([^)]*\)/g, ']').matchAll(/(?:^|[\s(])((?:\.\/)?[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]+)(?=$|[\s),;:!?]|\.(?:\s|$))/gm)) {
    if (looksLikePath(m[1])) found.add(normalisePath(m[1]));
  }
  return [...found];
}

export function findSymbolMentions(body) {
  const text = stripNonClaims(body);
  const found = new Set();
  for (const m of text.matchAll(/`((?:[A-Za-z_$][\w$]*(?:\.|::|#))*[A-Za-z_$][\w$]*)\(\)`/g)) {
    found.add(m[1]);
  }
  return [...found];
}

export function extractClaims(body, thisRepo) {
  return {
    tests: findTestClaims(body),
    issues: findIssueLinks(body, thisRepo),
    files: findFileMentions(body),
    symbols: findSymbolMentions(body),
  };
}

/** Minimal .gitignore matcher: enough to recognise local and generated files people mention. */
export function gitignoreMatcher(text) {
  const rules = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    let pat = line.replace(/\/$/, '');
    const dirOnly = line.endsWith('/');
    const anchored = pat.startsWith('/') || pat.slice(0, -1).includes('/');
    pat = pat.replace(/^\//, '');
    const body = pat.split('**').map((part) => part.split('*').map((seg) => seg.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('[^/]*')).join('.*');
    const re = anchored ? new RegExp(`^${body}(?:/.*)?$`) : new RegExp(`(?:^|/)${body}${dirOnly ? '/.*' : '(?:/.*)?'}$`);
    rules.push(re);
  }
  return (path) => rules.some((re) => re.test(path));
}
