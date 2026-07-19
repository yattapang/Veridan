-- ============================================================================
-- Veridan Limited — invoice payment instructions as an admin-editable
-- parameter (founder request 2026-07-19: "I will add the bank details
-- manually. I need to be able to do that for when things change.")
--
-- Moves the receiving-bank details block from the hardcoded
-- lib/site-content.ts constant into business_parameters, where the founders
-- already edit rates/margins/company details with audit logging
-- (/admin/parameters). The send gate (Phase 2C review MAJOR-3) now reads
-- this parameter: sending stays blocked while any checked field still
-- carries a "TODO" placeholder.
--
-- Rendered on the invoice PDF at render time (payment instructions are
-- point-in-time banking facts, not priced terms — deliberately NOT part of
-- the quote's frozen parameters_snapshot).
-- ============================================================================

insert into public.business_parameters (key, value, value_type, description) values
('invoice_payment_instructions',
  '{"type":"table","value":{"bank_name":"TODO founder: bank name","account_name":"Veridan Limited","account_number":"TODO founder: account number","branch":"TODO founder: branch","routing_or_swift":"TODO founder: routing / SWIFT code","note":"Please include the invoice number as your payment reference."}}'::jsonb,
  'table',
  'Receiving-bank details printed on invoice PDFs (bank_name, account_name, account_number, branch, routing_or_swift, note). Invoices CANNOT be sent while any of bank_name/account_number/branch/routing_or_swift still contains "TODO" — fill in the real details to enable sending. Edit here whenever banking details change; takes effect on the next PDF render/send.')
on conflict (key) do nothing;
