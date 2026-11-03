# Contributing to Lykia

Thanks for your interest in Lykia. This guide explains how to set up the
project, the standards a change must meet and how to submit it.

## Getting started

1. Fork the repository and clone your fork.
2. Install dependencies with Node.js 22.12 or newer: `npm ci`.
3. Start the API and the web app: `npm run dev:api` and `npm run dev:web`.

## Before you open a pull request

Run the full check suite. A pull request is reviewed only when it passes:

```sh
npm run verify               # build, unit tests, lint, typecheck, app builds
npm test -w @lykia/contracts # Solidity tests
```

Also make sure that:

- New behaviour has tests, and bug fixes include a regression test.
- Public API changes are documented with `documentRoutes` so they appear
  in the OpenAPI document, and the relevant page in `docs/` is updated.
- All text in the repository is in English (a test enforces this).
- No secrets, private keys or personal data are committed.

## Commit messages

Use a short imperative subject line (for example, "Add TWAP support to the
orders API"), followed by a blank line and a body that explains what changed
and why.

## Smart contracts

Changes to `packages/contracts` need tests for every new branch and must not
change the storage layout of deployed contracts. Regenerate the TypeScript
artifacts with `npm run export -w @lykia/contracts`.

## Reporting bugs and requesting features

Use the issue templates. For security issues, do not open a public issue;
follow [SECURITY.md](SECURITY.md) instead.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
