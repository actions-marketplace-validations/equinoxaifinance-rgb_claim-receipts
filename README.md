# Claim Receipts

**No proof, no done.** Claim Receipts checks what a pull request *says* against what actually happened.

AI coding agents write confident pull request descriptions: "All tests pass. Fixes #212. Added `parseConfig()` in `src/config.ts`." Sometimes every word is true. Sometimes the tests never ran, issue #212 doesn't exist, the function isn't in the diff, and the new dependency is a package name the model made up.

Claim Receipts reads the description, finds the claims it can check, and posts one comment with a receipt for each:

| | Claim | Evidence |
|---|---|---|
| ❌ Contradicted | “All tests pass.” | 1 of 3 checks failed: [e2e](#). |
| ❌ Contradicted | “Fixes #999” | #999 does not exist in this repository. |
| ❌ Contradicted | adds `huggingface-cli` (PyPI) | No package with this name exists on PyPI. AI tools often invent package names, and attackers register them (“slopsquatting”). |
| 🟡 Check this | adds `react-codeshift` (npm) | Exists, but its registry page says it is a placeholder with no real code. |
| 🟡 Check this | adds `expresss` (npm) | Exists, but its name is one or two letters away from the popular `express`. |
| ⚠️ No proof | mentions `parseConfig()` | Not found anywhere in this pull request’s changes. |
| ✅ Proven | mentions `src/parser.ts` | Changed in this pull request (modified). |

Every verdict comes from GitHub and the package registries. **No AI model decides anything**, so the same pull request always gets the same receipts.

## Why

- Maintainers are drowning in low-quality AI pull requests. GitHub's own product team has called it "a critical issue affecting the open source community" ([Feb 2026](https://www.opensourceforu.com/2026/02/github-weighs-pull-request-kill-switch-as-ai-slop-floods-open-source/)).
- In a USENIX Security 2025 study, 19.7% of 2.23 million AI code samples named at least one package that does not exist ([summary](https://labs.cloudsecurityalliance.org/research/csa-research-note-slopsquatting-ai-supply-chain-20260419-csa/)). Attackers register those names.
- Other tools guess whether a pull request *looks* AI-written. Claim Receipts doesn't care who wrote it. It checks whether what it says is true.

## Tested on real AI pull requests

Before release, Claim Receipts was run read-only on 174 recent public pull requests opened by seven AI coding agents (GitHub Copilot's coding agent, Devin, Claude, Codex, Jules, Cursor and Claude Code), at most two per repository.

- 128 of them (74%) made claims it could check, for 539 receipts.
- 47 said tests passed. CI proved 30 of those. **12 had no CI evidence at all**: no test or build job ran on that commit. 3 were contradicted by failing CI.
- In one, the agent wrote that all `devCheck` tasks pass; on GitHub, `devCheck` and four other jobs had failed.
- Every red verdict was checked by hand. False alarms found in the first round (billing-blocked CI, label bots, short file names) were fixed before release, and the results were confirmed on pull requests from repositories the fixes were never tuned on.

## Two ways to run it

- **This GitHub Action** (free, open source): add one workflow file to each repository. Instructions below.
- **The hosted GitHub App** ([install](https://github.com/apps/claim-receipts)): install once for a whole organisation, with no workflow files and no Actions minutes. It adds a "Claim Receipts" check to every pull request, and a **proof-rate scorecard** per author and per AI agent: how many of their claims came with proof over the last 90 days. It is free on public repositories. Private repositories cost $49 per organisation per month after a 14-day free trial.

Both use the same checks.

## Set up (2 minutes)

Add `.github/workflows/claim-receipts.yml`:

```yaml
name: Claim Receipts
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
permissions:
  contents: read
  checks: read
  statuses: read
  issues: read
  actions: read
  pull-requests: write
jobs:
  receipts:
    runs-on: ubuntu-latest
    steps:
      - uses: equinoxaifinance-rgb/claim-receipts@v0
```

That's it. No account, no API key, no data leaves GitHub except package-name lookups on the public npm and PyPI registries.

## What it checks

| Claim in the description | How it is checked |
|---|---|
| "tests pass", "CI is green", "npm test passes", "pytest: 42 passed", ticked `[x] Tests pass` | Waits for the other checks on the commit (up to `wait-minutes`), then reads their results. Its own job never counts as evidence. |
| "fixes #12", "closes org/repo#7", "resolves #3" | Looks the issue up. Flags missing issues, and links that point at a pull request instead of an issue. |
| File paths such as `src/config.ts` | Must be changed by the pull request or exist in the repository at that commit. |
| Functions written as `parseConfig()` | Must appear in the pull request's changes. |
| New packages in `package.json`, `requirements*.txt`, `pyproject.toml` | Must exist on npm or PyPI. Flags packages first published in the last 30 days, near-miss spellings of popular packages, placeholder packages, and npm packages with almost no downloads. |

It skips text that isn't the author's claim: template comments, code blocks, quoted text, unticked checklist items, and negated or future statements ("tests don't pass yet", "tests will pass once..."). Files that `.gitignore` covers (local secrets, build output) are skipped too. Checks about labels, deploy previews, AI reviewers or security scanning never count as test evidence, and a job that "fails" within seconds is treated as never having run (usually a billing or runner problem).

## Settings

| Input | Default | Meaning |
|---|---|---|
| `fail-on` | `contradicted` | Fail the check when a claim is `contradicted`, also `unproven`, also on any `warning`, or `never`. |
| `comment` | `true` | Post one comment and keep it updated on every push or edit. |
| `wait-minutes` | `10` | How long to wait for other checks before judging a "tests pass" claim. |
| `test-checks` | | Regular expression. Only checks with matching names count as test evidence, e.g. `test|ci`. |
| `ignore-checks` | | Comma-separated check names to ignore. |
| `min-package-age-days` | `30` | Newer packages get a warning. |
| `check-files` | `true` | Check file and function mentions. |
| `check-dependencies` | `true` | Check new packages against the registries. |

Outputs: `contradicted`, `unproven`, `verified` (counts) and `report-json`.

### Pull requests from forks

GitHub gives pull requests from forks a read-only token, so the comment can't be posted; the receipts still appear in the job summary. To comment on fork pull requests, trigger on `pull_request_target` instead. That is safe with Claim Receipts because it never checks out or runs the pull request's code; it only reads it through the GitHub API. Don't add a checkout step to that workflow.

## Use it from the command line, or from your agent

```bash
npx github:equinoxaifinance-rgb/claim-receipts owner/repo#123
npx github:equinoxaifinance-rgb/claim-receipts https://github.com/owner/repo/pull/123 --json --fail-on unproven
```

(It runs straight from this repository; no npm account or install needed. Node 20 or newer.)

Set `GITHUB_TOKEN` for private repositories. The exit code is `1` when the claims fail your `--fail-on` level, so a coding agent can run it on its own pull request **before** it tells you it's done.

## Limits, honestly

- It checks claims it can parse. A description that claims nothing gets "no checkable claims", not a pass.
- "Tests pass" is judged from CI results on that commit. If your CI doesn't run tests, Claim Receipts can't prove they pass, and it will say so.
- A function name found in the diff proves it was touched, not that it works.
- Package checks cover npm and PyPI today.

## Privacy and security

Runs entirely inside your GitHub Actions runner. It reads the pull request, its files, check results and linked issues through the GitHub API, and looks up package names on registry.npmjs.org, api.npmjs.org and pypi.org. Nothing else is sent anywhere. It has no dependencies. See [SECURITY.md](SECURITY.md).

## License

MIT
