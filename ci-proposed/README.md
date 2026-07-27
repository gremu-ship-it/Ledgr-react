# Proposed CI workflow (not yet installed)

`ci.yml` here belongs at `.github/workflows/ci.yml`, replacing
`.github/workflows/webpack.yml`. It could not be committed to that path from
this session — see "Why this is not installed" below.

## Why the current workflow must go

`.github/workflows/webpack.yml` runs:

    npm install
    npx webpack

This is a Vite + TypeScript project. There is no `webpack` dependency, no
`webpack.config.js` and no webpack entry point, so `npx webpack` downloads
webpack on the fly and then fails with no config. **Every run since it was
added has failed.**

Two further problems in the same file:

- It matrixes Node 18, which can never satisfy `vite@8`
  (`engines: ^20.19.0 || >=22.12.0`). The 18.x leg is what cancels the 20.x
  and 22.x legs — `The strategy configuration was canceled because
  "build._18_x" failed`.
- It never runs `tsc`, `eslint` or `vite build`, so the checks that would
  catch real regressions are not gated at all.

## What the replacement does

Runs `npm run verify` (`typecheck && lint && build`) on Node 20 and 22.

The `verify` script was added to `package.json` in the same commit as this
file, so it is already usable locally and is **not** blocked by the permission
issue. Running `npm run verify` before pushing reproduces CI exactly.

Vercel already builds each PR, which covers typecheck and build (`npm run
build` is `tsc -b && vite build`). The gap this workflow closes is **lint**,
which nothing currently enforces, plus verification on two Node versions.

## Why this is not installed

The GitHub App backing this session lacks the `workflows` permission. Pushing a
commit that adds this file is rejected:

    refusing to allow a GitHub App to create or update workflow
    .github/workflows/ci.yml without `workflows` permission

Deleting `webpack.yml` *is* permitted — only creating/updating workflow files
is blocked. Deleting it alone would turn CI green by removing the failing
check, but that would leave the repository with no build gate at all, so it is
left in place for a human to decide.

## To install

See `INSTALL.md` in this directory for a step-by-step guide (web UI, command
line, or granting the app permission).

Short version, if you have the repo cloned:

    git switch arena/019fa41c-ledgr-react
    git rm .github/workflows/webpack.yml
    git mv ci-proposed/ci.yml .github/workflows/ci.yml
    git rm ci-proposed/README.md ci-proposed/INSTALL.md
    git commit -m "Replace broken webpack CI with typecheck/lint/build"
    git push

## Verification already done

The workflow was validated before being proposed:

- YAML parses; triggers, matrix, env and steps all resolve as intended.
- Simulated end to end from a **clean clone** of this branch with `npm ci` and
  the placeholder env vars — `npm run verify` exits 0.
- Confirmed it *fails* correctly: an injected type error exits 2, and an
  injected `any` exits 1 on the lint step. It is not passing vacuously.

`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set to placeholders in the
workflow because `src/lib/supabase.ts` throws at import time when they are
absent, which would break the build step. They are publishable client values,
not secrets, and CI has no project to point at.
