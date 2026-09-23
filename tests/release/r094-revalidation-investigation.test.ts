/**
 * R09.4 Phase B — explicit INVESTIGATION/limitation record for the blocked
 * browser-driven server-revalidation evidence, per the follow-on owner
 * authorization Phase B. Investigation-only: existing BLOCKED record
 * R094.BROWSER.SERVER-REVALIDATION is NOT reclassified (standing §17 no-
 * reclassification rule); this single additive record captures the Phase-B
 * investigation outcome and the exact discharge prerequisites.
 *
 * Investigation scope: can R094.BROWSER.SERVER-REVALIDATION be discharged
 * from this sandbox via a GENUINELY wire-reachable backend (per mandate B3
 * candidates), excluding every B4 disqualifier (no direct SQL disguised as
 * HTTP, no fake/mock backends, no invented HTTP layers)?
 */
import { evidenceSuite, Blocked } from './evidence';

const test = evidenceSuite('r094-revalidation-investigation');

test({
  id: 'R094.BROWSER.SERVER-REVALIDATION.INVESTIGATION',
  expected:
    'Phase-B determination: whether a genuinely wire-reachable real backend (PostgREST/GoTrue over the verbatim-replayed migrations, or an equivalent officially distributed Supabase API layer) can be stood up in this sandbox, and if not, the exact recorded prerequisites for discharge',
  source:
    'live sandbox probing 2026-09-23 (process/dependency/network capability checks); tests/release/database.mjs fixture source; supabase/migrations/*rpc*.sql; no HTTP layer invented; no backend mocked',
  remediation: 'R09.4-PHASE-B',
  layer: 'investigation/limitation record — no simulation performed, no product code touched, no existing record reclassified',
}, () => {
  throw new Blocked(
    'Phase-B investigation outcome: a genuinely wire-reachable REAL backend cannot be stood up in this sandbox, so R094.BROWSER.SERVER-REVALIDATION stays BLOCKED. Findings (all probed live on 2026-09-23): ' +
    '(1) The DB-suite fixture (tests/release/database.mjs, embedded-postgres 17.10.0-beta.17) runs a REAL PostgreSQL binary bound to 127.0.0.1 over the genuine PG wire protocol with all migrations replayed verbatim — the earlier limitation phrase "process-local, not network-addressable" is factually corrected here: the database IS TCP-addressable. A real service, not a mock, exists at the SQL layer. ' +
    '(2) The missing layer is the genuine HTTP REST contract: PostgREST (which enforces JWT claims, role switching, RLS, content profiles, and the supabase-js error surface) and GoTrue (browser auth sessions). The official PostgREST binary is unreachable from this sandbox: github.com and api.github.com respond, but the release-asset CDN (release-assets.githubusercontent.com) refuses TLS (curl 302→SSL_ERROR_SYSCALL; `gh release download` fails identically at the same host); apt has no postgrest package; the npm "postgrest" wrapper (seveibar/postgrest-node 1.2.1) downloads from the same blocked CDN and pins ancient PostgREST that would not represent the contract; building PostgREST from Haskell source in-sandbox is not a genuine option. ' +
    '(3) Docker/podman/buildah and the Supabase CLI stack path are absent (containers unavailable), so the officially distributed Supabase local stack cannot run. GoTrue is unreachable for the same transport and infrastructure reasons. ' +
    '(4) The only remaining candidate — a hand-written Node HTTP bridge executing the real migrations\' RPCs — is exactly what mandate B4 disqualifies ("direct SQL invocation disguised as an HTTP request"; fake/mock backend): its auth/role/RLS/error semantics would be harness-authored, not the product backend. Not attempted. ' +
    '(5) Discharge prerequisites (exact): a sandbox with (a) Docker available for the official Supabase local stack, or (b) network access to the GitHub release-assets CDN (or an approved mirror with pinned sha256) plus permission to run the official PostgREST static binary and a GoTrue-equivalent auth issuer with real JWT validation; then drive the real Chromium session against it through the existing R09.4 proxy/TLS harness (already wire-real to the stub host and reusable verbatim for a real host). ' +
    '(6) No reclassification performed: the original R094.BROWSER.SERVER-REVALIDATION record remains BLOCKED unchanged; this investigation record is the additive filing required by Phase B. Observed during Phase B: none. Defects: none recorded against product code.',
  );
});
