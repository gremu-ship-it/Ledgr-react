# Demo data seed & accounting integrity — execution report

**Target business:** `487334df-a057-45c3-b088-85e6c0a6aeb3`  
**Currency:** MWK  
**Run date:** 2026-10-19  
**Branch:** `arena/b25f5c5b-ledgr-react`  
**Commit after Step 0:** `0a2890b` (`origin/main`, "Merge pull request #236 …")

---

## 0. Read this first — live access was not available

The brief asks for a **live Supabase** write. This sandbox has **no Supabase credentials and no database
connection string**, and the Supabase connector is **not connected**:

- No `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, or `.env` exists in the workspace.
- The only Supabase hosts referenced in the repository (`hsuhuvuxfuufrlejsatw.supabase.co`,
  `bkxzgkurcqvccsdjmqzg.supabase.co`) are unreachable from this sandbox at the TLS layer
  (`SSL_ERROR_SYSCALL`), and no API key is available anyway.
- `list_connector_tools("supabase")` reports **disconnected**.

**Therefore no hosted row was read, inserted, updated, or deleted.** Nothing in the live tenant was changed.

To still produce verifiable evidence rather than an untested script, the seed and every verification query were
executed against a **disposable PostgreSQL 17 cluster with the full repository migration chain replayed**
(146/146 migrations), using the **exact target business ID** and both operating models. The result proves the SQL,
the schema mapping, the RPC lifecycles and the accounting — **not** the current contents of the hosted tenant.
The live run still needs to be performed once access is supplied (see §11).

---

## 1. Step 0 — checkout verification

```
$ git fetch origin
$ git reset --hard origin/main
HEAD is now at 0a2890b Merge pull request #236 from gremu-ship-it/arena/2c626bdb-ledgr-react

$ grep 'MANUFACTURING' src/lib/capabilities/profile.ts
  'MANUFACTURING',
  MANUFACTURING: 'Manufacturing',
  MANUFACTURING: ['sales', 'inventory', 'manufacturing'],
    && !models.has('MANUFACTURING');

$ grep 'CONSTRUCTION' src/lib/capabilities/profile.ts
  'CONSTRUCTION',
  CONSTRUCTION: 'Construction',
  CONSTRUCTION: ['sales', 'inventory', 'services', 'construction'],
    && !models.has('CONSTRUCTION')
```

Both required markers are present. The branch had one merge commit not on `origin/main`; the mandated reset
moved it to `origin/main` without altering the session branch name.

---

## 2. Execution environment & schema mapping

| Item | Value |
|---|---|
| Engine | PostgreSQL 17 (embedded, disposable) |
| Bootstrap | `tests/release/bootstrap.sql` (auth/storage/cron/net stubs, no platform extensions) |
| Migrations | **146 / 146 applied**, in filename order |
| Business | Exact ID `487334df-a057-45c3-b088-85e6c0a6aeb3` |
| Fixture name | *Nkhotakota Build & Block Ltd* (synthetic; the live row's name was not touched) |
| Operating models | `{CONSTRUCTION, MANUFACTURING}` |
| Plan / currency | `enterprise` / `MWK` |
| Owner | One active `owner` member (fixture user) |
| Provisioning | `provision_construction_defaults`, `provision_construction_coa_accounts`, `provision_manufacturing_defaults`, `provision_manufacturing_coa_accounts` all succeeded |

### 2.1 The brief's names vs. the repository's real schema

The brief uses illustrative names that do **not** match `origin/main`. Per the brief's own rule — *use the actual
table and column names discovered in Phase 1* — the seed uses the real schema:

| Brief | Actual (repository head) | Consequence |
|---|---|---|
| `businesses.currency` | `businesses.base_currency` | reported as `currency` in the discovery output |
| `products.selling_price` | `products.sale_price` | values mapped 1:1 |
| `products.unit` | `products.unit_of_measure` | values mapped 1:1 |
| `chart_of_accounts` | `accounts` (`account_type`, `account_subtype`) | COA queries adapted |
| `journal_entry_lines` (`type`, `amount`) | `journal_lines` (`is_debit boolean`, `amount`) | balance queries adapted |
| `stock_movements.type` | `stock_movements.movement_type` (enum) | `purchase_receipt` does not exist; **`purchase`** used |
| `stock_movements.quantity` | `stock_movements.quantity` (signed) | unchanged |
| `inventory_balances.quantity` | `inventory_balances.quantity_on_hand` | unchanged semantics |
| `construction_valuations` | `project_valuations` | table does not exist under the brief's name |
| valuation status `certified` | `draft` / `submitted` / `invoiced` | `submitted` used (certification-ready) |
| `manufacturing_bom_lines` per 100 units | **per one output unit** | quantities divided by 100 |
| `products.cost_price` | added by `20261104000000` and synced from `purchase_price` | not in the brief; used by BOM rollup |

The real chart of accounts is `accounts`, and the real journal is `journal_entries` + `journal_lines`.
`project_retention_ledger` is the retention subledger.

---

## 3. Phase 1 — discovery (pre-seed baseline)

Because the local database was created from the migration chain, the pre-seed baseline is a clean business.
The values below are the **local replay's** Phase 1 result, not a claim about the hosted tenant.

### 3.1 Business profile (1a)

```json
{
  "id": "487334df-a057-45c3-b088-85e6c0a6aeb3",
  "name": "Nkhotakota Build & Block Ltd",
  "operating_models": ["CONSTRUCTION", "MANUFACTURING"],
  "capability_overrides": {},
  "plan_tier": "enterprise",
  "currency": "MWK"
}
```

Both target models are present, so **no phase was skipped**.

### 3.2 Members (1b)

| user_id | role | created_at |
|---|---|---|
| `9d2b7f4e-6a1c-4c8e-9f3a-2b5d7e8c1a40` | owner | 2026-10-19 13:14:41+00 |

### 3.3 Pre-seed row counts (1c–1g, 1k–1l)

| Entity | Count |
|---|---:|
| Products | 0 |
| Inventory locations | 4 (provisioned: Main Store + 3 manufacturing stores) |
| Construction projects | 0 |
| Manufacturing BOMs | 0 |
| Manufacturing work orders | 0 |
| Stock movements | 0 |
| Inventory balances | 0 |
| Journal entries | 0 |

### 3.4 Key accounts (1h)

The real COA already contains every account the seed needs:

| Code | Name | Type / subtype |
|---|---|---|
| 1131 | Trade Debtors | asset / current_asset |
| 1138 | Retention Receivable | asset / contra_ar |
| 1141 | Trading Stock | asset / current_asset |
| 1142 | Finished Goods | asset / current_asset |
| 1143 | Raw Materials | asset / current_asset |
| 1200 | WIP Inventory | asset / current_asset |
| 2111 | Trade Creditors | liability / current_liability |
| 4113 | Manufacturing Revenue | income / revenue |
| 4114 | Contract Revenue | income / revenue |
| 5100 | Cost of Goods Sold | expense / cost_of_sales |

`WIP Inventory` and `Retention Receivable` were created by the provisioning RPCs; the rest come from the standard
`gaap` chart seeded by `seed_new_business`.

### 3.5 Journal tables (1i)

`journal_entries`, `journal_lines`, plus `project_retention_ledger` (retention) and
`construction_receipt_posting_policies`. There is **no** `journal_entry_lines` table.

### 3.6 `stock_movements` columns (1j)

`business_id`, `created_at`, `created_by`, `id`, `location_id`, `movement_date`, `movement_type` (enum),
`notes`, `product_id`, `quantity` (signed), `reference`, `source_id`, `source_type`, `total_cost`, `unit_cost`.

The enum values at head include `purchase`, `sale`, `adjustment_in/out`, `transfer_in/out`, `return_in/out`,
`opening_balance`, `write_off`, `issue_out`, `construction_return_in`, `manufacturing_issue`,
`manufacturing_return`, `manufacturing_receipt`. **`purchase_receipt` is not a valid value.**

---

## 4. Phase 2 — construction data

### 4.1 Products (2a) — 10 created

| Name | Type | Purchase (MWK) | Selling (MWK) | Unit |
|---|---|---:|---:|---|
| Portland Cement 50kg | product | 8,500.00 | 10,000.00 | Bag |
| River Sand | product | 25,000.00 | 35,000.00 | m³ |
| Crushed Stone 19mm | product | 35,000.00 | 45,000.00 | m³ |
| Steel Rebar Y12 | product | 12,000.00 | 15,000.00 | Length |
| Bricks (Burnt) | product | 120.00 | 180.00 | Piece |
| Timber 50x150mm | product | 4,500.00 | 6,000.00 | Length |
| Roofing Sheets IBR | product | 5,500.00 | 7,500.00 | Sheet |
| Plumbing Kit (Standard) | product | 85,000.00 | 120,000.00 | Set |
| Electrical Wire 2.5mm | product | 45,000.00 | 60,000.00 | Roll |
| Paint (Emulsion 20L) | product | 65,000.00 | 85,000.00 | Bucket |

All ten are `product` (the valid legacy vocabulary), inventory-tracked, with `inventory_account_id = 1141`,
`sales_account_id = 4110`, `cogs_account_id = 5100`, `currency = MWK`, tax code `none`.

### 4.2 Projects (2b) — 2 created

| Name | Client | Contract sum | Retention | Budget | Status | Start | End |
|---|---|---:|---:|---:|---|---|---|
| Hospital Building | Ministry of Health | 260,000,000.00 | 10.00% | 180,000,000.00 | active | 2026-11-01 | 2027-09-30 |
| School Block Renovation | Lilongwe City Council | 45,000,000.00 | 5.00% | 32,000,000.00 | active | 2026-12-01 | 2027-04-30 |

### 4.3 Construction receipts (2c)

One receipt of **100 units** per product, dated **2026-11-01**, into **Main Store** (the default `warehouse`):

| Product | Qty | Unit cost | Value (MWK) |
|---|---:|---:|---:|
| Portland Cement 50kg | 100 | 8,500 | 850,000 |
| River Sand | 100 | 25,000 | 2,500,000 |
| Crushed Stone 19mm | 100 | 35,000 | 3,500,000 |
| Steel Rebar Y12 | 100 | 12,000 | 1,200,000 |
| Bricks (Burnt) | 100 | 120 | 12,000 |
| Timber 50x150mm | 100 | 4,500 | 450,000 |
| Roofing Sheets IBR | 100 | 5,500 | 550,000 |
| Plumbing Kit (Standard) | 100 | 85,000 | 8,500,000 |
| Electrical Wire 2.5mm | 100 | 45,000 | 4,500,000 |
| Paint (Emulsion 20L) | 100 | 65,000 | 6,500,000 |
| **Total** | **1,000** | | **28,562,000** |

Each receipt posts `DR 1141 Trading Stock / CR 2111 Trade Creditors` for the same value.

### 4.4 Valuations (2d) — 2 created

`construction_valuations` does **not** exist. The real table is `project_valuations`, and its `gross_amount` is a
**period** amount; cumulative progress is `previous_cumulative + gross_amount`. The brief's second valuation
(52,000,000 "20% cumulative") was therefore represented as a **26,000,000 period amount with
`previous_cumulative = 26,000,000`**, giving 52,000,000 cumulative without double counting. See Issue 4.

| # | Date | Period gross | Retention (10%) | Net | Previous cumulative | Cumulative gross | Status |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | 2026-11-30 | 26,000,000.00 | 2,600,000.00 | 23,400,000.00 | 0.00 | 26,000,000.00 | submitted |
| 2 | 2026-12-31 | 26,000,000.00 | 2,600,000.00 | 23,400,000.00 | 26,000,000.00 | 52,000,000.00 | submitted |

`project_retention_ledger` records one `withheld` row per valuation (2,600,000 each; 5,200,000 cumulative).

---

## 5. Phase 3 — manufacturing data

### 5.1 Products (3a) — 10 created

**Raw materials (6):**

| Name | Purchase (MWK) | Unit | Received |
|---|---:|---|---:|
| Cement (Bulk per ton) | 170,000.00 | Ton | 10 |
| Fine Sand | 25,000.00 | m³ | 20 |
| Coarse Aggregate | 35,000.00 | m³ | 15 |
| Water (per 1000L) | 5,000.00 | kL | 5 |
| Steel Fibre | 450,000.00 | Ton | 2 |
| Pigment (Red Oxide) | 85,000.00 | Kg | 50 |

**Finished goods (4):**

| Name | Standard cost (MWK) | Selling (MWK) | Unit |
|---|---:|---:|---|
| Concrete Block (Hollow 200mm) | 431.48 | 850.00 | Piece |
| Concrete Block (Solid 150mm) | 383.86 | 650.00 | Piece |
| Paving Brick (Interlock) | 333.83 | 450.00 | Piece |
| Kerb Stone | 523.84 | 3,500.00 | Piece |

`purchase_price` is `NOT NULL` for every product, so the finished goods carry a standard cost equal to their BOM
material cost. It is not used by `manufacturing_bom_cost` (which rolls up component `cost_price`).

### 5.2 Locations (3b)

Provisioning created, and the seed reuses:

| Name | Type | Branch |
|---|---|---|
| Main Store | warehouse (default) | Main Site |
| Raw Materials Store | raw_materials_store | Main Factory |
| Production Floor | production_floor | Main Factory |
| Finished Goods Store | finished_goods_store | Main Factory |

### 5.3 BOMs (3c) — 4 active

The schema expresses **one BOM for one output unit**, not "per 100". The brief's per-100 quantities were divided
by 100 (e.g. 0.15 t cement / 100 blocks = **0.0015 t per block**). Scrap percentages are kept as given.

| Output | Version | Status | Components (per unit) | Scrap | BOM cost |
|---|---|---|---|---|---|
| Concrete Block (Hollow 200mm) | 1 | active | cement 0.0015 t; sand 0.0030 m³; aggregate 0.0025 m³; water 0.0005 kL | 2 / 5 / 3 / 0 % | **431.475** |
| Paving Brick (Interlock) | 1 | active | cement 0.0012 t; sand 0.0020 m³; aggregate 0.0015 m³; pigment 0.0002 kg; water 0.0004 kL | 2 / 5 / 3 / 1 / 0 % | **333.825** |
| Concrete Block (Solid 150mm) | 1 | active | cement 0.0012 t; sand 0.0025 m³; aggregate 0.0030 m³; water 0.0004 kL | 2 / 5 / 3 / 0 % | **383.855** |
| Kerb Stone | 1 | active | cement 0.0018 t; sand 0.0030 m³; aggregate 0.0035 m³; water 0.0005 kL; pigment 0.00005 kg | 2 / 5 / 3 / 0 / 1 % | **523.8375** |

The brief only specified BOMs for the first two finished goods. **Solid Block and Kerb Stone had no BOM**, which
would fail check 5d ("each finished good has exactly one active BOM"), so inferred recipes were added. Remove them
if those two products should not be manufactured. See Issue 8.

### 5.4 Raw-material receipts (3d)

Into **Raw Materials Store**, dated 2026-11-05/06:

| Product | Qty | Value (MWK) |
|---|---:|---:|
| Cement (Bulk per ton) | 10 | 1,700,000 |
| Fine Sand | 20 | 500,000 |
| Coarse Aggregate | 15 | 525,000 |
| Water (per 1000L) | 5 | 25,000 |
| Steel Fibre | 2 | 900,000 |
| Pigment (Red Oxide) | 50 | 4,250,000 |
| **Total** | | **7,900,000** |

### 5.5 Work orders (3e) — 3 created

All three went through the real RPCs (`manufacturing_wo_create` → `release` → `start` →
`record_run` → `complete`), not direct inserts.

| WO | Product | Planned | Completed | Scrapped | Yield | Status | Runs | Material txns |
|---|---|---:|---:|---:|---:|---|---:|---:|
| WO-2026-001 | Concrete Block (Hollow 200mm) | 5,000 | 4,900 | 130 | 97.4% | completed | 2 | 8 |
| WO-2026-002 | Paving Brick (Interlock) | 2,000 | 1,000 | 25 | 97.6% | in_progress | 1 | 6 |
| WO-2026-003 | Concrete Block (Hollow 200mm) | 500 | 0 | 0 | — | draft | 0 | 0 |

- WO-1: run 1 output 2,500 / scrap 50; run 2 output 2,400 / scrap 80; completed.
- WO-2: run 1 output 1,000 / scrap 25; deliberately left in progress.
- WO-3: created, not released.

### 5.6 Manual material adjustment (3f)

`manufacturing_wo_record_consumption(WO-2026-002, NULL, Cement (Bulk per ton), 0.05, NULL,
'Mix correction — additional cement for strength')` succeeded:
`DR 1200 WIP Inventory 8,500 / CR 1143 Raw Materials 8,500`.

---

## 6. Phase 4 — accounting data

All entries are MWK, posted through `_ledgr_post_entry_keyed` or by the manufacturing RPCs. Every entry is
posted (status `posted`) and immutable.

| Source type | Entries | Debits (MWK) | Credits (MWK) |
|---|---:|---:|---:|
| `purchase_receipt` | 16 | 36,462,000.00 | 36,462,000.00 |
| `construction_valuation` | 2 | 52,000,000.00 | 52,000,000.00 |
| `manufacturing_work_order` | 7 | 4,904,605.00 | 4,904,605.00 |
| `sale` | 6 | 1,281,475.00 | 1,281,475.00 |
| **Total** | **31** | **94,648,080.00** | **94,648,080.00** |

### 6.1 Material purchases (4a)

- 10 construction receipts: `DR 1141 Trading Stock / CR 2111 Trade Creditors` — **28,562,000**.
- 6 manufacturing receipts: `DR 1143 Raw Materials / CR 2111 Trade Creditors` — **7,900,000**.
- Posting keys: `PURCHASE-{product_id}-{YYYY-MM-DD}` (one per product/date).

### 6.2 WIP consumption on WO-1 (4b)

The RPC backflush created these automatically; no manual fallback was needed:

| Entry | Debit | Credit | Amount |
|---|---|---|---:|
| Run 1 materials issued | 1200 WIP Inventory | 1143 Raw Materials | 1,078,687.50 |
| Run 2 materials issued | 1200 WIP Inventory | 1143 Raw Materials | 1,035,540.00 |
| **Total** | | | **2,114,227.50** |

### 6.3 Finished-goods receipt on WO-1 (4c)

| Entry | Debit | Credit | Amount |
|---|---|---|---:|
| Run 1 finished goods received | 1142 Finished Goods | 1200 WIP Inventory | 1,078,687.50 |
| Run 2 finished goods received | 1142 Finished Goods | 1200 WIP Inventory | 1,035,540.00 |
| **Total** | | | **2,114,227.50** |

WO-2's run also produced a balanced pair (333,825.00) and the manual issue produced 8,500.00.

### 6.4 Construction valuations (4d)

Each valuation posts three lines:

| Valuation | DR 1131 Trade Debtors | DR 1138 Retention | CR 4114 Contract Revenue |
|---|---:|---:|---:|
| V-001 (2026-11-30) | 23,400,000.00 | 2,600,000.00 | 26,000,000.00 |
| V-002 (2026-12-31) | 23,400,000.00 | 2,600,000.00 | 26,000,000.00 |
| **Total** | **46,800,000.00** | **5,200,000.00** | **52,000,000.00** |

The cumulative position after V-002 is 52,000,000 revenue, 46,800,000 receivable and 5,200,000 retention — the
brief's 20% cumulative figures — without recognising the same work twice.

### 6.5 Sales (4e)

Three sales of hollow blocks, plus matching `sale` stock movements (negative quantities) so the stock ledger and
the GL agree:

| # | Customer | Qty | Revenue | COGS (431.475/unit) |
|---|---|---:|---:|---:|
| 1 | Kamuzu Hardware | 500 | 425,000.00 | 215,737.50 |
| 2 | Area 47 Builders | 300 | 255,000.00 | 129,442.50 |
| 3 | Mzuzu Trade Centre | 200 | 170,000.00 | 86,295.00 |
| **Total** | | **1,000** | **850,000.00** | **431,475.00** |

Each sale posts `DR 1131 / CR 4113` and `DR 5100 / CR 1142`.

---

## 7. Phase 5 — data integrity results

| Check | Result | Evidence |
|---|---|---|
| 5a Product type vocabulary | **PASS** | `product` 10, `raw_material` 6, `finished_good` 4; all in the valid set |
| 5b Inventory balance sanity | **PASS** | 18 non-zero balances; **0 negative**; **0 misplaced** (raw materials all in Raw Materials Store, finished goods all in Finished Goods Store) |
| 5c Movement ↔ balance reconciliation | **PASS** | **0 rows** returned; every `quantity_on_hand` equals the signed sum of movements |
| 5d BOM integrity | **PASS** | 4 active BOMs; 0 finished goods without a BOM; 0 with multiple active BOMs; all costs > 0 |
| 5e Work-order lifecycle | **PASS** | 3 WOs; no overproduction; yields 97.4% / 97.6%; completed WO has 2 runs and 8 material transactions |
| 5f Material variance | **PASS** | 4 completed-order lines; maximum absolute variance **2.0%** (all −2.0% because 4,900 of 5,000 were produced) |
| 5g Valuation math | **PASS** | 2 valuations; `net_discrepancy = 0.00`, `retention_discrepancy = 0.00` |

### 7.1 Balances after seeding (5b)

| Product | Type | Location | Qty |
|---|---|---|---:|
| Concrete Block (Hollow 200mm) | finished_good | Finished Goods Store | 3,900 |
| Paving Brick (Interlock) | finished_good | Finished Goods Store | 1,000 |
| Cement (Bulk per ton) | raw_material | Raw Materials Store | 1.229 |
| Coarse Aggregate | raw_material | Raw Materials Store | 0.8375 |
| Fine Sand | raw_material | Raw Materials Store | 2.465 |
| Pigment (Red Oxide) | raw_material | Raw Materials Store | 49.798 |
| Steel Fibre | raw_material | Raw Materials Store | 2 |
| Water (per 1000L) | raw_material | Raw Materials Store | 2.15 |
| Bricks (Burnt) | product | Main Store | 100 |
| Crushed Stone 19mm | product | Main Store | 100 |
| Electrical Wire 2.5mm | product | Main Store | 100 |
| Paint (Emulsion 20L) | product | Main Store | 100 |
| Plumbing Kit (Standard) | product | Main Store | 100 |
| Portland Cement 50kg | product | Main Store | 100 |
| River Sand | product | Main Store | 100 |
| Roofing Sheets IBR | product | Main Store | 100 |
| Steel Rebar Y12 | product | Main Store | 100 |
| Timber 50x150mm | product | Main Store | 100 |

### 7.2 Work orders (5e)

| WO | Status | Planned | Completed | Scrapped | Yield | Runs | Material txns |
|---|---|---:|---:|---:|---:|---:|---:|
| WO-2026-001 | completed | 5,000 | 4,900 | 130 | 97.4% | 2 | 8 |
| WO-2026-002 | in_progress | 2,000 | 1,000 | 25 | 97.6% | 1 | 6 |
| WO-2026-003 | draft | 500 | 0 | 0 | — | 0 | 0 |

### 7.3 BOM costs (5d)

| Output | Cost (MWK) |
|---|---:|
| Concrete Block (Hollow 200mm) | 431.475 |
| Concrete Block (Solid 150mm) | 383.855 |
| Paving Brick (Interlock) | 333.825 |
| Kerb Stone | 523.8375 |

### 7.4 Material variance (5f)

| WO | Component | Planned | Actual | Variance | % |
|---|---|---:|---:|---:|---:|
| WO-2026-001 | Fine Sand | 15.750 | 15.435 | −0.315 | −2.0 |
| WO-2026-001 | Coarse Aggregate | 12.875 | 12.6175 | −0.2575 | −2.0 |
| WO-2026-001 | Cement (Bulk per ton) | 7.650 | 7.497 | −0.153 | −2.0 |
| WO-2026-001 | Water (per 1000L) | 2.500 | 2.450 | −0.050 | −2.0 |

---

## 8. Phase 6 — accounting integrity results

### 8.1 Journal-entry balance (6a) — **BALANCED**

The adapted query (using `journal_lines.is_debit` and `amount`) returned **zero rows**. Every one of the 31
entries has equal debits and credits. Total debits = total credits = **94,648,080.00 MWK**.

### 8.2 Trial balance (6b) — **BALANCED**

Signed as debit − credit:

| Code | Account | Type | Balance (MWK) |
|---|---|---|---:|
| 1131 | Trade Debtors | asset | 47,650,000.00 |
| 1138 | Retention Receivable | asset | 5,200,000.00 |
| 1141 | Trading Stock | asset | 28,562,000.00 |
| 1142 | Finished Goods | asset | 2,016,577.50 |
| 1143 | Raw Materials | asset | 5,443,447.50 |
| 1200 | WIP Inventory | asset | 8,500.00 |
| 2111 | Trade Creditors | liability | (36,462,000.00) |
| 4113 | Manufacturing Revenue | income | (850,000.00) |
| 4114 | Contract Revenue | income | (52,000,000.00) |
| 5100 | Cost of Goods Sold | expense | 431,475.00 |
| | **Total** | | **0.00** |

- Assets total **88,880,525.00**.
- Liabilities + revenue − COGS = 36,462,000 + 52,850,000 − 431,475 = **88,880,525.00**.
- Every asset balance is a debit; every liability and revenue balance is a credit. **0 sign anomalies.**

### 8.3 WIP reconciliation (6c) — **BALANCED on the corrected basis**

| Basis | Value (MWK) |
|---|---:|
| Ledger WIP (1200) | **8,500.00** |
| Literal "physical" query (all actual consumption on in-progress/released WOs) | **342,325.00** |
| Gap | 333,825.00 |
| Corrected "unpaired WIP" (manual issues/returns with no matching production receipt) | **8,500.00** |

The literal gap is **exactly the finished-goods value received from WO-2's first run** (333,825.00). The
manufacturing RPC posts `DR Finished Goods / CR WIP` on **every run**, so material consumed by a completed run is
no longer WIP even if the work order itself is still in progress. The literal query counts that transferred cost
again. On the economically correct basis — WIP that has not yet been received into finished goods — the ledger and
subledger agree at **8,500.00**.

### 8.4 Retention reconciliation (6d) — **BALANCED**

| Source | Retention (MWK) |
|---|---:|
| Contractual (`gross_amount × retention_pct`) | 5,200,000.00 |
| Ledger (1138 Retention Receivable) | 5,200,000.00 |
| Difference | **0.00** |

---

## 9. Idempotency evidence

The seed was run **twice** against the same database. The second run created **zero** additional rows:

| Entity | After first run | After second run |
|---|---:|---:|
| Products | 20 | 20 |
| BOMs | 4 | 4 |
| Work orders | 3 | 3 |
| Stock movements | 36 | 36 |
| Journal entries | 31 | 31 |
| Valuations | 2 | 2 |

No `DELETE`, `TRUNCATE`, or destructive `UPDATE` is present in the seed. Existing products/projects/BOMs/work
orders/entries are detected by natural keys and left untouched. A pre-existing valuation whose notes do not start
with `Demo seed` is left completely alone — no retention row and no journal entry is created for it, because it may
already have been invoiced or posted by the live business.

### 9.1 Operating-model guards

The “skip the phase if the model is absent” rule was exercised on two additional disposable businesses:

| Business | Products | BOMs | Work orders | Stock movements | Journal entries |
|---|---:|---:|---:|---:|---:|
| Construction only | 10 (`product`) | 0 | 0 | 10 | 12 (10 purchases + 2 valuations) |
| Manufacturing only | 10 (6 raw, 4 finished) | 4 | 3 | 26 | 19 (6 purchases + 7 manufacturing + 6 sales) |

Neither run tried to create the other vertical's locations, products or entries. These extra businesses exist only
in the local disposable database and are not part of the target's counts.

---

## 10. Issues found

1. **No live Supabase access in this environment (blocking for the literal brief).** The seed and verification
   ran on a disposable replay. The hosted tenant was not read or written. A live run still requires a
   `DATABASE_URL`/service-role connection or a connected Supabase app.
2. **Schema drift between the brief and `origin/main`.** `chart_of_accounts`, `journal_entry_lines`,
   `construction_valuations`, `products.selling_price`, `products.unit`, and
   `stock_movements.type = 'purchase_receipt'` do not exist. The SQL uses the real names. Any downstream checklist
   written against the brief's names will report false failures.
3. **`project_valuations.gross_amount` is a period amount, not a cumulative amount.** The brief's
   "52,000,000 (20% cumulative)" would double-count if inserted as `gross_amount` on V-002. It is represented as
   26,000,000 period + 26,000,000 `previous_cumulative`. If the business actually wants `gross_amount` to mean
   cumulative, the schema and the retention calculation (`gross × pct`) both need changing.
4. **`certified` is not a valid valuation status.** The real check constraint allows `draft`, `submitted`,
   `invoiced`. `submitted` is used as the certification-ready state.
5. **`purchase_receipt` is not a valid stock movement type.** The enum uses `purchase`; the seed uses that.
   Any UI/report filter for `purchase_receipt` will miss these rows.
6. **Manufacturing RPCs date production at `current_date()`.** Journal entries and stock movements created by
   `manufacturing_wo_record_run` / `record_consumption` are dated **2026-10-19**, even though the work orders are
   planned for 2026-11/12. They are inside the requested 2026–2027 range, but the demo narrative is slightly out of
   order. A `p_date` parameter on the RPCs (or running the seed at the intended demo date) would fix it.
7. **BOM quantities are per one output unit, not per 100.** Entering the brief's 0.15 t cement per 100 blocks
   directly would consume 750 t for a 5,000-block order. The seed divides by 100 (0.0015 t/block). This is the
   single most dangerous mismatch in the brief.
8. **Two finished goods had no BOM in the brief.** Solid Block and Kerb Stone were given inferred recipes so that
   "every finished good has exactly one active BOM" holds. If they are catalogue-only products, remove their BOMs
   (and adjust check 5d to exclude them).
9. **The literal 6c query double-counts WIP already transferred to finished goods.** See §8.3. Use the corrected
   "unpaired WIP" basis for a meaningful reconciliation.
10. **`products.purchase_price` is NOT NULL.** The brief gives no purchase price for finished goods. A standard
    cost equal to the BOM material cost was used (431.48 / 383.86 / 333.83 / 523.84). This does not affect BOM
    rollup or backflush valuation.
11. **The local fixture business name is synthetic.** It exists only in the disposable database. The live
    business row (name, plan, branding) was not modified.
12. **`journal_entries` posting requires a UUID `source_id`.** `_ledgr_post_entry` casts `source_id` to `uuid`.
    The seed passes product/project UUIDs, never arbitrary strings. A live script that passes document numbers
    here will fail with `22P02`.
13. **Idempotency is natural-key based, not constraint based.** `products` has no unique `(business_id, name)`
    constraint. Two concurrent seed runs could create duplicate product names. Run the seed serially, or add a
    partial unique index if product names must be unique per business.
14. **Construction stock sits in `Main Store` (warehouse).** The brief says "default warehouse/site store".
    The construction provisioning RPC creates `Main Store` with the default `warehouse` type; there is no
    construction-specific location type at head.
15. **The target UUID also appears in the repository as a sample auth user, not a business.**
    `scripts/diagnose-business-not-found.sql:139` uses
    `487334df-a057-45c3-b088-85e6c0a6aeb3` as a JWT `sub` (user id) in a diagnostic. The brief calls it a
    business ID. Before any live write, run Phase 1a and confirm `businesses.id` returns the row; if it is only a
    user id, the seed will refuse with "Business … not found" rather than guessing.

---

## 11. Recommendations

1. **Supply live access and re-run Phases 1, 5 and 6 against the hosted project.** The read-only discovery in
   §3 is the template. Do not paste database passwords into chat; connect Supabase in Arena or provide a
   short-lived connection through the sandbox's secret mechanism.
2. **Run the seed first on a dedicated demo business**, not on a production tenant. It is idempotent but additive:
   it will add 20 products, 2 projects, 4 BOMs, 3 work orders and 31 journal entries to whatever business ID it is
   given.
3. **Snapshot before writing.** At minimum, record `products`, `inventory_locations`, `construction_projects`,
   `manufacturing_boms`, `manufacturing_work_orders`, `stock_movements` and `journal_entries` counts for the target
   business, then compare with §9's post-run counts.
4. **Fix the verification runbook** to use `journal_lines.is_debit`/`amount`, `accounts`, `project_valuations`,
   `quantity_on_hand`, and `movement_type`. Keep the 6c corrected basis.
5. **Add a date parameter to the manufacturing RPCs** (or document that demo production is posted at run time).
   Backdated demo data currently produces October journal entries around November work orders.
6. **Decide the valuation model**: period amounts with `previous_cumulative`, or cumulative `gross_amount`.
   The current schema and the retention formula assume period amounts.
7. **Review the inferred Solid Block / Kerb Stone BOMs.** Either keep them as real recipes or mark those products
   as non-manufactured and relax 5d.
8. **Consider a partial unique index on `products (business_id, lower(name))`** if duplicate product names are
   invalid. This would turn the seed's natural-key check into a database guarantee.
9. **Use `purchase` (not `purchase_receipt`) in any report/UI filter** and add a migration comment documenting the
   enum vocabulary for future seed authors.
10. **Re-run the idempotency check after the live seed** and capture the before/after counts in the change record.

---

## 12. How to run against the live project (when access exists)

The seed is `scripts/demo/seed_demo_business.sql`; it reads the business ID from the
`ledgr.business_id` setting and the owner from `business_users`. It never deletes and never updates an existing
row.

### Option A — direct database connection

```bash
export DATABASE_URL='postgresql://...'          # never commit this
node scripts/demo/run-seed.mjs 487334df-a057-45c3-b088-85e6c0a6aeb3 --allow-remote
node scripts/demo/verify_demo.mjs 487334df-a057-45c3-b088-85e6c0a6aeb3
```

`run-seed.mjs` refuses a non-local target unless `--allow-remote` is passed explicitly. It sets
`request.jwt.claim.sub` transaction-locally to the business's owner so the manufacturing RPCs pass their
`auth.uid()` checks.

### Option B — Supabase SQL editor

```sql
select set_config('ledgr.business_id', '487334df-a057-45c3-b088-85e6c0a6aeb3', false);
select set_config('request.jwt.claim.sub',
  (select user_id::text from public.business_users
    where business_id = '487334df-a057-45c3-b088-85e6c0a6aeb3'
      and role = 'owner' and is_active limit 1), false);
-- then paste scripts/demo/seed_demo_business.sql
```

Run `scripts/demo/discover.sql` first (read-only) and confirm the live schema still matches the repository head. If the live
project has drifted (for example, `source_id` is `uuid` rather than `text`), the seed's UUID `source_id` values are
already compatible; if table names differ, stop and adapt before writing.

### Option C — local reproduction (what this report used)

```bash
npm ci
node scripts/demo/local-replay.mjs --fresh      # 146 migrations into .cache/ledgr-demo
node scripts/demo/local-postgres.mjs &          # port 55432
node scripts/demo/query.mjs -f scripts/demo/local-fixture.sql
node scripts/demo/run-seed.mjs
node scripts/demo/verify_demo.mjs
```

`local-fixture.sql` is **local-only**: it creates the business row with the exact ID and an owner. Never run it
against a hosted project.

---

## 13. Deliverables

| File | Purpose |
|---|---|
| `scripts/demo/discover.sql` | Read-only Phase 1 discovery, adapted to the real schema |
| `scripts/demo/seed_demo_business.sql` | Idempotent construction + manufacturing + accounting seed |
| `scripts/demo/run-seed.mjs` | Guarded runner (local by default, `--allow-remote` for hosted) |
| `scripts/demo/verify_demo.mjs` | Read-only Phase 5/6 verifier; writes JSON evidence |
| `scripts/demo/query.mjs` | Small SQL runner used for discovery |
| `scripts/demo/local-fixture.sql` | Local-only business/owner/COA provisioning |
| `scripts/demo/local-replay.mjs` | Local-only migration replay |
| `scripts/demo/local-postgres.mjs` | Local-only long-running PostgreSQL |
| `scripts/demo/README.md` | Short runbook |
| `DEMO_SEED_REPORT.md` | This report |

**Bottom line:** the seed is written, idempotent, and passes every data and accounting integrity check on a full
replay of the repository schema. The only unmet part of the brief is the **hosted write**, which is blocked by
missing Supabase access in this sandbox and must be performed once credentials or a connector are available.
