# Guide — consolidating the three Vercel projects

**Guidance only.** No Vercel setting was changed while writing this; there is no Vercel token in this environment. Every step below is for the owner to do in the Vercel dashboard (team `gremu`). Nothing was deployed.

## 1. What exists today (evidence: CI deploy logs of 2026-09-25 plus the live aliases)

| Project | Project id | Deployed by | Supabase | Public alias | What it really is |
|---|---|---|---|---|---|
| **ledgr-react** | `prj_hMyLCYtJzeTD1bpOl8D9sEdszAYn` | `deploy.yml` production job (`vars.VERCEL_PROJECT_ID_PROD`) | `hsuhuvuxfuufrlejsatw` (prod) | https://ledgr-react.vercel.app | **Production.** Customers log in here. |
| **ledgr-react-prod** | `prj_AFgEgjFL7NTWoyFLKlkGlHlOv0V9` | `deploy.yml` staging job (`vars.VERCEL_PROJECT_ID_STAGING`) | `bkxzgkurcqvccsdjmqzg` (staging, `SUPABASE_ENV_LABEL=staging`) | https://ledgr-react-prod.vercel.app | **Staging**, despite the name. |
| **ledgr-react-hp5u** | not in any repo config | Vercel Git integration (not CI) | unknown | https://ledgr-react-hp5u.vercel.app (`/` redirects to `/en/`) | Unverified. Its routing does not match this SPA. |
| ledgr-react-staging | — | — | — | ledgr-react-staging.vercel.app | Dormant alias referenced in repo docs |

Two points matter:

- The name "-prod" points at **staging** data. That invites someone to test on it, or to give it to a customer, believing it is production.
- hp5u deploys **outside CI**, so it skips the release gate, the migration-first ordering and the skew guard. `vercel.json` sets `git.deploymentEnabled.main=false` for projects built from this repo. If hp5u still deploys, it is connected to a different repository, branch or root directory, or it predates that setting. Check this in step 2 before deciding anything.

## 2. Before changing anything (read-only checks in the dashboard)

For each project, record the following. Screenshots go in the evidence folder; they are part of P0 evidence preservation.

1. **Settings → Git**: connected repository, production branch, root directory.
2. **Settings → Domains**: every domain, including custom ones (`app.ledgr.com`, `staging.ledgr.app`, `admin.ledgr.com` appear in repo docs).
3. **Settings → Environment Variables**: *names and the Supabase URL only*. Do not copy secret values into notes.
4. **Deployments**: the last 10, including who or what triggered them (CLI token vs Git).
5. For **hp5u**: open `/en/` and view the page source to see which app it is. If it serves Ledgr data, find which Supabase URL is in its bundle (DevTools → Network → requests to `*.supabase.co`).

Decision rule: if hp5u serves a customer-facing domain, or talks to the **prod** Supabase, treat removing it as a production change. Plan it and announce it. Do not just delete it.

## 3. Target shape

Two projects, both deployed only by `deploy.yml`:

| Project | Environment | Supabase | Domain |
|---|---|---|---|
| `ledgr-react` (keep; canonical) | Production | prod `hsuhuvuxfuufrlejsatw` | ledgr-react.vercel.app plus the real custom domain |
| `ledgr-react-staging` (**rename** `ledgr-react-prod`) | Staging | staging `bkxzgkurcqvccsdjmqzg` | ledgr-react-staging.vercel.app / staging.ledgr.app |

Why not collapse everything into one project? That is possible: use Vercel's Preview or custom environments inside `ledgr-react`, with staging variables scoped to Preview. But it puts prod and staging secrets in one project, where a mis-scoped variable ships staging keys to production or the reverse. It also means rewriting both deploy jobs. Keeping two projects with honest names gives the same clarity with far less risk, and `deploy.yml` needs no change at all, because it addresses projects by id.

## 4. Steps (in this order)

1. **Freeze hp5u.** Settings → Git → *Disconnect*. Or, if you want it kept as a record, set *Ignored Build Step* to `exit 0`. This stops CI-bypassing deploys without deleting anything.
2. **Move domains, if hp5u has any real ones.** Remove the domain from hp5u and add it to `ledgr-react`. Vercel only lets a domain live on one project, and the DNS record stays the same. Do it at a quiet hour; expect a few minutes of certificate issuance.
3. **Rename `ledgr-react-prod` → `ledgr-react-staging`** (Settings → General → Project Name). The project id stays `prj_AFgEg…`, so `vars.VERCEL_PROJECT_ID_STAGING` and `deploy.yml` keep working. The old `*.vercel.app` alias changes. If the dormant `ledgr-react-staging` alias belongs to another project, delete that project or release its name first. Tell testers the new URL.
4. **Verify through CI, not by hand.** Push to the staging branch and confirm the staging job deploys to the renamed project and that the app shows the staging label. Then check that a production release still targets `prj_hMyLCY…`.
5. **Retire hp5u.** Wait one full release cycle (for example a week) with no traffic. Then export its deployment list, keep the screenshots from step 2, and delete the project. Deleting a Vercel project does not touch any database.
6. **Close the loop in the repo.** Update the docs that mention `ledgr-react-prod` or hp5u, and add `vars.VERCEL_PROJECT_ID_PROD` / `_STAGING` to the environment table in `docs/`. That can be a follow-up PR.

## 5. What not to do

- Don't delete `ledgr-react` or `ledgr-react-prod`. Deploys and aliases are addressed by project id.
- Don't copy production environment variables into the staging project, or the reverse.
- Don't re-enable Git auto-deploy for `main` on any project; that is what makes hp5u bypass CI.
- Don't consolidate during an open incident window. Production is still on `f671656` and this branch is undeployed.

## 6. Open questions only the owner can answer

- Who created hp5u, and is it used by anyone (demo, marketing page, partner)?
- Which custom domain do customers use today?
- Should staging be protected by Vercel Authentication (password or SSO) so customers can't stumble onto it?
