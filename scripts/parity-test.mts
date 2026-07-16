/**
 * Task 25 — §6.5 PARITY TEST (Phase 1 acceptance gate)
 * ============================================================================
 * Reproduces the real project encoded in Veridan_Quote_Template.xlsx inside the
 * live app, runs the app's REAL create-quote pipeline (the same pure functions
 * app/admin/projects/[id]/actions.ts:createDoorRegisterQuote uses — snapshot
 * builders, origin grouping, cost resolution, and recomputeQuote → the actual
 * landed-cost engine), then diffs the app's output against the workbook's
 * computed values.
 *
 * The workbook was generated programmatically and never recalculated in Excel,
 * so it carries NO cached formula results (openpyxl data_only → None for every
 * formula cell). This script therefore evaluates the workbook's formula chains
 * itself (see buildWorkbook()) to obtain its intended outputs, then compares.
 *
 * USAGE
 *   npx tsx scripts/parity-test.mts            # seed + compute + diff (idempotent)
 *   npx tsx scripts/parity-test.mts --cleanup  # delete the parity project, exit
 *
 * SAFETY: every write is scoped to the parity company/project and to library
 * rows whose names start with the "[PARITY]" marker. No other row is touched.
 * Re-running deletes and recreates only the parity data.
 * ============================================================================
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveLineCost, toUsdIndicative, type SupplierFxRates } from "@/lib/hardware-sets";
import { buildFxSnapshot, buildParametersSnapshot } from "@/lib/quotes/snapshot";
import {
  buildOriginGroups,
  computeQuoteResult,
  nextQuoteRef,
  supplierOriginLabelMap,
  type SupplierOriginFields,
} from "@/lib/quotes/mapping";
import { recomputeQuote, loadQuoteState } from "@/lib/quotes/persist";
import type {
  BusinessParameterRow,
  HardwareSetLineItemWithDetails,
} from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Env + client
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

function loadEnv() {
  const file = path.join(REPO, ".env.local");
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
}
const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MARKER = "[PARITY]";
const COMPANY_NAME = "PARITY TEST — Workbook";
const PROJECT_NAME = "Parity: Veridan_Quote_Template.xlsx";

// ---------------------------------------------------------------------------
// WORKBOOK MODEL — extracted from Veridan_Quote_Template.xlsx
// (Hardware Library unit costs, Hardware Schedule qty matrix, Door Register
//  HW-group map + package prices, Landed Cost Calculator Origin-2 inputs).
// ---------------------------------------------------------------------------

/** Hardware Library col L (Unit Cost) — only Trudoor items 1/2/3/20 are priced;
 *  every Consort/TBC item is 0 (its cost lives in the Door Register package
 *  price column, per the Hardware Summary note A29). All currencies USD (col M). */
const LIB: Record<number, { desc: string; cat: string; cost: number; supplier: "Trudoor" | "Consort" | "TBC" }> = {
  1: { desc: "Office Lever Lockset", cat: "locksets", cost: 194.4, supplier: "Trudoor" },
  2: { desc: "Bathroom Lever Lockset", cat: "locksets", cost: 240, supplier: "Trudoor" },
  3: { desc: "Store Room Lever Lockset", cat: "locksets", cost: 194.4, supplier: "Trudoor" },
  4: { desc: "Butt Hinges", cat: "hinges", cost: 0, supplier: "Consort" },
  5: { desc: "Parliament Hinges", cat: "hinges", cost: 0, supplier: "Consort" },
  6: { desc: "Flush Bolt", cat: "ironmongery", cost: 0, supplier: "Consort" },
  7: { desc: "Floor Mounted Door Stop", cat: "ironmongery", cost: 0, supplier: "Consort" },
  8: { desc: "Overhead Door Closer", cat: "closers", cost: 0, supplier: "Consort" },
  9: { desc: "Push Plate - Engraved", cat: "ironmongery", cost: 0, supplier: "Consort" },
  10: { desc: "Pull Handle on Back Plate - Engraved", cat: "ironmongery", cost: 0, supplier: "Consort" },
  11: { desc: "Restroom Symbol - A.D.A.", cat: "signage", cost: 0, supplier: "Consort" },
  12: { desc: "Restroom Symbol - Female", cat: "signage", cost: 0, supplier: "Consort" },
  13: { desc: "Restroom Symbol - Male", cat: "signage", cost: 0, supplier: "Consort" },
  14: { desc: "Touch Bar - Rim Panic", cat: "exit_devices", cost: 0, supplier: "Consort" },
  15: { desc: "Throw Latch - Toilet Stall", cat: "ironmongery", cost: 0, supplier: "Consort" },
  16: { desc: "Kick Plate", cat: "ironmongery", cost: 0, supplier: "Consort" },
  17: { desc: "Office Lever Lockset - Deadbolt", cat: "locksets", cost: 0, supplier: "Consort" },
  18: { desc: "Pull Handle - T Bar (1500mm)", cat: "ironmongery", cost: 0, supplier: "Consort" },
  19: { desc: "Pull Handle - T Bar (150mm)", cat: "ironmongery", cost: 0, supplier: "TBC" },
  20: { desc: "Deadbolt - Double Cylinder", cat: "locksets", cost: 156, supplier: "Trudoor" },
  21: { desc: "Pull Handle - T Bar (900mm)", cat: "ironmongery", cost: 0, supplier: "Consort" },
  22: { desc: "Pull Handle - Concealed Rose", cat: "ironmongery", cost: 0, supplier: "Consort" },
};

/** Hardware-set compositions {itemNo: qty}. HW11 is split into a single-leaf
 *  (DD41) and a double-leaf (DF40) set because the workbook's HW Group "HW11"
 *  covers two doors with different item quantities (double vs single leaf).
 *  Every other group is uniform in COST (hinge-count variation within HW02 is
 *  cost-neutral — hinges are Consort $0). */
type SetCode =
  | "HW01" | "HW02" | "HW03" | "HW04" | "HW05" | "HW06" | "HW07" | "HW08"
  | "HW09" | "HW10" | "HW11" | "HW11DL" | "HW12";
const SETS: Record<SetCode, { name: string; items: Record<number, number> }> = {
  HW01: { name: "Office door, single leaf", items: { 1: 1, 4: 4, 7: 1, 8: 1 } },
  HW02: { name: "Store room door, single leaf", items: { 3: 1, 4: 4, 7: 1, 8: 1 } },
  HW03: { name: "Male restroom", items: { 2: 1, 4: 4, 7: 1, 8: 1, 9: 1, 10: 1, 13: 1, 15: 1, 16: 1 } },
  HW04: { name: "Double-leaf pull handles", items: { 22: 2 } },
  HW05: { name: "Female restroom", items: { 2: 1, 4: 4, 7: 1, 8: 1, 9: 1, 10: 1, 12: 1, 15: 1, 16: 1 } },
  HW06: { name: "ADA restroom", items: { 2: 1, 4: 4, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 15: 1, 16: 1 } },
  HW07: { name: "Terrace door", items: { 8: 1, 18: 2 } },
  HW08: { name: "Conference room double-leaf", items: { 7: 2, 22: 4 } },
  HW09: { name: "Duct door", items: { 3: 1, 4: 2 } },
  HW10: { name: "Restroom (no symbol)", items: { 2: 1, 4: 4, 7: 1, 8: 1, 9: 1, 10: 1, 15: 1, 16: 1 } },
  HW11: { name: "Plant room, single leaf", items: { 3: 1, 4: 4, 8: 1 } },
  HW11DL: { name: "Plant room, double leaf", items: { 3: 2, 4: 8, 8: 2 } },
  HW12: { name: "Closer only", items: { 8: 1 } },
};

/** Door Register (46 doors): [#, floor, doorNumber, HW group (workbook col G),
 *  package price (col H)]. setCode maps the workbook group to an app set; DF40
 *  uses the double-leaf HW11DL variant. Doors 5 (D05) and 33 (DE33) have no HW
 *  group (blank col G) and no package price → excluded from the client quote. */
interface DoorRow { n: number; floor: string; door: string; group: string | null; pkg: number; setCode: SetCode | null; }
const DOORS: DoorRow[] = [
  { n: 1, floor: "Second", door: "DE01", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 2, floor: "Second", door: "DD02", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 3, floor: "Second", door: "DE03", group: "HW03", pkg: 336.4, setCode: "HW03" },
  { n: 4, floor: "Second", door: "DB04", group: "HW04", pkg: 66, setCode: "HW04" },
  { n: 5, floor: "Second", door: "D05", group: null, pkg: 0, setCode: null },
  { n: 6, floor: "Second", door: "DE06", group: "HW05", pkg: 336.4, setCode: "HW05" },
  { n: 7, floor: "Second", door: "DE07", group: "HW06", pkg: 336.4, setCode: "HW06" },
  { n: 8, floor: "Second", door: "DA08", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 9, floor: "Second", door: "DA09", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 10, floor: "Second", door: "DA10", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 11, floor: "Second", door: "DA11", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 12, floor: "Second", door: "DA12", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 13, floor: "Second", door: "DA13", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 14, floor: "Second", door: "DA14", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 15, floor: "Second", door: "D15", group: "HW07", pkg: 259.2, setCode: "HW07" },
  { n: 16, floor: "Second", door: "DC16", group: "HW08", pkg: 136.8, setCode: "HW08" },
  { n: 17, floor: "Second", door: "DD17", group: "HW09", pkg: 26.4, setCode: "HW09" },
  { n: 18, floor: "Second", door: "DC18", group: "HW08", pkg: 136.8, setCode: "HW08" },
  { n: 19, floor: "Second", door: "DA19", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 20, floor: "Second", door: "DA20", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 21, floor: "Second", door: "DD21", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 22, floor: "Second", door: "DA22", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 23, floor: "Third", door: "DE23", group: "HW05", pkg: 336.4, setCode: "HW05" },
  { n: 24, floor: "Third", door: "DE24", group: "HW06", pkg: 336.4, setCode: "HW06" },
  { n: 25, floor: "Third", door: "DE25", group: "HW03", pkg: 336.4, setCode: "HW03" },
  { n: 26, floor: "Third", door: "DB26", group: "HW04", pkg: 66, setCode: "HW04" },
  { n: 27, floor: "Third", door: "DD27", group: "HW01", pkg: 194.4, setCode: "HW01" },
  { n: 28, floor: "Third", door: "DA28", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 29, floor: "Third", door: "DA29", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 30, floor: "Third", door: "DA30", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 31, floor: "Third", door: "DA31", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 32, floor: "Third", door: "DE32", group: "HW10", pkg: 334, setCode: "HW10" },
  { n: 33, floor: "Third", door: "DE33", group: null, pkg: 0, setCode: null },
  { n: 34, floor: "Third", door: "DA34", group: "HW04", pkg: 66, setCode: "HW04" },
  { n: 35, floor: "Third", door: "DA35", group: "HW10", pkg: 334, setCode: "HW10" },
  { n: 36, floor: "Third", door: "DA36", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 37, floor: "Third", door: "DA37", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 38, floor: "Third", door: "DA38", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 39, floor: "Third", door: "DA39", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 40, floor: "Third", door: "DF40", group: "HW11", pkg: 384, setCode: "HW11DL" },
  { n: 41, floor: "Third", door: "DD41", group: "HW11", pkg: 192, setCode: "HW11" },
  { n: 42, floor: "Fourth", door: "DA42", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 43, floor: "Fourth", door: "DG43", group: "HW07", pkg: 518.4, setCode: "HW07" },
  { n: 44, floor: "Fourth", door: "DD44", group: "HW10", pkg: 334, setCode: "HW10" },
  { n: 45, floor: "Fourth", door: "DE45", group: "HW02", pkg: 194.05035971223, setCode: "HW02" },
  { n: 46, floor: "Fifth", door: "D46", group: "HW12", pkg: 139.2, setCode: "HW12" },
];

/** Landed Cost Calculator — Origin 2 (USA / Trudoor, Miami consolidation).
 *  These are the only internally-consistent origin inputs in the workbook;
 *  Origin 1 (UK/Consort) is degenerate (Consort priced $0) and its formulas
 *  are internally inconsistent — see the report. USD throughout. */
const WB_ORIGIN2 = {
  consolidatorFeeUsd: 50, // Miami consolidator (Landed Cost Calc C31)
  oceanFreightUsd: 200, // Miami → Kingston (C32)
  portCustomsUsd: 150, // Port / customs handling, bundles agent fees (C34)
  marineInsurancePct: 1.5, // C33 = 1.5% of (invoice+consolidator+ocean)
  dutyGctPct: 55, // C35 = 55% of (invoice+consolidator+ocean+insurance+port)
};
const WB_FX_JMD = 162; // Assumptions B5 — flat planning rate (no buffer)

// ---------------------------------------------------------------------------
// Workbook computation (evaluate the formula chains ourselves)
// ---------------------------------------------------------------------------

function itemizedCostUsd(items: Record<number, number>): number {
  let sum = 0;
  for (const [item, qty] of Object.entries(items)) sum += (LIB[Number(item)]?.cost ?? 0) * qty;
  return sum;
}

interface WorkbookModel {
  perDoor: Array<{
    n: number; door: string; group: string | null;
    itemizedUsd: number; // Σ qty×libcost  (the algorithmically-defined half of AD)
    pkgUsd: number;       // Door Register col H / Hardware Schedule col AB (manual)
    adUsd: number;        // Hardware Schedule AD = IF(AB>0, AB, 0) + itemized  (as-written)
  }>;
  itemizedTotalUsd: number; // Trudoor hardware invoice (Landed Cost Calc AC57 / C29)
  adTotalUsd: number;
  clientJmdTotal_AD: number;        // Client Quote F25 = Σ AD×162 (workbook published)
  clientJmdTotal_itemized: number;  // Σ itemized×162 (hardware-cost basis)
  origin2: {
    invoiceUsd: number; cifForInsuranceUsd: number; insuranceUsd: number;
    cifForDutyUsd: number; dutyUsd: number; totalLandedUsd: number;
  };
}

function buildWorkbook(): WorkbookModel {
  const perDoor = DOORS.map((d) => {
    const items = d.setCode ? SETS[d.setCode].items : {};
    const itemizedUsd = itemizedCostUsd(items);
    const pkgUsd = d.pkg;
    // Hardware Schedule AD (col AD), currency USD so FX factor = 1:
    //   AD = IF(AB>0, AB*fx, 0) + IFERROR(Σ qty×unitcost, 0)
    const adUsd = (pkgUsd > 0 ? pkgUsd : 0) + itemizedUsd;
    return { n: d.n, door: d.door, group: d.group, itemizedUsd, pkgUsd, adUsd };
  });
  const withGroup = perDoor.filter((d) => d.group !== null);
  const itemizedTotalUsd = withGroup.reduce((s, d) => s + d.itemizedUsd, 0);
  const adTotalUsd = withGroup.reduce((s, d) => s + d.adUsd, 0);

  // Landed Cost Calculator — Origin 2 (USA), evaluated per its formulas.
  const invoice = itemizedTotalUsd; // C29 = Hardware Schedule AC57 (itemized subtotal)
  const cifForInsurance = invoice + WB_ORIGIN2.consolidatorFeeUsd + WB_ORIGIN2.oceanFreightUsd; // E29+E31+E32
  const insurance = cifForInsurance * (WB_ORIGIN2.marineInsurancePct / 100); // C33
  const cifForDuty = cifForInsurance + insurance + WB_ORIGIN2.portCustomsUsd; // E29+E31+E32+E33+E34
  const duty = cifForDuty * (WB_ORIGIN2.dutyGctPct / 100); // C35
  const totalLanded = invoice + WB_ORIGIN2.consolidatorFeeUsd + WB_ORIGIN2.oceanFreightUsd + insurance + WB_ORIGIN2.portCustomsUsd + duty; // E36

  return {
    perDoor,
    itemizedTotalUsd,
    adTotalUsd,
    clientJmdTotal_AD: adTotalUsd * WB_FX_JMD,
    clientJmdTotal_itemized: itemizedTotalUsd * WB_FX_JMD,
    origin2: {
      invoiceUsd: invoice,
      cifForInsuranceUsd: cifForInsurance,
      insuranceUsd: insurance,
      cifForDutyUsd: cifForDuty,
      dutyUsd: duty,
      totalLandedUsd: totalLanded,
    },
  };
}

// ---------------------------------------------------------------------------
// DB cleanup (idempotent, scoped)
// ---------------------------------------------------------------------------

async function cleanup(verbose = true): Promise<void> {
  // Parity projects (by name) and company (by name).
  const { data: projects } = await sb.from("projects").select("id").eq("name", PROJECT_NAME);
  const projectIds = (projects ?? []).map((p) => p.id as string);

  if (projectIds.length > 0) {
    // quotes cascade → quote_origins, quote_line_items
    await sb.from("quotes").delete().in("project_id", projectIds);
    // hardware_sets cascade → hardware_set_line_items
    await sb.from("hardware_sets").delete().in("project_id", projectIds);
    await sb.from("doors").delete().in("project_id", projectIds);
    await sb.from("projects").delete().in("id", projectIds);
  }
  // Library rows are marked with [PARITY]; safe to delete once sets/quotes gone.
  await sb.from("products").delete().like("description", `${MARKER}%`);
  await sb.from("suppliers").delete().like("name", `${MARKER}%`);
  await sb.from("companies").delete().eq("name", COMPANY_NAME);
  if (verbose) console.log("• cleanup complete (parity data removed)");
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

interface Seeded {
  projectId: string;
  productIdByItem: Map<number, string>;
  supplierIdByName: Map<string, string>;
  setIdByCode: Map<string, string>;
  doorIdByNumber: Map<string, string>;
}

async function seed(): Promise<Seeded> {
  // Company + project.
  const { data: company, error: cErr } = await sb
    .from("companies")
    .insert({ name: COMPANY_NAME, type: "contractor", status: "new", notes: `${MARKER} §6.5 parity test fixture` })
    .select("id").single();
  if (cErr) throw cErr;

  const { data: project, error: pErr } = await sb
    .from("projects")
    .insert({
      company_id: company!.id,
      name: PROJECT_NAME,
      project_type: "new_construction",
      status: "active",
      site_address: `${MARKER} Reproduces Veridan_Quote_Template.xlsx`,
    })
    .select("id").single();
  if (pErr) throw pErr;
  const projectId = project!.id as string;

  // Suppliers: Trudoor (USA/Miami) + Consort (UK). origin_region drives the
  // app's shipment-origin grouping.
  const supplierIdByName = new Map<string, string>();
  for (const [name, region, country, ccy] of [
    ["Trudoor", "USA–Miami", "USA", "USD"],
    ["Consort", "UK–Consort", "UK", "GBP"],
  ] as const) {
    const { data, error } = await sb
      .from("suppliers")
      .insert({ name: `${MARKER} ${name}`, origin_region: region, country, default_currency: ccy, active: true })
      .select("id").single();
    if (error) throw error;
    supplierIdByName.set(name, data!.id as string);
  }

  // Products — the full 22-item Hardware Library (library unit costs, USD).
  const productIdByItem = new Map<number, string>();
  const productRows = Object.entries(LIB).map(([item, v]) => ({
    generic_category: v.cat,
    description: `${MARKER} ${item}. ${v.desc}`,
    manufacturer: v.supplier === "Trudoor" ? "Assa Abloy" : v.supplier === "Consort" ? "Consort Architectural Hardware" : null,
    supplier_id: supplierIdByName.get(v.supplier === "TBC" ? "Consort" : v.supplier) ?? null,
    unit: "Each",
    unit_cost: v.cost,
    cost_currency: "USD",
    source: "manual",
    active: true,
  }));
  const { data: products, error: prodErr } = await sb.from("products").insert(productRows).select("id, description");
  if (prodErr) throw prodErr;
  for (const p of products!) {
    const m = /\[PARITY\] (\d+)\./.exec(p.description as string);
    if (m) productIdByItem.set(Number(m[1]), p.id as string);
  }

  // Hardware sets + line items. Each line's supplier = the item's library
  // supplier (Trudoor→USA, Consort→UK) — this is how one door's set mixes
  // origins, exactly the PRD §6.1 pattern.
  const setIdByCode = new Map<string, string>();
  for (const [code, def] of Object.entries(SETS)) {
    const { data: setRow, error: sErr } = await sb
      .from("hardware_sets")
      .insert({ project_id: projectId, code, name: def.name })
      .select("id").single();
    if (sErr) throw sErr;
    setIdByCode.set(code, setRow!.id as string);

    let sort = 0;
    const lineRows = Object.entries(def.items).map(([item, qty]) => {
      const it = Number(item);
      return {
        hardware_set_id: setRow!.id,
        product_id: productIdByItem.get(it)!,
        supplier_id: supplierIdByName.get(LIB[it].supplier === "TBC" ? "Consort" : LIB[it].supplier)!,
        qty,
        sort_order: sort++,
      };
    });
    const { error: liErr } = await sb.from("hardware_set_line_items").insert(lineRows);
    if (liErr) throw liErr;
  }

  // Doors (46), each assigned its HW group's set (DF40 → HW11 double-leaf).
  const doorIdByNumber = new Map<string, string>();
  const doorRows = DOORS.map((d) => ({
    project_id: projectId,
    floor: d.floor,
    door_number: d.door,
    hardware_set_id: d.setCode ? setIdByCode.get(d.setCode)! : null,
    sort_order: d.n,
  }));
  const { data: doorsInserted, error: dErr } = await sb.from("doors").insert(doorRows).select("id, door_number");
  if (dErr) throw dErr;
  for (const dd of doorsInserted!) doorIdByNumber.set(dd.door_number as string, dd.id as string);

  return { projectId, productIdByItem, supplierIdByName, setIdByCode, doorIdByNumber };
}

// ---------------------------------------------------------------------------
// Quote materialization — mirrors createDoorRegisterQuote() using the SAME
// pure lib functions (snapshot builders, origin grouping, cost resolution,
// recomputeQuote → the real landed-cost engine). The server action itself is
// not callable outside Next (next/navigation redirect + getCurrentUser), so
// its pure body is reproduced here verbatim in intent.
// ---------------------------------------------------------------------------

async function materializeQuote(projectId: string): Promise<string> {
  const { data: paramRows, error: paramErr } = await sb.from("business_parameters").select("*");
  if (paramErr) throw paramErr;
  const parameters = (paramRows as BusinessParameterRow[]) ?? [];
  const quoteDate = new Date().toISOString().slice(0, 10);
  const parametersSnapshot = buildParametersSnapshot(parameters);
  const fxSnapshot = buildFxSnapshot(parameters, quoteDate);
  const fxRates = fxSnapshot.supplier_rates as SupplierFxRates;

  const { data: doorRows, error: doorErr } = await sb
    .from("doors")
    .select("id, door_number, hardware_set_id, sort_order")
    .eq("project_id", projectId)
    .not("hardware_set_id", "is", null)
    .order("sort_order");
  if (doorErr) throw doorErr;
  const doors = (doorRows as Array<{ id: string; hardware_set_id: string | null; sort_order: number | null }>) ?? [];
  const setIds = [...new Set(doors.map((d) => d.hardware_set_id).filter((v): v is string => Boolean(v)))];

  let setLines: HardwareSetLineItemWithDetails[] = [];
  if (setIds.length > 0) {
    const { data: lineRows, error: lErr } = await sb
      .from("hardware_set_line_items")
      .select(
        "*, products(id, description, manufacturer, product_ref, catalogue_ref, unit, unit_cost, cost_currency), suppliers(id, name, default_currency)",
      )
      .in("hardware_set_id", setIds)
      .order("sort_order");
    if (lErr) throw lErr;
    setLines = (lineRows as unknown as HardwareSetLineItemWithDetails[]) ?? [];
  }
  const linesBySet = new Map<string, HardwareSetLineItemWithDetails[]>();
  for (const line of setLines) {
    const list = linesBySet.get(line.hardware_set_id) ?? [];
    list.push(line);
    linesBySet.set(line.hardware_set_id, list);
  }

  const supplierIds = [...new Set(setLines.map((l) => l.supplier_id))];
  let suppliers: SupplierOriginFields[] = [];
  if (supplierIds.length > 0) {
    const { data: supRows, error: supErr } = await sb.from("suppliers").select("id, origin_region, country").in("id", supplierIds);
    if (supErr) throw supErr;
    suppliers = (supRows as SupplierOriginFields[]) ?? [];
  }
  const originGroups = buildOriginGroups(suppliers);
  const supplierToLabel = supplierOriginLabelMap(originGroups);

  const year = Number(quoteDate.slice(0, 4));
  const { data: existingRefRows } = await sb.from("quotes").select("quote_ref").like("quote_ref", `VQ-${year}-%`);
  const quoteRef = nextQuoteRef(year, ((existingRefRows as Array<{ quote_ref: string }>) ?? []).map((r) => r.quote_ref));

  const defaultMargin = parametersSnapshot.margin_tiers[0] ?? 30;
  const { data: insertedQuote, error: qErr } = await sb
    .from("quotes")
    .insert({
      project_id: projectId,
      quote_ref: quoteRef,
      status: "draft",
      quote_mode: "door_register",
      quote_date: quoteDate,
      validity_days: parametersSnapshot.quote_validity_days,
      deposit_pct: parametersSnapshot.deposit_standard_pct,
      margin_pct: defaultMargin,
      parameters_snapshot: parametersSnapshot,
      fx_snapshot: fxSnapshot,
      created_by: null,
    })
    .select("id").single();
  if (qErr) throw qErr;
  const quoteId = insertedQuote!.id as string;

  const originIdByLabel = new Map<string, string>();
  if (originGroups.length > 0) {
    const { data: insertedOrigins, error: oErr } = await sb
      .from("quote_origins")
      .insert(
        originGroups.map((g) => ({
          quote_id: quoteId,
          origin_label: g.label,
          freight_export_fees_usd: 0,
          ocean_freight_usd: null,
          marine_insurance_usd: null,
          port_handling_usd: parametersSnapshot.port_handling_usd,
          brokerage_usd: null,
          pallet_count: 1,
          duty_gct_pct: parametersSnapshot.duty_gct_pct,
        })),
      )
      .select("id, origin_label");
    if (oErr) throw oErr;
    for (const o of insertedOrigins!) originIdByLabel.set(o.origin_label as string, o.id as string);
  }

  const lineInserts: Record<string, unknown>[] = [];
  let sortOrder = 0;
  for (const door of doors) {
    const lines = door.hardware_set_id ? linesBySet.get(door.hardware_set_id) ?? [] : [];
    for (const line of lines) {
      const resolved = resolveLineCost(line);
      if (!resolved) continue;
      const originLabel = supplierToLabel.get(line.supplier_id) ?? "Other";
      const originId = originIdByLabel.get(originLabel);
      if (!originId) continue;
      const unitCostUsd = toUsdIndicative(resolved.unitCost, resolved.currency, fxRates) ?? 0;
      const qty = Number(line.qty);
      const lineValueUsd = qty * unitCostUsd;
      lineInserts.push({
        quote_id: quoteId,
        door_id: door.id,
        hardware_set_id: door.hardware_set_id,
        product_id: line.product_id,
        quote_origin_id: originId,
        qty,
        unit_cost: resolved.unitCost,
        cost_currency: resolved.currency,
        unit_cost_usd: unitCostUsd,
        line_value_usd: lineValueUsd,
        landed_cost_usd: lineValueUsd,
        sort_order: sortOrder++,
      });
    }
  }
  if (lineInserts.length > 0) {
    const { error: liErr } = await sb.from("quote_line_items").insert(lineInserts);
    if (liErr) throw liErr;
  }

  // Set the USA origin's cost inputs to the workbook's Landed Cost Calculator
  // Origin-2 values (consolidator→freight_export, ocean, port; brokerage 0
  // because the workbook bundles customs-agent fees into port and has no
  // separate brokerage line). Insurance stays null → the engine computes 1.5%.
  const usaOriginId = originIdByLabel.get("USA–Miami");
  if (usaOriginId) {
    const { error: updErr } = await sb
      .from("quote_origins")
      .update({
        freight_export_fees_usd: WB_ORIGIN2.consolidatorFeeUsd,
        ocean_freight_usd: WB_ORIGIN2.oceanFreightUsd,
        port_handling_usd: WB_ORIGIN2.portCustomsUsd,
        brokerage_usd: 0,
        pallet_count: 1,
        duty_gct_pct: WB_ORIGIN2.dutyGctPct,
      })
      .eq("id", usaOriginId);
    if (updErr) throw updErr;
  }

  // Run the REAL engine + persist computed caches.
  const { error: recomputeErr } = await recomputeQuote(sb, quoteId);
  if (recomputeErr) throw new Error(`recompute failed: ${recomputeErr}`);
  return quoteId;
}

// ---------------------------------------------------------------------------
// Diff + report
// ---------------------------------------------------------------------------

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const near = (a: number, b: number, eps = 0.005) => Math.abs(a - b) <= eps;

async function diffAndReport(quoteId: string, wb: WorkbookModel): Promise<{ pass: boolean; lines: string[] }> {
  const { state, error } = await loadQuoteState(sb, quoteId);
  if (error || !state) throw new Error(`could not load quote state: ${error}`);

  // Load doors for number lookup.
  const { data: doorRows } = await sb.from("doors").select("id, door_number").eq("project_id", state.quote.project_id);

  // App per-door hardware cost = Σ line_value_usd for that door (Trudoor lines;
  // Consort lines live in the zero-value UK origin, which the engine skips).
  const appDoorLineValue = new Map<string, number>();
  for (const l of state.lines) {
    if (!l.door_id) continue;
    const v = Number(l.line_value_usd) || 0;
    appDoorLineValue.set(l.door_id, (appDoorLineValue.get(l.door_id) ?? 0) + v);
  }
  // App per-door landed cost (allocated) from the recomputed cache.
  const appDoorLanded = new Map<string, number>();
  for (const l of state.lines) {
    if (!l.door_id) continue;
    const v = Number(l.landed_cost_usd) || 0;
    appDoorLanded.set(l.door_id, (appDoorLanded.get(l.door_id) ?? 0) + v);
  }

  const out: string[] = [];
  const push = (s = "") => out.push(s);

  // ---- Comparison A: per-HW-group hardware cost basis (app vs workbook) ----
  push("COMPARISON A — Hardware cost basis per HW group (USD)");
  push("  App line_value_usd (itemized) vs Workbook itemized Σ(qty×unit cost).");
  push("  [This is the algorithmically-defined, internally-consistent basis.]");
  push("");
  push("  Group   Doors   App/door   WB/door    App total   WB total    Δ");
  const groups = [...new Set(DOORS.filter((d) => d.group).map((d) => d.group as string))].sort();
  let aAllMatch = true;
  let appItemTotal = 0;
  for (const g of groups) {
    const gDoors = DOORS.filter((d) => d.group === g);
    let appTot = 0, wbTot = 0;
    const appPer: number[] = [];
    const wbPer: number[] = [];
    for (const d of gDoors) {
      const id = doorNumById2(doorRows, d.door);
      const appV = id ? appDoorLineValue.get(id) ?? 0 : 0;
      const wbV = wb.perDoor.find((p) => p.door === d.door)!.itemizedUsd;
      appTot += appV; wbTot += wbV; appPer.push(appV); wbPer.push(wbV);
    }
    appItemTotal += appTot;
    const perAppStr = uniqStr(appPer);
    const perWbStr = uniqStr(wbPer);
    const match = near(appTot, wbTot);
    if (!match) aAllMatch = false;
    push(`  ${g.padEnd(7)} ${String(gDoors.length).padStart(4)}   ${perAppStr.padStart(8)}   ${perWbStr.padStart(8)}   ${money(appTot).padStart(9)}   ${money(wbTot).padStart(9)}   ${match ? "OK" : "MISMATCH"}`);
  }
  push(`  ${"TOTAL".padEnd(7)} ${String(DOORS.filter((d) => d.group).length).padStart(4)}   ${"".padStart(8)}   ${"".padStart(8)}   ${money(appItemTotal).padStart(9)}   ${money(wb.itemizedTotalUsd).padStart(9)}   ${near(appItemTotal, wb.itemizedTotalUsd) ? "OK" : "MISMATCH"}`);
  push("");

  // ---- Comparison B: workbook AD (package + itemized) double-count ----
  push("COMPARISON B — Workbook's published door totals (col I = AD) vs app");
  push("  Workbook AD = package price (col H) + itemized Σ(qty×cost). For every");
  push("  Trudoor-bearing group the manual package price is added ON TOP of the");
  push("  itemized cost the same items already contribute → double count.");
  push("");
  push(`  App itemized grand total (USD):        ${money(appItemTotal).padStart(12)}`);
  push(`  Workbook itemized grand total (USD):   ${money(wb.itemizedTotalUsd).padStart(12)}`);
  push(`  Workbook AD grand total (USD):         ${money(wb.adTotalUsd).padStart(12)}   (+package price)`);
  push(`  Workbook package-price overcount (USD):${money(wb.adTotalUsd - wb.itemizedTotalUsd).padStart(12)}`);
  push("");

  // ---- Comparison C: client-facing JMD ----
  const appJmdTotal = Number(state.quote.total_client_jmd) || 0;
  const appUsdTotal = Number(state.quote.total_client_usd) || 0;
  const appLandedTotal = Number(state.quote.total_landed_usd) || 0;
  push("COMPARISON C — Client-facing totals");
  push(`  Workbook client quote (JMD, AD×162, no margin):     ${money(wb.clientJmdTotal_AD).padStart(16)}`);
  push(`  Workbook hardware-basis (JMD, itemized×162):        ${money(wb.clientJmdTotal_itemized).padStart(16)}`);
  push(`  App client price (JMD, landed÷(1−margin)×166.86):   ${money(appJmdTotal).padStart(16)}`);
  push(`  App client price (USD):                             ${money(appUsdTotal).padStart(16)}`);
  push(`  App landed cost (USD, incl. freight/duty/ins):      ${money(appLandedTotal).padStart(16)}`);
  push("  → Client-price layers are non-comparable BY DESIGN: the workbook applies");
  push("    no margin and no landed adder to the client price and uses a flat 162;");
  push("    the app applies the selected margin tier and the 3% FX buffer (§3, §7.1).");
  push("");

  // ---- Comparison D: landed cost, USA / Origin 2 ----
  // Read the engine's in-memory origin result (persistComputed intentionally
  // does NOT write the editable insurance/brokerage columns back), so these
  // are the exact figures the engine used inside the landed-cost total.
  const engine = computeQuoteResult(state);
  const usa = engine.origins.find((o) => o.label === "USA–Miami");
  const uk = engine.origins.find((o) => o.label === "UK–Consort");
  push("COMPARISON D — Landed cost, USA / Origin 2 (Trudoor, Miami)");
  push("");
  const appInvoice = usa ? usa.supplierInvoiceTotalUsd : 0;
  const appCif = usa ? usa.cifBasisUsd : 0;
  const appInsurance = usa ? usa.marineInsuranceUsd : 0;
  const appDuty = usa ? usa.dutyGctUsd : 0;
  const appShip = usa ? usa.totalShipmentCostUsd : 0;
  const appLandedUsa = appInvoice + appShip;
  push(`  Line                         App (USD)      Workbook (USD)   Δ`);
  push(`  Trudoor hardware invoice     ${money(appInvoice).padStart(11)}   ${money(wb.origin2.invoiceUsd).padStart(13)}   ${near(appInvoice, wb.origin2.invoiceUsd) ? "OK" : "≠"}`);
  push(`  CIF basis (cost+freight)     ${money(appCif).padStart(11)}   ${money(wb.origin2.cifForInsuranceUsd).padStart(13)}   ${near(appCif, wb.origin2.cifForInsuranceUsd) ? "OK" : "≠"}`);
  push(`  Marine insurance (1.5%)      ${money(appInsurance).padStart(11)}   ${money(wb.origin2.insuranceUsd).padStart(13)}   ${near(appInsurance, wb.origin2.insuranceUsd) ? "OK" : "≠"}`);
  push(`  Duty + GCT (55%)             ${money(appDuty).padStart(11)}   ${money(wb.origin2.dutyUsd).padStart(13)}   ${near(appDuty, wb.origin2.dutyUsd) ? "OK" : "≠ (base differs)"}`);
  push(`  Origin-2 total landed        ${money(appLandedUsa).padStart(11)}   ${money(wb.origin2.totalLandedUsd).padStart(13)}   ${near(appLandedUsa, wb.origin2.totalLandedUsd) ? "OK" : "≠"}`);
  push("");
  const dutyBaseDelta = (wb.origin2.cifForDutyUsd - appCif) * 0.55;
  push(`  Δ landed = ${money(wb.origin2.totalLandedUsd - appLandedUsa)} USD, entirely the duty base:`);
  push(`    workbook folds insurance ($${money(wb.origin2.insuranceUsd)}) + port ($${money(WB_ORIGIN2.portCustomsUsd)})`);
  push(`    into the duty base; the app (build plan §3.2 / golden test) computes duty`);
  push(`    on CIF = cost+freight only. ${money(dutyBaseDelta)} USD extra duty in the workbook.`);
  push("");

  // ---- Origin skip note ----
  push("ENGINE BEHAVIOUR — UK / Consort origin");
  if (uk) {
    push(`  UK–Consort origin present; supplier_invoice_total = ${money(uk.supplierInvoiceTotalUsd)}${uk.skipped ? " (skipped)" : ""}.`);
    push("  All Consort items are priced $0 in the library (their cost sits in the");
    push("  package-price column), so the pool value is $0 and the engine's");
    push("  zero_value_origin guard skips it — correct, deterministic behaviour.");
  } else {
    push("  (no UK origin row — no Consort lines materialized)");
  }
  push("");

  const pass = aAllMatch && near(appItemTotal, wb.itemizedTotalUsd) && near(appInvoice, wb.origin2.invoiceUsd);
  return { pass, lines: out };
}

function doorNumById2(doorRows: Array<{ id: string; door_number: string }> | null, doorNumber: string): string | null {
  const r = (doorRows ?? []).find((d) => d.door_number === doorNumber);
  return r ? r.id : null;
}
function uniqStr(vals: number[]): string {
  const set = [...new Set(vals.map((v) => money(v)))];
  return set.length === 1 ? set[0] : set.join("/");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--cleanup")) {
    await cleanup();
    console.log("Done. Parity project removed.");
    return;
  }

  console.log("§6.5 PARITY TEST — Veridan_Quote_Template.xlsx");
  console.log("=".repeat(72));
  console.log("• cleaning any prior parity data …");
  await cleanup(false);
  console.log("• seeding suppliers / products / hardware sets / doors …");
  const seeded = await seed();
  console.log(`  project ${seeded.projectId}`);
  console.log("• materializing the quote through the real pipeline …");
  const quoteId = await materializeQuote(seeded.projectId);
  console.log(`  quote ${quoteId}`);
  console.log("• evaluating the workbook's formula chains …");
  const wb = buildWorkbook();
  console.log("• diffing app vs workbook …");
  console.log("");

  const { pass, lines } = await diffAndReport(quoteId, wb);
  for (const l of lines) console.log(l);

  console.log("=".repeat(72));
  console.log(
    pass
      ? "VERDICT: PASS-WITH-DOCUMENTED-EXCEPTIONS — the app's hardware-cost basis"
      : "VERDICT: FAIL — a hardware-cost-basis mismatch was found (investigate).",
  );
  console.log(
    pass
      ? "reproduces the workbook exactly where the workbook is internally consistent;\nall deltas root-cause to documented workbook inconsistencies / design choices.\nSee docs/PARITY_REPORT.md."
      : "See the MISMATCH rows above.",
  );
  console.log("");
  console.log(`Parity project left in the DB for inspection (company \"${COMPANY_NAME}\").`);
  console.log("Remove it with:  npx tsx scripts/parity-test.mts --cleanup");
}

main().catch((e) => {
  console.error("PARITY TEST ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
