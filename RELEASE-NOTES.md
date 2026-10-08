First release.

- Checks "tests pass" / "CI is green" claims against the commit's real check results (waits for running checks, never counts itself).
- Checks "fixes #N" links point to real issues.
- Checks named files and functions exist in the change or the repository.
- Checks new npm and PyPI packages: missing, placeholder, near-miss spelling of a popular package, first published in the last 30 days, or barely downloaded.
- One pull request comment, updated in place. Job summary for fork pull requests.
- CLI: `npx claim-receipts owner/repo#123` with `--json` and exit codes, so agents can check their own work before saying "done".
- No dependencies. No AI model makes any verdict.
