// Minimal GitHub REST client. Read-only except for the one comment it keeps up to date.

export const COMMENT_MARKER = '<!-- claim-receipts -->';

export function createClient({ token, apiUrl = 'https://api.github.com', fetchImpl = fetch } = {}) {
  async function request(method, path, body) {
    const res = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'claim-receipts',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  async function json(method, path, body) {
    const res = await request(method, path, body);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`GitHub ${method} ${path} answered ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async function paginate(path, pick = (x) => x, max = 10) {
    const out = [];
    for (let page = 1; page <= max; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const data = await json('GET', `${path}${sep}per_page=100&page=${page}`);
      const items = pick(data);
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  }

  return {
    getPull: (repo, number) => json('GET', `/repos/${repo}/pulls/${number}`),
    listPullFiles: (repo, number) => paginate(`/repos/${repo}/pulls/${number}/files`, (d) => d, 30),
    listCheckRuns: (repo, sha) => paginate(`/repos/${repo}/commits/${sha}/check-runs`, (d) => d.check_runs ?? []),
    getCombinedStatus: (repo, sha) => json('GET', `/repos/${repo}/commits/${sha}/status`),
    async getIssue(repo, number) {
      try {
        return await json('GET', `/repos/${repo}/issues/${number}`);
      } catch (err) {
        if (err.status === 404 || err.status === 410) return null;
        throw err;
      }
    },
    /** Every path in the repository at a commit. Returns { paths: Set, truncated }. */
    async listTree(repo, sha) {
      const data = await json('GET', `/repos/${repo}/git/trees/${sha}?recursive=1`);
      return { paths: new Set((data.tree ?? []).filter((t) => t.type === 'blob').map((t) => t.path)), truncated: Boolean(data.truncated) };
    },
    /** Raw text of a file at a commit, or null when it doesn't exist. */
    async getText(repo, path, ref) {
      const res = await fetchImpl(`${apiUrl}/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, {
        headers: { accept: 'application/vnd.github.raw', 'x-github-api-version': '2022-11-28', 'user-agent': 'claim-receipts', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.text();
    },
    async pathExists(repo, path, ref) {
      const res = await request('GET', `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
      if (res.status === 404) return false;
      if (res.ok) return true;
      const err = new Error(`GitHub contents lookup for ${path} answered ${res.status}`);
      err.status = res.status;
      throw err;
    },
    /** The job id of the runner we are on, so the action can skip its own check run. */
    async findOwnJobId(repo, runId, attempt, runnerName) {
      if (!runId || !runnerName) return null;
      try {
        const jobs = await paginate(`/repos/${repo}/actions/runs/${runId}/attempts/${attempt || 1}/jobs`, (d) => d.jobs ?? []);
        const mine = jobs.filter((j) => j.runner_name === runnerName && j.status !== 'completed');
        return mine.length === 1 ? mine[0].id : null;
      } catch {
        return null;
      }
    },
    /** Updates our earlier comment, or posts one. With createIfMissing false, only an existing comment is updated. */
    async upsertComment(repo, number, body, { createIfMissing = true } = {}) {
      const comments = await paginate(`/repos/${repo}/issues/${number}/comments`);
      const mine = comments.find((c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER));
      if (mine) return json('PATCH', `/repos/${repo}/issues/comments/${mine.id}`, { body });
      if (!createIfMissing) return null;
      return json('POST', `/repos/${repo}/issues/${number}/comments`, { body });
    },
  };
}
