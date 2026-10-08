// Finds dependencies a pull request adds, from the diff alone.

const PACKAGE_JSON_FIELDS = new Set([
  'name', 'version', 'description', 'main', 'module', 'types', 'typings', 'type', 'license', 'author',
  'homepage', 'private', 'packageManager', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'engines', 'browser',
]);

const NPM_DEP_BLOCKS = /"(dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:/;

function isNpmVersionSpec(v) {
  if (/^(?:workspace|file|link|portal|patch|git|git\+\w+|https?|github):/i.test(v)) return false;
  if (v.includes('/') && !v.startsWith('npm:')) return false; // github shorthand user/repo
  return /^(?:[\^~<>=*]|\d|x\b|latest$|next$|beta$|npm:)/i.test(v.trim());
}

/**
 * Track which dependency block each added line sits in, using the hunk's context lines.
 * Falls back to "looks like name: version" when the block header is outside the hunk.
 */
export function npmAdditions(patch) {
  const out = [];
  if (!patch) return out;
  let inDeps = null; // null = unknown, true/false = known from context
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) { inDeps = null; continue; }
    const line = raw.slice(1);
    if (NPM_DEP_BLOCKS.test(line)) { inDeps = true; continue; }
    if (/^\s*"[\w-]+"\s*:\s*[{[]/.test(line)) { inDeps = false; continue; }
    if (/^\s*}/.test(line) && inDeps) { inDeps = false; continue; }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    const m = line.match(/^\s*"((?:@[\w.-]+\/)?[\w.-]+)"\s*:\s*"([^"]*)"/);
    if (!m) continue;
    const [, name, spec] = m;
    if (inDeps === false) continue;
    if (PACKAGE_JSON_FIELDS.has(name)) continue;
    if (!isNpmVersionSpec(spec)) continue;
    const alias = spec.match(/^npm:((?:@[\w.-]+\/)?[\w.-]+)/);
    out.push({ ecosystem: 'npm', name: (alias ? alias[1] : name).toLowerCase(), spec });
  }
  return out;
}

const PEP508_NAME = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(?:\[[^\]]*\])?\s*(?:[<>=!~;@ ]|$)/;

export function requirementsAdditions(patch) {
  const out = [];
  if (!patch) return out;
  for (const raw of patch.split('\n')) {
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    const line = raw.slice(1).replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('-') || /:\/\//.test(line)) continue;
    const m = line.match(PEP508_NAME);
    if (m) out.push({ ecosystem: 'pypi', name: pypiNormalise(m[1]), spec: line });
  }
  return out;
}

export function pyprojectAdditions(patch) {
  const out = [];
  if (!patch) return out;
  let section = '';
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) { section = ''; continue; }
    const line = raw.slice(1);
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) { section = header[1]; continue; }
    if (/^\s*(?:dependencies|optional-dependencies|dev-dependencies|requires)\s*=\s*\[/.test(line) && !section) section = 'project';
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    // PEP 621 list entries: "requests>=2",
    const listEntry = line.match(/^\s*["']([^"']+)["']\s*,?\s*$/);
    if (listEntry) {
      const m = listEntry[1].trim().match(PEP508_NAME);
      if (m) out.push({ ecosystem: 'pypi', name: pypiNormalise(m[1]), spec: listEntry[1].trim() });
      continue;
    }
    // Poetry tables: requests = "^2.31"
    if (/dependencies/.test(section)) {
      const kv = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(["{])/);
      if (kv && kv[1].toLowerCase() !== 'python') out.push({ ecosystem: 'pypi', name: pypiNormalise(kv[1]), spec: line.trim() });
    }
  }
  return out;
}

export function pypiNormalise(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** files: GitHub "list pull request files" entries ({ filename, status, patch }). */
export function findAddedDependencies(files) {
  const all = [];
  for (const f of files) {
    const base = f.filename.split('/').pop();
    if (f.filename.split('/').includes('node_modules')) continue;
    if (base === 'package.json') all.push(...npmAdditions(f.patch).map((d) => ({ ...d, file: f.filename })));
    else if (/^requirements[\w.-]*\.(?:txt|in)$/.test(base)) all.push(...requirementsAdditions(f.patch).map((d) => ({ ...d, file: f.filename })));
    else if (base === 'pyproject.toml') all.push(...pyprojectAdditions(f.patch).map((d) => ({ ...d, file: f.filename })));
  }
  const seen = new Set();
  return all.filter((d) => {
    const k = `${d.ecosystem}:${d.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
