# §6.5 Parity Test — Workbook Reproduction Report

**Task 25 · Phase 1 acceptance gate · date 2026-07-16**
**Authority workbook:** `Veridan_Quote_Template.xlsx` (read-only reference)
**Reproducer:** `scripts/parity-test.mts` (runnable: `npx tsx scripts/parity-test.mts`)
**Regression lock:** `lib/landed-cost/parity.test.ts` (runs in `npm test`)

---

## Verdict

**PASS — WITH DOCUMENTED EXCEPTIONS.**

The app reproduces the real project's numbers **exactly wherever the workbook is
internally consistent**: the per-HW-group hardware cost basis matches to the cent
across all 12 hardware groups (44 priced doors, **US$7,603.20** total), and the
one internally-consistent origin in the workbook's Landed Cost Calculator (USA /
Trudoor) is reproduced on invoice, CIF, and marine insurance to the cent.

Every remaining difference roots to a **workbook internal inconsistency** or a
**ratified build-plan design decision**, not to an app bug. **No engine changes
were required** — the landed-cost engine was already correct against the parts of
the workbook that are self-consistent. The differences are enumerated and
root-caused below.

---

## Method

1. **Extracted the workbook** with openpyxl (formulas + attempted cached values).
   Key finding: the workbook was generated programmatically and **never
   recalculated in Excel**, so it carries **no cached formula results** — every
   formula cell reads `None` under `data_only=True`. The parity therefore
   **evaluates the workbook's formula chains directly** (`buildWorkbook()` in the
   script; mirrored in `parity.test.ts`) to obtain its intended outputs.

2. **Reproduced the inputs** in the app's live data model, faithfully:
   - **Hardware Library** — all 22 items with their real library unit costs. Only
     the Trudoor locksets carry a price (item 1 = $194.40, item 2 = $240.00,
     item 3 = $194.40, item 20 = $156.00); **every Consort item is $0**, exactly
     as the library has them (the Hardware Summary sheet, note A29, states
     *"Consort items are priced via package price in Door Register Col H"*).
   - **Suppliers** — Trudoor (origin `USA–Miami`) and Consort (origin
     `UK–Consort`), so the app's shipment-origin grouping splits the project into
     the same two origins the workbook's Landed Cost Calculator uses.
   - **Hardware sets** — HW01–HW12 with the exact item/quantity composition from
     the Hardware Schedule matrix. HW11 is split into a single-leaf set (door
     DD41) and a double-leaf set (door DF40) because the workbook's HW Group
     "HW11" covers two doors with different item counts.
   - **Door Register** — all 46 doors, floor/number/HW-group as in the workbook.

3. **Ran the app's real pipeline.** The script calls the *same* pure functions the
   production server action `createDoorRegisterQuote` uses — `buildParametersSnapshot`,
   `buildFxSnapshot`, `buildOriginGroups`, `resolveLineCost`, `toUsdIndicative`,
   and `recomputeQuote` → `computeQuoteResult` → `calculateQuote` (the actual
   landed-cost engine). The server action itself is not callable outside Next
   (it uses `redirect`/`getCurrentUser`), so its pure body is reproduced in
   intent, but **all arithmetic is the real engine**, unchanged.

4. **Set the USA origin's cost inputs** to the workbook's Landed Cost Calculator
   Origin-2 values (Miami consolidator $50, ocean freight $200, port/customs
   $150, marine insurance 1.5%, duty+GCT 55%; no separate brokerage line, since
   the workbook bundles customs-agent fees into the $150 port line).

5. **Diffed** per-HW-group per-door cost, group totals, grand totals (USD & JMD),
   and the USA origin landed chain.

---

## Results

### Comparison A — Hardware cost basis per HW group (the consistent, comparable layer)

App per-door `line_value_usd` (Σ qty × library unit cost) vs the workbook's
itemized Σ(qty × unit cost) — the algorithmically-defined half of the workbook's
"Total Door Cost". **Exact match, every group:**

| Group | Doors | App / door | WB / door | App total | WB total | |
|---|---|---|---|---|---|---|
| HW01 | 12 | 194.40 | 194.40 | 2,332.80 | 2,332.80 | OK |
| HW02 | 12 | 194.40 | 194.40 | 2,332.80 | 2,332.80 | OK |
| HW03 | 2 | 240.00 | 240.00 | 480.00 | 480.00 | OK |
| HW04 | 3 | 0.00 | 0.00 | 0.00 | 0.00 | OK |
| HW05 | 2 | 240.00 | 240.00 | 480.00 | 480.00 | OK |
| HW06 | 2 | 240.00 | 240.00 | 480.00 | 480.00 | OK |
| HW07 | 2 | 0.00 | 0.00 | 0.00 | 0.00 | OK |
| HW08 | 2 | 0.00 | 0.00 | 0.00 | 0.00 | OK |
| HW09 | 1 | 194.40 | 194.40 | 194.40 | 194.40 | OK |
| HW10 | 3 | 240.00 | 240.00 | 720.00 | 720.00 | OK |
| HW11 | 2 | 388.80 / 194.40 | 388.80 / 194.40 | 583.20 | 583.20 | OK |
| HW12 | 1 | 0.00 | 0.00 | 0.00 | 0.00 | OK |
| **TOTAL** | **44** | | | **7,603.20** | **7,603.20** | **OK** |

This validates the app's library costs, set compositions, quantities, FX
normalization, and per-door rollup all at once.

### Comparison D — Landed cost, USA / Origin 2 (Trudoor, Miami)

| Line | App (USD) | Workbook (USD) | |
|---|---|---|---|
| Trudoor hardware invoice | 7,603.20 | 7,603.20 | OK |
| CIF basis (cost + freight) | 7,853.20 | 7,853.20 | OK |
| Marine insurance (1.5%) | 117.80 | 117.80 | OK |
| Duty + GCT (55%) | 4,319.26 | 4,466.55 | ≠ (base differs) |
| **Origin-2 total landed** | **12,440.26** | **12,587.55** | **≠ (Δ 147.29)** |

The **entire** landed delta ($147.29) is the duty base — see Root Cause 4.

### Comparison C — Client-facing totals (non-comparable by design)

| | Value |
|---|---|
| Workbook client quote (JMD, `AD`×162, no margin) | 2,798,680.30 |
| Workbook hardware basis (JMD, itemized×162) | 1,231,718.40 |
| App client price (JMD, landed ÷ (1−margin) × 166.86) | 2,965,405.00 |
| App client price (USD) | 17,771.75 |
| App landed cost (USD, incl. freight/duty/insurance) | 12,440.26 |

The client-price layer is **not** a like-for-like comparison — the workbook puts
raw hardware cost × flat 162 in front of the client with no margin and no landed
adder, while the app prices `landed ÷ (1 − margin)` at the buffered FX rate. This
is the ratified behaviour (build plan §3, §7.1 item 8), not a discrepancy.

---

## Root cause of every delta

**1. Workbook "Total Door Cost" (`AD`) double-counts the package price.**
The Hardware Schedule formula is `AD = IF(package_price > 0, package_price, 0) +
Σ(qty × unit cost)`. For Consort-only doors (HW04/07/08/12) the itemized half is
$0 and `AD` = package price — self-consistent. But for every **Trudoor-bearing**
group the manually-keyed package price (col H, e.g. 194.40 for HW01 — *the raw
Trudoor lockset cost*) is added **on top of** the itemized cost the same lockset
already contributes. Across the project this inflates the workbook's published
door totals by **US$9,672.60** (itemized $7,603.20 → `AD` $17,275.80).
→ *Workbook internal inconsistency.* The app prices from the library (itemized
only) and does not have — or need — a parallel package-price side-channel.
**Documented, not fixed** (§7.1 item 8 already declared the workbook's package
prices non-authoritative).

**2. Consort items priced $0 in the library.**
The workbook zeroes all Consort unit costs and carries their price in the
package-price column instead. Consequently the app's `UK–Consort` origin pool has
a $0 supplier-invoice total, and the engine's `zero_value_origin` guard **skips
it** (logging a structured error) rather than dividing by zero when allocating
shipment cost. → *Correct, deterministic app behaviour* given the library inputs.
Going forward the founders should enter real Consort unit costs so the UK origin
prices normally; the workbook's package-price column has no equivalent in the app
and should not be recreated.

**3. Workbook Origin 1 (UK/Consort) landed calc is internally inconsistent —
excluded from the parity authority.** Its formulas (a) sum *all* package prices
from Door Register col H and mislabel the result a "Consort GBP invoice", (b) add
an FX **rate** cell (`D16`) into a column of **amounts**, and (c) reference a
`'N/A'` text cell inside the duty formula, which `IFERROR` silently swallows to
$0 duty. Per the established ruling ("the workbook is the parity authority only
where it is internally consistent"), Origin 1 is not a valid comparison target.
Only Origin 2 (USA), whose chain is clean, is used. → *Workbook internal
inconsistency, documented.*

**4. Duty base: workbook includes insurance + port; the app uses CIF = cost +
freight.** The workbook computes duty on `invoice + consolidator + ocean +
insurance + port` = $8,120.998, whereas the app computes duty on
`cif_basis = supplier_invoice + freight_export + ocean_freight` = $7,853.20, per
build plan §3.2 Step 2/3 and the §8.2 golden test (which enshrines CIF =
cost + freight — e.g. $5,100 = $4,500 + $600). The difference is exactly
`(8,120.998 − 7,853.20) × 55% = $147.29`. → *Ratified build-plan design decision,
not a bug.* Note the 55% rate is itself a **conservative planning buffer** (Order 1
actuals ran ~20.6% of CIF per §7.1 item 11), so a $147 base difference is well
inside the buffer. **Recommendation (founder decision, not blocking):** if the
founders want duty modelled on true CIF (which does include insurance), widen
`cif_basis` in the engine and re-baseline the §8.2 golden test — a contained,
one-line change in `lib/landed-cost/engine.ts`. Left as-is here because it matches
the current spec and the golden test.

**5. No margin / flat FX in the workbook client quote.** The workbook's Client
Quote tab shows hardware cost × 162 with no margin and no landed adder; the app
applies the selected margin tier and the 3% FX buffer (effective rate 166.86).
This is the intended app behaviour (§3 Steps 6–7, §7.1 items 4 & 8). → *Design
difference, documented.* Not comparable at the client-price line.

**6. Intra-group quantity variations that are cost-neutral.** Within HW02 two
doors (DD02, DA22) carry 1 hinge where the other ten carry 4; HW07's two doors
carry different package prices (259.20 vs 518.40, a single- vs double-leaf
terrace door). Because hinges and the HW07 items are all Consort $0, these do not
change any cost figure, and the app reproduces every door's itemized cost exactly.
The one intra-group variation that *does* affect cost (HW11 single- vs double-leaf,
$194.40 vs $388.80) is modelled with two sets so both doors match. → *No delta.*

---

## Data classification summary

| Delta | Layer | Root cause | Class | Action |
|---|---|---|---|---|
| $9,672.60 door-total inflation | door `AD` | package price double-added to itemized | workbook inconsistency | documented |
| UK origin $0 / skipped | origin | Consort priced $0 in library | correct app behaviour | documented |
| Origin-1 landed nonsense | origin | mixed FX/amount + `N/A` formula bugs | workbook inconsistency | excluded |
| $147.29 duty | duty base | app CIF = cost+freight (spec/golden); wb adds ins.+port | design decision | documented; optional future change |
| client-price divergence | client price | wb has no margin, flat FX | design decision | documented |

**No app/engine bug was found. No engine code was changed.**

---

## Reproducing / cleaning up

- **Run:** `npx tsx scripts/parity-test.mts` — idempotent; deletes and recreates
  only its own data (company *"PARITY TEST — Workbook"*, project *"Parity:
  Veridan_Quote_Template.xlsx"*, and library rows prefixed `[PARITY]`). It never
  touches other rows.
- **Inspect in the admin UI:** the parity project is left in the database after a
  run so the founders can open it (`/admin/projects/…` → its quote).
- **Delete it:** `npx tsx scripts/parity-test.mts --cleanup`.
- **Regression:** `lib/landed-cost/parity.test.ts` locks the USA/Origin-2 chain
  and the zero-value-origin guard into `npm test`, so a future engine change that
  drifts from the validated numbers turns the suite red.
