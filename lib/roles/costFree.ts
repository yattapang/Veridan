/**
 * The server→client cost boundary.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Hiding a cost at RENDER time hides nothing. A Client Component's props are
 * serialised by React into the RSC flight payload — the `self.__next_f.push(...)`
 * script tags in the HTML document itself. So this:
 *
 *     <ProductListItem product={product} showCosts={false} />   // ❌
 *
 * ships every column of `product` — `unit_cost`, `cost_currency`, the lot — to a
 * staff member's browser in plain text, whatever the component then chooses to
 * render. Ctrl-U, Ctrl-F "unit_cost", and the supplier cost book is on screen.
 *
 * The only thing that works is never putting the value in the props at all: the
 * server maps each row to a cost-free DTO BEFORE the client boundary, and the
 * client component's prop type is narrow enough that a raw row cannot be passed
 * to it by accident.
 *
 * `NoCostFields` is the compile-time half of that. A DTO that extends it cannot
 * hold any of the field names below — `unit_cost: number` is not assignable to
 * `unit_cost?: never` — so a future edit that "just passes the whole row through"
 * fails `tsc` instead of quietly re-opening the hole. `findCostFields` is the
 * runtime half, used by the tests to walk an actual serialised DTO and prove no
 * cost key survives at any depth.
 *
 * Pure and dependency-free (no `server-only`) so a client component can import
 * the TYPES from here and the tests can import the helpers.
 */

/**
 * Every column name in this schema that carries a supplier cost, a landed-cost
 * build-up, or a margin. Sourced from lib/supabase/types.ts:
 *
 *   products / quote_line_items ... unit_cost, cost_currency, unit_cost_usd
 *   quote_line_items ............. line_value_usd, allocated_shipment_cost_usd,
 *                                  landed_cost_usd, margin_pct_override
 *   hardware_set_line_items ...... unit_cost_override, cost_currency_override
 *   quotes ....................... total_landed_usd, margin_pct
 *   quote_origins ................ supplier_invoice_total
 *   override_log ................. requested_margin_pct, quoted_price_usd
 *   product_price_history ........ unit_cost, cost_currency (above)
 *   actual_costs ................. amount, amount_usd
 *
 * CLIENT PRICE fields (`total_client_usd`, `clientPriceUsd`, `client_price_jmd`
 * …) are deliberately NOT here: what the customer is charged is exactly the part
 * of a quote a staff member is supposed to work with. It is the COST side, and
 * therefore the margin between them, that is founder-only.
 */
export const COST_FIELD_NAMES = [
  "unit_cost",
  "cost_currency",
  "unit_cost_usd",
  "line_value_usd",
  "allocated_shipment_cost_usd",
  "landed_cost_usd",
  "margin_pct",
  "margin_pct_override",
  "unit_cost_override",
  "cost_currency_override",
  "total_landed_usd",
  "supplier_invoice_total",
  "requested_margin_pct",
  "quoted_price_usd",
  "amount_usd",
] as const;

export type CostFieldName = (typeof COST_FIELD_NAMES)[number];

/**
 * Mix into any DTO that crosses into a Client Component on a staff-reachable
 * page. Declaring each cost field as `?: never` makes a row that actually HAS
 * that field structurally unassignable, so the mistake is a compile error rather
 * than a convention someone has to remember.
 */
export type NoCostFields = {
  readonly [K in CostFieldName]?: never;
};

const COST_FIELD_SET: ReadonlySet<string> = new Set<string>(COST_FIELD_NAMES);

/**
 * Walks an already-built props object the way React's serialiser would and
 * returns the path of every cost-named key it finds — `[]` means the value is
 * safe to hand to a Client Component for a staff viewer.
 *
 * Recurses through plain objects and arrays (cycle-safe), because the leak this
 * guards against is never at the top level: it is a whole row nested three deep
 * inside an otherwise innocuous-looking prop.
 */
export function findCostFields(value: unknown, path = "props"): string[] {
  return walk(value, path, new Set<object>());
}

function walk(value: unknown, path: string, seen: Set<object>): string[] {
  if (value === null || typeof value !== "object") return [];
  if (seen.has(value as object)) return [];
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.flatMap((item, i) => walk(item, `${path}[${i}]`, seen));
  }

  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (COST_FIELD_SET.has(key)) found.push(childPath);
    found.push(...walk(child, childPath, seen));
  }
  return found;
}

/**
 * Assertion form of `findCostFields`, for use in tests and in any future
 * defence-in-depth check. Throws with every offending path listed, because
 * "something leaked" is useless next to "props.costs.row.unit_cost leaked".
 */
export function assertCostFree(value: unknown, what = "value"): void {
  const leaks = findCostFields(value, what);
  if (leaks.length > 0) {
    throw new Error(
      `${what} would ship cost data to the client (RSC flight payload): ${leaks.join(", ")}`
    );
  }
}
