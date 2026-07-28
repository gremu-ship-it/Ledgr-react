# Deploy workflow is broken — apply this fix by hand

**Status:** `.github/workflows/deploy.yml` has run **14 times and failed 14 times**,
every run in `0s` with *"This run likely failed because of a workflow file issue."*
**Neither staging nor production has ever been deployed by CI.**

I could not push the fix myself: GitHub blocks the agent's token from modifying
files under `.github/workflows/` without the `workflows` OAuth scope —

```
! [remote rejected] refusing to allow a GitHub App to create or update
  workflow `.github/workflows/deploy.yml` without `workflows` permission
```

So the change is written out below for you to apply. It is small.

---

## Root cause

Two steps (staging line ~139, production line ~231) used:

```yaml
if: ${{ secrets.RAILWAY_TOKEN != '' }}
```

The `secrets` context **is not available in a step-level `if:`**. Per GitHub's
[context availability table](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability),
`jobs.<job_id>.steps.if` permits only:

> `github, needs, strategy, matrix, job, runner, env, vars, steps, inputs`

`secrets` is absent. This is a **parse-time validation error**, so GitHub rejects
the *entire workflow file* and runs **no jobs at all** — hence the 0-second
failures, and hence merges to `main` silently deploying nothing.

`jobs.<job_id>.env` *does* allow `secrets`, which is the basis of the fix.

---

## The fix — 3 edits

### 1. Staging job: add `RAILWAY_TOKEN` to job-level `env`

Find the end of the `deploy-staging` `env:` block (after `SUPABASE_DB_PASSWORD`)
and add:

```yaml
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD_STAGING }}

      # Surfaced at job level so the optional Railway step can test for it.
      # The `secrets` context is NOT available in a step-level `if:` (only in
      # `env:`), so referencing it there invalidates the entire workflow file.
      RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
    steps:
```

### 2. Production job: same addition

After `SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD_PROD }}`:

```yaml
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD_PROD }}

      # See the staging job — `secrets` is unavailable in a step-level `if:`.
      RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
    steps:
```

### 3. Both Railway steps: fix the condition

Replace **both** occurrences of:

```yaml
      - name: Deploy Express gateway to Railway (if configured)
        if: ${{ secrets.RAILWAY_TOKEN != '' }}
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
          RAILWAY_PROJECT_ID: ${{ vars.RAILWAY_PROJECT_ID_STAGING }}   # _PROD in the prod job
```

with:

```yaml
      - name: Deploy Express gateway to Railway (if configured)
        if: env.RAILWAY_TOKEN != ''
        env:
          RAILWAY_PROJECT_ID: ${{ vars.RAILWAY_PROJECT_ID_STAGING }}   # _PROD in the prod job
```

(The step-level `RAILWAY_TOKEN` line is removed — it is inherited from the job
now. Keep the `RAILWAY_PROJECT_ID` line as-is; it differs per job.)

---

## Also worth fixing: the approval gate does not exist

The workflow comment claims *"the `production` environment requires a reviewer"*.
**It does not.** Checked via the API on 2026-07-28:

```
ENV: 'Preview'      protection_rules: []
ENV: 'Production'   protection_rules: []
```

Naming an environment in a workflow does **not** create a protection rule. With
the YAML fixed, pushing a `v*` tag would deploy straight to production —
`vercel --prod`, `supabase db push`, Edge Functions — **with nothing to approve.**

**Before tagging:** Settings → Environments → `Production` → enable
**Required reviewers**. Optionally restrict *Deployment branches and tags* to `v*`.

Also note the workflow says `name: production` (lowercase) while the configured
environment is `Production`. Matching is case-insensitive so it resolves, but
aligning them makes it obvious which rules apply. Suggested replacement comment:

```yaml
    environment:
      # Must match the environment name in repo settings (currently
      # "Production"). Matching is case-insensitive, but keep them aligned so
      # protection rules are obviously attached to this job.
      name: Production
      url: ${{ vars.PRODUCTION_URL }}
```

There is also no `staging` environment configured (only `Preview` and
`Production`); GitHub auto-creates it on first use, which is harmless but means
you cannot attach protection rules to it until it exists.

---

## Apply it

Easiest is the ready-made patch. From a clone where **your own** credentials are
active (they have the `workflows` scope; the agent's do not):

```bash
git checkout arena/019fa840-ledgr-react
git am < deploy-fix.patch     # patch content reproduced in the PR thread
```

Or just make the three edits above by hand, then:

```bash
git add .github/workflows/deploy.yml
git commit -m "fix(ci): repair deploy workflow invalidated by secrets in step-level if"
git push origin arena/019fa840-ledgr-react
```

### Verify before merging

```bash
# Should print 0 — no `if:` may reference the secrets context
grep -c "if:.*secrets\." .github/workflows/deploy.yml
```

Then confirm the run no longer dies in 0s:

```bash
gh run list --workflow=deploy.yml --limit 3
```

A healthy staging run takes minutes, not zero seconds.
