import { HONEYPOT_FIELD_NAME } from "@/lib/honeypot";

/**
 * Hidden honeypot input. Real users never see or fill it (visually hidden,
 * off the tab order, `autoComplete="off"`); simple bots that fill every
 * field in a form will fill it, which the server action reads to silently
 * treat the submission as spam per §5.4.
 */
export function HoneypotField() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
    >
      <label htmlFor={HONEYPOT_FIELD_NAME}>Leave this field blank</label>
      <input
        type="text"
        id={HONEYPOT_FIELD_NAME}
        name={HONEYPOT_FIELD_NAME}
        tabIndex={-1}
        autoComplete="off"
      />
    </div>
  );
}
