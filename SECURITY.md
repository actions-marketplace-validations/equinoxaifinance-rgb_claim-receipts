# Security

Claim Receipts never checks out, builds or runs the code in a pull request. It only reads pull request data through the GitHub API and looks up package names on the public npm and PyPI registries.

- It has no runtime dependencies, so there is no third-party package code in your workflow.
- It needs `pull-requests: write` only to post its one comment. Everything else is read-only.
- It works under `pull_request_target` for fork pull requests because it does not execute pull request code. Do not add a checkout of the pull request's head to such a workflow.

To report a vulnerability, open a private security advisory on this repository.
