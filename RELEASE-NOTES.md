## v0.1.1

- A job that ran twice on the same commit (on push and on pull_request) is counted once when both runs agree. Receipts said "6 of 6 checks" for 3 jobs. If the two runs disagree, both still count, so a failure is never hidden.
- The Action and the hosted Claim Receipts app can run on the same repository. Neither waits on the other's check, and each updates only its own comment.
- The CLI runs straight from GitHub: `npx github:equinoxaifinance-rgb/claim-receipts owner/repo#123`. It is not on npm yet.
- CI moved to the Node 24 versions of checkout and setup-node.

## v0.1.0

First release.

- Checks "tests pass" / "CI is green" claims against the commit's real check results (waits for running checks, never counts itself).
- Checks "fixes #N" links point to real issues.
- Checks named files and functions exist in the change or the repository.
- Checks new npm and PyPI packages: missing, placeholder, near-miss spelling of a popular package, first published in the last 30 days, or barely downloaded.
- One pull request comment, updated in place. Job summary for fork pull requests.
- CLI: `npx claim-receipts owner/repo#123` with `--json` and exit codes, so agents can check their own work before saying "done".
- No dependencies. No AI model makes any verdict.
