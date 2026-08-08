/**
 * Pure logic shared by every admin "create a new X" dropdown affordance
 * (founder feedback 2026-08-07: "I would have liked the option for
 * creating new type to be included at the end of the dropdown list, same
 * thing with the option to create a new company ... same thing for New
 * Items group under the products tab, and this may occur elsewhere ... I
 * think it would be better at the end of the drop down list when
 * clicked."). The actual <select> + inline-create-panel UI lives in
 * components/admin/CreatableSelect.tsx; this module holds the two bits of
 * logic worth unit-testing in isolation from React:
 *
 *  - the sentinel value used for the trailing "+ Create new …" option, and
 *    the predicate that recognizes it. It's a magic string rather than
 *    (say) an empty string so it can never collide with a real managed
 *    option's value — those are either UUIDs (company/item-group ids) or
 *    derived snake_case names (taxonomy values), and a blank value is
 *    already meaningful on several of these pickers ("— none —",
 *    "— ungrouped —").
 *  - merging a locally-created (optimistic) entry into the server-provided
 *    managed list, used by every quick-create picker (company type,
 *    product category, item group, article category, expense category,
 *    company) so an entity created moments ago is immediately selectable
 *    without waiting on the next server round-trip/revalidation.
 */

export const CREATE_NEW_OPTION_VALUE = "__creatable_select_create_new__";

/** True when a <select> onChange event fired for the trailing "+ Create new …" option. */
export function isCreateNewOptionValue(value: string): boolean {
  return value === CREATE_NEW_OPTION_VALUE;
}

/**
 * Merges locally-created entries (created via an inline quick-create
 * during this form session, before the next server round-trip refreshes
 * the managed list) into the server-provided list, keyed by `id`.
 * Server-provided entries always win on an id collision — once the real
 * list catches up, the locally-tracked optimistic copy would otherwise
 * render as a duplicate.
 */
export function mergeLocallyCreated<T extends { id: string }>(managed: T[], locallyCreated: T[]): T[] {
  const knownIds = new Set(managed.map((m) => m.id));
  return [...managed, ...locallyCreated.filter((c) => !knownIds.has(c.id))];
}
