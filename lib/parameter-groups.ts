/**
 * Logical grouping for the `/admin/parameters` UI (Task 6). Keys must
 * match `business_parameters.key` exactly as seeded in
 * supabase/migrations/20260713000003_seed_parameters.sql. Any key present
 * in the table but not listed here still renders, under "Other" — this
 * keeps the page from silently dropping a parameter if the seed changes.
 */
export const PARAMETER_GROUPS: { label: string; keys: string[] }[] = [
  {
    label: "Costing",
    keys: [
      "duty_gct_pct",
      "marine_insurance_pct",
      "brokerage_first_pallet_usd",
      "brokerage_addl_pallet_usd",
      "port_handling_usd",
      "freight_insurance_fallback_usd",
      "procurement_handling_fee_usd",
      "contingency_pct",
      "margin_tiers",
      "margin_floor_pct",
      "min_order_value_usd",
    ],
  },
  {
    label: "FX",
    keys: ["fx_bank_sell_rate_usd_jmd", "fx_risk_buffer_pct", "supplier_fx_rates"],
  },
  {
    label: "Quoting",
    keys: [
      "deposit_standard_pct",
      "quote_validity_days",
      "default_finish",
      "lead_times",
    ],
  },
  {
    label: "Invoicing",
    keys: ["gct_enabled", "gct_rate_pct"],
  },
  {
    label: "Company Details",
    keys: ["company_details"],
  },
];
