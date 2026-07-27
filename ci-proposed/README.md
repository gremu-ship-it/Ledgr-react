# Proposed CI workflow (not yet installed)

`ci.yml` here is meant to live at `.github/workflows/ci.yml`, replacing
`.github/workflows/webpack.yml`. It could not be committed to that path from
this session: the GitHub App pushing this branch lacks the `workflows`
permission, and the push is rejected with

    refusing to allow a GitHub App to create or update workflow
    .github/workflows/ci.yml without `workflows` permission

## Why the current workflow must go

`.github/workflows/webpack.yml` runs:

    npm install
    npx webpack

This is a Vite + TypeScript project. There is no `webpack` dependency, no
`webpack.config.js` and no webpack entry point, so `npx webpack` downloads
webpack on the fly and then fails with no config. Every run since it was added
has failed. It also matrixes Node 18, which can never satisfy `vite@8`
(`engines: ^20.19.0 || >=22.12.0`); that leg is what cancels the 20.x and 22.x
legs. And it never runs `tsc`, `eslint` or `vite build`, so the checks that
would catch real regressions are not gated at all.

## To install (needs a human with repo write access)

    git rm .github/workflows/webpack.yml
    mv ci-proposed/ci.yml .github/workflows/ci.yml
    rmdir ci-proposed 2>/dev/null || rm -rf ci-proposed
    git commit -m "Replace broken webpack CI with typecheck/lint/build"

Alternatively, grant the Arena GitHub App the `workflows` permission and the
change can be pushed directly.

Both `npm run lint` and `npx tsc -b` pass on this branch as of this commit, so
the new workflow should be green immediately.
