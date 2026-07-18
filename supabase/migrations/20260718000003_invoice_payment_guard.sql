-- ============================================================================
-- Veridan Limited — Invoice payment race guard (Phase 2C independent review,
-- MAJOR-1). NEW migration only — 20260718000002_invoicing.sql is APPLIED
-- LIVE and must never be edited.
--
-- THE RACE: app/admin/invoices/[id]/actions.ts recordPayment used to (1)
-- SELECT the existing payments, (2) sum them in JS, (3) compare the new
-- payment against the remaining balance, (4) INSERT the payment, (5) SELECT
-- the payments again, (6) UPDATE the invoice's status. Steps 1-3 are a
-- classic check-then-act: two concurrent payment submissions can both read
-- the SAME "existing payments" total, both pass the "does not exceed
-- remaining balance" check independently, and both insert — together
-- overpaying the invoice past amount_jmd with neither request ever seeing
-- the other's insert.
--
-- THE FIX: record_invoice_payment() below does the whole read-check-insert-
-- update sequence in ONE Postgres transaction, taking a row lock on the
-- invoice via `SELECT ... FOR UPDATE` before summing payments. A second
-- concurrent call blocks on that lock until the first transaction commits
-- (inserting its payment and updating the invoice's status), then re-reads
-- the NOW-current payment total and correctly refuses if the invoice is
-- already fully paid — closing the race a JS-side check-then-act can never
-- close by itself, no matter how the reads are ordered.
--
-- STATUS LOGIC: mirrors lib/invoices/paymentStatus.ts's
-- nextInvoiceStatusAfterPayment exactly (cent-precision comparison via
-- numeric's native 2dp rounding here, rather than toCents' float-drift
-- workaround, since `numeric(14,2)` has no binary-float representation
-- error to guard against) — the TS helper remains the DISPLAY-side source
-- (invoice detail page's running-balance column etc.); this SQL function is
-- the ENFORCEMENT-side mirror, not a replacement.
--
-- ERROR CODES: custom SQLSTATEs so the TS caller can distinguish "this
-- payment would overpay the invoice" (the exact race this migration exists
-- to close) from "this invoice isn't in a payable state" from "invoice not
-- found" without parsing error message text (see MINOR-6's error-code fix
-- applied the same way in lib/invoices/generate.ts). Codes are 5
-- alphanumeric characters, deliberately outside any standard Postgres
-- error-class prefix (see https://www.postgresql.org/docs/current/errcodes-appendix.html):
--   J0001 — payment would exceed the invoice's remaining balance
--   J0002 — invoice is not in a payable status (draft/paid/void)
--   J0003 — invoice not found
-- ============================================================================

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount_jmd numeric,
  p_paid_at date,
  p_method text,
  p_reference text,
  p_notes text,
  p_recorded_by uuid
)
returns table (payment_id uuid, new_status text)
language plpgsql
as $$
declare
  v_invoice_id     uuid;
  v_amount_jmd     numeric;
  v_status         text;
  v_paid_so_far    numeric;
  v_new_total_paid numeric;
  v_new_payment_id uuid;
  v_new_status     text;
begin
  if p_amount_jmd is null or p_amount_jmd <= 0 then
    raise exception 'Enter a payment amount greater than zero.' using errcode = 'J0001';
  end if;

  -- Row lock: every concurrent call for the SAME invoice serializes here.
  -- The second caller blocks until the first transaction commits (or rolls
  -- back), so no two callers can ever read the same "payments so far" total
  -- and both insert against it.
  select id, amount_jmd, status
    into v_invoice_id, v_amount_jmd, v_status
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found.' using errcode = 'J0003';
  end if;

  if v_status not in ('issued', 'sent', 'partially_paid') then
    raise exception 'A payment cannot be recorded against a % invoice.', v_status using errcode = 'J0002';
  end if;

  select coalesce(sum(amount_jmd), 0)
    into v_paid_so_far
  from public.invoice_payments
  where invoice_id = p_invoice_id;

  v_new_total_paid := round(v_paid_so_far + p_amount_jmd, 2);

  if v_new_total_paid > round(v_amount_jmd, 2) then
    raise exception 'This payment would exceed the invoice''s remaining balance.' using errcode = 'J0001';
  end if;

  insert into public.invoice_payments (invoice_id, amount_jmd, paid_at, method, reference, notes, recorded_by)
  values (p_invoice_id, p_amount_jmd, coalesce(p_paid_at, current_date), p_method, p_reference, p_notes, p_recorded_by)
  returning id into v_new_payment_id;

  -- Mirrors lib/invoices/paymentStatus.ts nextInvoiceStatusAfterPayment:
  -- payments summing to at least amount_jmd (including a harmless
  -- overpayment, which the check above already forbids going forward) ->
  -- 'paid'; anything less -> 'partially_paid'.
  v_new_status := case when v_new_total_paid >= round(v_amount_jmd, 2) then 'paid' else 'partially_paid' end;

  update public.invoices set status = v_new_status where id = p_invoice_id;

  payment_id := v_new_payment_id;
  new_status := v_new_status;
  return next;
end;
$$;

grant execute on function public.record_invoice_payment(uuid, numeric, date, text, text, text, uuid) to authenticated;
