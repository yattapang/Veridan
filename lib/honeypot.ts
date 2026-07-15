/**
 * Shared honeypot field name for the quote-request portal forms (§5.4 spam
 * control — "honeypot + rate limiting, no CAPTCHA"). Kept as a named
 * constant (not a magic string duplicated in three places) so the client
 * form component and the server action agree on the field.
 */
export const HONEYPOT_FIELD_NAME = "hp_company_website";
