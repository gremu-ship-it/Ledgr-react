# Installing `ci.yml` — step-by-step guide

You need to do this manually because the Arena GitHub App is not allowed to
create or modify files under `.github/workflows/`. **You**, as a normal user
with write access, are allowed to. Nothing here is a workaround for a security
control — it is the control working as intended, and you are the authorised
party.

Pick **one** of the three options below. Option A is easiest if you would
rather not touch a terminal.

---

## Before you start

The branch is `arena/019fa41c-ledgr-react`, currently at commit `9f534d7`.
The file to install is `ci-proposed/ci.yml`; the file to delete is
`.github/workflows/webpack.yml`.

---

## Option A — GitHub web UI (no terminal)

**1. Delete the broken workflow**

- Go to <https://github.com/gremu-ship-it/Ledgr-react/blob/arena/019fa41c-ledgr-react/.github/workflows/webpack.yml>
- Click the **⋯** menu (top right of the file view) → **Delete file**
- Scroll down, keep *"Commit directly to the `arena/019fa41c-ledgr-react` branch"* selected
- Commit message: `Remove broken webpack CI workflow`
- Click **Commit changes**

**2. Create the new workflow**

- Go to <https://github.com/gremu-ship-it/Ledgr-react/new/arena/019fa41c-ledgr-react?filename=.github/workflows/ci.yml>
  (that link pre-fills the correct path)
- Open `ci-proposed/ci.yml` in another tab, copy its **entire** contents, and
  paste into the editor
- Commit message: `Add CI workflow: typecheck, lint and build`
- Keep *"Commit directly to the `arena/019fa41c-ledgr-react` branch"* selected
- Click **Commit changes**

**3. Remove the staging directory** (optional but tidy)

- Delete `ci-proposed/ci.yml`, `ci-proposed/README.md` and
  `ci-proposed/INSTALL.md` the same way you deleted `webpack.yml`.

---

## Option B — command line (recommended if you have the repo cloned)

```bash
# 1. Get the branch
git fetch origin
git switch arena/019fa41c-ledgr-react
git pull

# 2. Swap the workflows
git rm .github/workflows/webpack.yml
git mv ci-proposed/ci.yml .github/workflows/ci.yml
git rm ci-proposed/README.md ci-proposed/INSTALL.md

# 3. Commit and push
git commit -m "Replace broken webpack CI with typecheck/lint/build"
git push origin arena/019fa41c-ledgr-react
```

If step 3 is rejected with a `workflows` permission error, your local git is
authenticating as the app rather than as you. Check with `gh auth status` —
it should show your own username, not `arena-ai-coding-agent[bot]`. Run
`gh auth login` and pick your personal account, then retry the push.

---

## Option C — grant the app permission and let me push it

If you would rather not do it by hand:

1. Go to the repository's **Settings → GitHub Apps** (or the org's app
   settings, if the app is installed org-wide).
2. Find the Arena app and grant it the **Workflows: Read and write**
   permission.
3. Tell me it is done and I will push the change.

Note this widens what the app can do across the repository, permanently.
Options A and B are a one-time action with a narrower blast radius, which is
why I would suggest one of those unless you expect to need workflow edits
often.

---

## Verifying it worked

After pushing, open the PR: <https://github.com/gremu-ship-it/Ledgr-react/pull/31>

- The **"NodeJS with Webpack"** check should be gone.
- A new **"CI / Typecheck, lint and build"** check should appear, running two
  legs (Node 20 and Node 22).
- Both legs should pass. They were simulated from a clean clone of this exact
  branch before being proposed, so a failure would most likely mean the paste
  in Option A dropped or mangled something — compare against
  `ci-proposed/ci.yml`.

From the command line:

```bash
gh pr checks 31
gh run list --branch arena/019fa41c-ledgr-react --limit 5
```

If a run fails, read the log with:

```bash
gh run view --log-failed
```

---

## What you are installing

```yaml
name: CI
on:
  push:
    branches: ["main"]
  pull_request:
    branches: ["main"]
```

- Runs `npm run verify` — that is `typecheck && lint && build` — on Node 20
  and Node 22.
- Node 18 is deliberately excluded: `vite@8` requires
  `^20.19.0 || >=22.12.0`, so an 18.x leg can never pass. The old workflow
  included it, and that leg is what cancelled the other two.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set to placeholder values
  because `src/lib/supabase.ts` throws at import time if they are missing,
  which would break the build step. They are publishable client-side values,
  not secrets. If you would rather CI build against a real Supabase project,
  replace them with repository variables — but there is no security reason to.

**A caveat worth knowing before you spend time on this:** Vercel already
builds every PR, and `npm run build` is `tsc -b && vite build`, so typecheck
and build are effectively gated already. The genuine gap this closes is
**lint**, which nothing currently enforces — that is how 24 lint errors
accumulated on `main`. The red CI badge overstates the problem: it is red
because of a workflow that never worked, not because the code is unverified.
