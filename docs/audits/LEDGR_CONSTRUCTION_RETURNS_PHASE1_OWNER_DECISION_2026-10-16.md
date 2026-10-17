# Construction returns — Phase 1 owner decision (2026-10-16)

**Status: recorded — implementation subsequently authorised, committed and pushed; hosted verification
pending.** The owner approved the Phase 1 (usable-material returns) **design baseline, with corrections and
boundaries**. This record authorised the *design only*: implementation required a separate, explicit
instruction (decision item 10), which the owner gave on 2026-10-16. Phase 1 is now implemented and pushed on
`arena/2faa03b4-ledgr-react` — documentation in `4e2076f` and `b1d3617`, implementation in `26bf4ce`, together
carried by PR #210. **Hosted staging database verification remains pending until the staging deployment
pipeline runs:** no migration has been applied to any hosted project, nothing is deployed, and local or CI
evidence must not be read as hosted verification.

| | |
| --- | --- |
| Repository / branch | `gremu-ship-it/Ledgr-react` · `arena/2faa03b4-ledgr-react` |
| HEAD when the decision was received | `92f64fa` (`92f64fa3bdcd31b5a598a773128cd70527aee3fd`) |
| Baseline approved | `docs/architecture/CONSTRUCTION_RETURNS_WASTAGE_DAMAGE_DESIGN_2026-10-16.md`, as corrected by its §14 in the same change as this record |
| Evidence the decision rests on | `docs/audits/LEDGR_CONSTRUCTION_READ_SECURITY_PHASE3_2026-10-16.md` (read-isolation verification at this HEAD) and the Phase 1 readiness review of 2026-10-16 (findings D1–D3, the §9.1 justification correction and the missing-index gap — all folded into design §14) |
| Nothing implemented | No code, migration, test, policy, grant, schema object or configuration is changed by this record |

---

## 1. The decision as received (verbatim)

**Decision:** Approve the Phase 1 design for usable-material returns, subject to the corrections and
boundaries below.

1. **Costing basis:** Returns must reference an identifiable original construction material issue. A valid
   return is recorded at the original issue's recorded unit cost, and the same amount is deducted from the
   project's net material cost.
2. **Inventory valuation:** Ledgr's existing moving weighted-average pool will recalculate when the returned
   material is added to the store. The implementation must test and document this effect. No artificial
   balancing entry or general-ledger posting is permitted in Phase 1.
3. **Quantity and units:** Cumulative returns must not exceed the original issue quantity. The base quantity
   must be derived from the original issue's recorded conversion ratio, not a subsequently changed UOM
   conversion.
4. **Permissions:** Introduce a dedicated `procurement.material.return` capability.
5. **Project-cost reporting:** Preserve the existing project-cost RPC signature. Net valid returns against
   issued quantity and cost while retaining issue count as the count of issue records. Provide return details
   through the returns register or workspace.
6. **Destination:** Phase 1 returns must go to the original issuing site store. Cross-site returns are
   excluded.
7. **Approval and evidence:** No second-person monetary approval is required in Phase 1. Returns must have
   appropriate evidence and a reason, be restricted to authorised users, and be recorded in an append-only
   register. A separate approval workflow may be introduced later.
8. **Scope restrictions:** No wastage, abnormal loss, damage write-downs, NRV changes, supplier returns,
   general-ledger posting, or changes to the existing GL-posting restriction are authorised by this decision.
9. **Security and testing:** The returns register must have business and branch-scoped read access, controlled
   database privileges, append-only protection, idempotent command behaviour, concurrency tests, period-lock
   checks and tests proving that rejected commands make no writes.
10. **Release boundary:** This decision authorises the design baseline only. Implementation must follow a
    reviewed, corrected design and a separate explicit instruction. Local test success must not be described
    as hosted Supabase or production verification.

**Note on the instruction as received.** The list ended with an empty item **“11.”**. Nothing is assumed for
it: if it carries an additional restriction or condition, it must be supplied **before** the implementation
instruction, and this record must be amended to include it.

**Waiver (owner instruction, 2026-10-16).** The owner directed that the empty item 11 be ignored and that the
authorised Phase 1 implementation proceed. It is therefore recorded as **waived, not supplied**: it carries no
requirement, and nothing is inferred for it. If it is later found to have carried a restriction or condition,
this record must be amended and the Phase 1 implementation revisited before that requirement is relied upon.

## 2. What the decision closes

| Item | Closes | Recorded position |
| --- | --- | --- |
| 1 | §8 **Q2** (costing basis) | Return at the source issue's recorded `unit_cost_base`; the same amount is deducted from the project's net material cost |
| 2 | §8 **Q2** (valuation effect) | The moving weighted-average pool re-prices on the inbound; the effect must be tested and documented; **no balancing entry, no GL posting** |
| 3 | Readiness finding **D2** | `quantity_base` derives from the **source issue's recorded ratio**, never from a subsequently changed conversion |
| 4 | §8 **Q5** | Dedicated capability `procurement.material.return` (a catalogue insert, not a schema change) |
| 5 | §8 **Q6** | RPC signature preserved; returns netted against issued quantity and cost; `issue_count` unchanged; return detail in the register/workspace |
| 6 | §8 **Q7** | Original issuing site store only; cross-site returns excluded |
| 7 | Readiness finding **D3** | **No second-person monetary approval in Phase 1**; reason + evidence mandatory; authorised users only; append-only register; a later approval workflow is a separate design |
| 8 | Scope boundary | Wastage, abnormal loss, damage write-downs, NRV, supplier returns, GL posting and the GL flag stay untouched |
| 9 | Control requirements | Register reads business- and branch-scoped; controlled privileges; append-only; idempotent command; concurrency, period-lock and no-write-on-reject tests |
| 10 | Release boundary | Design baseline only; separate instruction for implementation; local evidence is never hosted/production verification |

## 3. Corrections applied to the design baseline in the same change

Recorded in `docs/architecture/CONSTRUCTION_RETURNS_WASTAGE_DAMAGE_DESIGN_2026-10-16.md` §14, each with the
decision item that directs it:

| Correction | Directed by | What changed in the design |
| --- | --- | --- |
| **D1** — the “destination must hold the stock” bound | items 2, 3, 7 | Withdrawn. The only enforceable custody bound is cumulative returns ≤ the source issue's recorded quantity, under a `FOR UPDATE` lock on the source issue row. T3/T7 rewritten; a new test proves a full return succeeds with the store's `on_hand` at 0 |
| **D2** — base-quantity derivation | item 3 | `quantity_base := quantity × (source_issue.quantity_base / source_issue.quantity)`; the mutable, non-effective-dated conversion table is not consulted; a new regression test covers a changed factor |
| **D3** — approval tier | item 7 | No threshold, no second actor, no approval-token artefact in Phase 1; every refusal raises before any write |
| **D4** — movement label justification | — (design accuracy) | The unsupported claim that reusing `return_in` would corrupt “every existing report” is corrected; the separate-label recommendation stands on ledger semantics and the `ProductsPage:906` display heuristic. **The decision did not name the label** — see §5 |
| **D5** — netting consumers | item 5 | “the RPC, the workspace section, any export” corrected to the two sections that actually call it; no report or export consumer exists |
| **D6** — cumulative-check and netting indexes | item 9 | The register needs `(business_id, source_issue_id)` for the cumulative check; netting reuses `idx_cmi_site_project` |
| **D7** — idempotency fence and lock choice | item 9 | The ledger's `(business_id, client_key)` fence is inert for construction writes (no command passes `client_key` on a movement), and the issue command takes no advisory lock — so the return command must take one explicitly and the design now names both precedents |

## 4. What this decision does **not** authorise

- **Implementation of any kind.** No migration, enum label, command, register, policy, grant, UI or test may
  be created until a separate explicit instruction is given (item 10).
- **Phases 2–4** (normal wastage, abnormal wastage/avoidable damage, damaged-but-recoverable), and any
  approval workflow (item 7, item 8).
- **Any change to inventory valuation rules, cost-basis rules, `gl_posting_enabled` or its `CHECK`**, supplier
  returns, accepted-stock write-downs, NRV measurement, or the general-inventory journal path (item 8).
- **Cross-site returns or any construction transfer command** (item 6).
- **Any claim about hosted Supabase or production behaviour.** The evidence base for this decision is local and
  isolated (embedded PostgreSQL, synthetic JWT claims); `productionVerified` remains **false**, and the
  deployed verification of the read surface stays BLOCKED until it is run in an isolated deployed environment
  (item 10).
- **Answers to the questions the decision did not name:** §8 **Q1** (framework layer), **Q3** (normal/abnormal
  boundary and accounts), **Q4** (NRV policy), **Q8** (IAS 2 §23 specific identification for project-segregated
  material), **Q9** (damage hold), **Q10** (per-project loss reporting). None of these is approved by
  implication.

## 5. Outstanding before an implementation instruction (historical; current status per item)

1. **Q8 confirmation (accountant).** The decision's costing basis presumes the existing moving weighted-average
   pool remains the site-stock measurement basis for Phase 1; §23 specific identification is **not named** in
   the decision. It should be confirmed explicitly, because a different answer would change the cost derivation
   behind item 1 rather than merely adding a phase.
2. **The missing item 11** — **waived by the owner on 2026-10-16** (§1 waiver note); no longer outstanding, and
   nothing is inferred for it.
3. **Movement label** (design §9.1). The decision fixes the *effect* (one inbound at original issue cost) but
   not the label. The design proposes a new `construction_return_in`; reusing `return_in` is the alternative.
   Either choice needs the single-statement enum migration ordered before the command migration; the label must
   also read correctly in the `ProductsPage:906` display heuristic (`includes('in')`).
4. **Baseline commit state — resolved.** The corrected baseline was committed as `4e2076f` and pushed on
   2026-10-16 ahead of the implementation (`b1d3617`, then the implementation commit `26bf4ce`). Nothing is
   outstanding here.
5. **Deployed-verification scope.** Any later hosted verification is a separate authorisation with its own
   environment and identities; local suites can never be presented as it.

## 6. Evidence discipline

All measurements this decision rests on are **local isolated**: the R13 harness's embedded PostgreSQL replayed
from `supabase/migrations`, synthetic JWT claims through `db.asRole`, every probe rolled back, no production or
shared database contacted, no migration applied to any environment. Named fact: `tests/release/construction-branch-scope.test.ts`
12/12 and `tests/release/construction-procurement.test.ts` 17/17 at HEAD `92f64fa` on 2026-10-16. Those are
repository tests, not deployed verification.

---

**Change record.** This record and the §14 corrections were produced as documentation only. **No application
code, migration, test, policy, grant, schema object, configuration or database state was changed. Nothing was
committed, pushed or deployed** *when this record was produced*.

**Update (2026-10-16):** that statement describes this record as produced, not the current state. It was
subsequently committed (`4e2076f`, then `b1d3617`) and pushed with the implementation (`26bf4ce`) on
`arena/2faa03b4-ledgr-react` (PR #210). **No database state has been changed in any environment, and no
staging or production deployment has run.**

---

## 7. Final decisions confirmed 2026-10-16 (A and B)

Recorded after the decision in §1. Both are **Phase 1 decisions**; nothing here authorises implementation, and
§4 ("what this decision does not authorise") is unchanged.

### Decision A — Phase 1 stock movement label: `construction_return_in`

The dedicated movement type for usable construction-material returns is **`construction_return_in`**. The
POS-oriented `return_in` is **not** reused. If a concrete technical incompatibility had been found, the
instruction was to report it and stop for owner review; the compatibility check below found none, so the
decision is recorded as taken.

**Compatibility evidence (repository inspection, read-only):**

| Check | Evidence | Result |
| --- | --- | --- |
| Enum must accept a new label | `stock_movement_type` is a Postgres enum created in `20250101000000_base_schema.sql:186-199` (10 labels); the additive pattern is `alter type public.stock_movement_type add value if not exists '…'` (`20261020500000_stock_movement_type_construction_issue.sql:26`) | Compatible |
| Migration ordering constraint | `20261020500000` header: PostgreSQL cannot *use* a value added in the same transaction, so the label must be its own single-statement migration committed before the migration that consumes it; the R13 harness runs each migration file as one `client.query` (`tests/release/database.mjs:56-75`) | A separate file is **required**, not optional |
| Consumers that switch on the label | No `ORDER BY`/`GROUP BY movement_type` anywhere; `InventoryRepository.ts:437` filters `'purchase'` only; `TransferRepository.ts:120,188` test `transfer_out`/`transfer_in` only; `inventoryJournalService.ts:802-804` is a deny-list inside a function marked *deprecated, no callers*; the live journal path `record_inventory_journal_movement` is gated on its own `kind` parameter, not on the movement type | No consumer misreads the new label |
| Display heuristic | `ProductsPage.tsx:906` treats a movement as inbound when `movement_type.includes('in')` | `construction_return_in` renders as inbound — correct |
| Enum-membership assertions in tests | The only `pg_enum` membership assertion in the release suite is for **user roles** (`tests/release/r01-security.test.ts:205`), not `stock_movement_type` | Adding a label breaks no assertion |
| Existing self-verification blocks | `20261021000000:4262-4266` asserts the `issue_out` label **exists**; it does not assert the label set | Adding a label breaks no verification |
| Client type declarations | `src/dal/types/database.ts:137-152` says "exact 10 members" and **omits `issue_out`** (already stale); `src/dal/types/database.generated.ts:6478` lists 10 labels without `issue_out` | Both must be updated in the implementation stage — a known, listed task, not a blocker |

### Decision B — approved Phase 1 costing and inventory-valuation policy

Recorded as **Ledgr's approved Phase 1 costing policy**:

1. Each return references its identifiable original construction issue.
2. The returned quantity reduces the project's net material cost using the **original issue's recorded unit
   cost**.
3. The returned material enters the **existing moving weighted-average pool**, and the pool's average cost
   recalculates under the existing inventory valuation mechanism.
4. **No artificial balancing entry and no general-ledger posting** in Phase 1.
5. The pool-recalculation effect must be **tested and documented**, including its impact on subsequent issues
   to other projects.

**This is a Ledgr policy choice, not a claim about what IAS 2 requires.** IAS 2 §25 permits weighted average (or
FIFO) as the cost formula for ordinarily interchangeable items and §23 requires specific identification only for
items not ordinarily interchangeable and for goods/services produced and segregated for specific projects; the
standard does **not** prescribe the treatment of returning material to a pool at its original issue cost. The
hybrid above is therefore recorded as an approved internal policy, **not** as an IAS 2 mandate.

**External accounting validation (flagged, not silently resolved).** Suitability of this policy for the
entity's financial reporting — including whether the project-segregation facts engage §23 for site stock —
requires **accountant confirmation**. That is external validation of the owner's approved design, not a
re-design: the design and the repository stay as approved until the accountant responds, and any change the
accountant requires must come back as a new owner decision.

### What A and B close

| Item | Status |
| --- | --- |
| Movement-label choice (decision record §5 item 3; design §9.1) | **Closed — `construction_return_in`**, no reuse of `return_in` |
| Costing basis and pool re-pricing (§1 item 1–2; design §8 Q2) | **Reaffirmed**, now recorded as the approved Phase 1 policy with the IAS 2 caveat above |
| Specific identification for site stock (design §8 Q8) | The approved policy places returned material in the **existing weighted-average pool**; accountant confirmation of that basis for financial reporting is the flagged external validation above, not an open design question |
| Implementation plan | `docs/architecture/CONSTRUCTION_RETURNS_PHASE1_IMPLEMENTATION_PLAN_2026-10-16.md` (implemented plan; local evidence only — see its status header) |

### Still outstanding (unchanged unless listed above)

1. **The unsupplied item 11** from the original instruction — **waived by the owner on 2026-10-16**
   (§1 waiver note); no longer outstanding.
2. **Accountant confirmation** of Decision B's suitability for financial reporting — external validation (above).
3. **Implementation authorisation** — **granted by the owner on 2026-10-16** (a separate explicit
   instruction, per §1 item 10). Implemented and committed as `26bf4ce`; no longer outstanding.
4. **Deployed verification** — a separate authorisation with its own isolated environment and real identities
   (§6); local suites can never be presented as it.
5. **The documentation commit** `4e2076fdea9c1c1720534117e29ffa2532c8ee24` — **now pushed**, after the owner
   authorised the push on 2026-10-16. The branch head carrying this record and the implementation is `26bf4ce`
   (PR #210). No longer outstanding.
