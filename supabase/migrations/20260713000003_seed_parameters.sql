-- ============================================================================
-- Veridan Limited — business_parameters seed
-- Source: Veridan_Build_Plan_v1.md Task 6 + PRD §7 (parameters table) +
-- §7.1 resolutions, which override anything contradictory in the PRD body.
--
-- Every row uses the `{"type": "...", "value": ...}` envelope described in
-- §1.14 so `value_type` and the payload's own "type" field agree. `table`
-- typed values (margin_tiers, supplier_fx_rates, lead_times) store their
-- structured payload directly under "value".
--
-- updated_by is left null on seed rows (no founder has edited them yet);
-- parameter_audit_log intentionally gets no rows here — the audit log only
-- records changes made after seeding, per §1.15.
-- ============================================================================

insert into public.business_parameters (key, value, value_type, description) values

-- Landed-cost formula inputs (§3, PRD §7)
('duty_gct_pct',
  '{"type":"numeric","value":55}'::jsonb,
  'percent',
  'Duty + GCT composite, % of CIF basis. Source: Plan A1 / workbook Assumptions sheet.'),

('marine_insurance_pct',
  '{"type":"numeric","value":1.5}'::jsonb,
  'percent',
  'Marine insurance, % of CIF basis, editable per shipment. Source: workbook Landed Cost Calculator.'),

('brokerage_first_pallet_usd',
  '{"type":"numeric","value":120}'::jsonb,
  'numeric',
  'Customs brokerage fee for the first pallet, USD. Formula: 120 + 50 x (pallet_count - 1). Source: Plan A3.'),

('brokerage_addl_pallet_usd',
  '{"type":"numeric","value":50}'::jsonb,
  'numeric',
  'Customs brokerage fee per additional pallet beyond the first, USD. Source: Plan A3.'),

('port_handling_usd',
  '{"type":"numeric","value":50}'::jsonb,
  'numeric',
  'Port storage/handling default per shipment, USD. PRD gives a $45-50 range (Plan A4); $50 is the canonical default resolved in §7.1 item 3, editable per shipment. Does not include customs-agent fees, which are entered as separate shipment-cost lines.'),

('freight_insurance_fallback_usd',
  '{"type":"numeric","value":1250}'::jsonb,
  'numeric',
  'Combined freight+insurance planning fallback per shipment, USD, used only until itemized freight lines and the 1.5% marine insurance formula are entered — superseded (not added) once those are itemized. Resolved §7.1 item 2. Source: workbook Assumptions sheet.'),

('procurement_handling_fee_usd',
  '{"type":"numeric","value":500}'::jsonb,
  'numeric',
  'Procurement & handling fee, flat per project, USD. Source: workbook Assumptions sheet.'),

('contingency_pct',
  '{"type":"numeric","value":5}'::jsonb,
  'percent',
  'Internal planning contingency, % (not client-facing). Source: workbook Assumptions sheet.'),

-- Margin tiers / floor (§6.3.4-5)
('margin_tiers',
  '{"type":"table","value":[30,35,40]}'::jsonb,
  'table',
  'Selectable margin tiers, %, applied per line item per quote (§7.1 item 8). Source: Plan A5, PRD §8.2.'),

('margin_floor_pct',
  '{"type":"numeric","value":20}'::jsonb,
  'percent',
  'Hard margin floor, %. Quoting below this requires an override_log entry with a reason. Source: Plan A5, PRD §8.2.'),

('min_order_value_usd',
  '{"type":"numeric","value":2000}'::jsonb,
  'numeric',
  'Minimum order value, USD. Source: Plan §4.1.'),

-- Deposit (§7.1 item 7 — CONFIRMED, manual override only, no auto-flip)
('deposit_standard_pct',
  '{"type":"numeric","value":60}'::jsonb,
  'percent',
  '60% deposit standard for all quotes. Reductions (e.g. 50% for established clients) are a manual founder override per client/quote at quote creation — there is no automatic flip based on company status. Resolved 2026-07-12, PRD §7 / v3.1 Amendment 4.'),

-- Quote terms
('quote_validity_days',
  '{"type":"numeric","value":15}'::jsonb,
  'numeric',
  'Quote validity period, days, copied onto each quote at creation. Source: workbook Assumptions sheet.'),

('default_finish',
  '{"type":"text","value":"Satin Stainless Steel (US32D)"}'::jsonb,
  'text',
  'Default supplied finish when a product does not specify one. Source: workbook Assumptions sheet.'),

-- FX (§7.1 items 1, 4, 9 — CIBC Caribbean bank sell rate is authoritative, not BOJ)
('fx_bank_sell_rate_usd_jmd',
  '{"type":"numeric","value":162}'::jsonb,
  'numeric',
  'CIBC Caribbean USD->JMD bank sell rate. PLACEHOLDER seeded from the workbook (162) — the founders must check/update this from the live CIBC Caribbean rate before running any real quote; there is no scheduled fetch in Phase 1 (PRD §12.2).'),

('fx_risk_buffer_pct',
  '{"type":"numeric","value":3}'::jsonb,
  'percent',
  'FX risk buffer, % added on top of the bank sell rate for client-facing JMD amounts. effective_rate = bank_sell_rate * (1 + fx_risk_buffer_pct/100). CONFIRMED founder decision, 2026-07-12 (§7.1 item 4, PRD §13 item 3).'),

('supplier_fx_rates',
  '{"type":"table","value":{"USD":1,"CAD":0.74,"GBP":1.27,"EUR":1.09}}'::jsonb,
  'table',
  'Supplier currency conversion table. Stored as USD per 1 unit of native currency (multiply: native amount x rate = USD) — the workbook''s convention. Resolved §7.1 item 9.'),

-- GCT on invoices (Phase 2, specced now per PRD §9.3 / v3.1 Amendment 3)
('gct_enabled',
  '{"type":"boolean","value":false}'::jsonb,
  'boolean',
  'Global GCT-on-invoices toggle. OFF by default (below registration threshold). Admin-editable; supports per-quote/per-client override once toggled on. Source: workbook Assumptions sheet, v3.1 Amendment 3.'),

('gct_rate_pct',
  '{"type":"numeric","value":15}'::jsonb,
  'percent',
  'Default GCT rate, %, used once gct_enabled is turned on. Actual rate value(s) are finalized in admin whenever GCT registration happens (PRD §13 item 4) — not build-blocking.'),

-- Lead times (PRD §7 default lead-time text + per-origin table, Plan §6.4)
('lead_times',
  '{"type":"table","value":{"USA":"2-4 weeks","Canada":"2-4 weeks","UK":"4-8 weeks","Dubai":"2-3 months"}}'::jsonb,
  'table',
  'Per-origin lead-time table shown on quotes/PDFs when a supplier does not have its own default_lead_time_text. Source: Plan §6.4.'),

-- Company details block (§7 — needed for quote/invoice document footers)
('company_details',
  '{"type":"table","value":{"name":"Veridan Limited","address":"","trn":"","phone":"","email":""}}'::jsonb,
  'table',
  'Legal company details block (name, address, TRN, phone, email) rendered on quote and invoice documents. Name is confirmed; address/TRN/phone/email are placeholders pending founder input (PRD §7, Prerequisites checklist).')

on conflict (key) do nothing;
