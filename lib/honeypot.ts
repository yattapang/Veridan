/**
 * Shared honeypot field name for the quote-request portal forms (§5.4 spam
 * control — "honeypot + rate limiting, no CAPTCHA"). Kept as a named
 * constant (not a magic string duplicated in three places) so the client
 * form component and the server action agree on the field.
 *
 * Naming note (Task 23 tuning pass): deliberately avoids words that match
 * browser/extension autofill heuristics — "website", "url", "company" (this
 * form already has a real `company_name` field, so a second field with
 * "company" in its name risks a saved-profile value being autofilled into
 * it, tripping the honeypot for a real visitor), "email", "phone", "name".
 * Those are exactly the tokens Chrome's autofill and password managers
 * (LastPass, Dashlane, 1Password) pattern-match on by name/id/autocomplete
 * token. "hp_verification_note" doesn't correspond to any known autofill
 * semantic category, so it stays empty for real users while still reading
 * as a plausible extra field to unsophisticated bots that fill every input
 * on a form regardless of name.
 */
export const HONEYPOT_FIELD_NAME = "hp_verification_note";
