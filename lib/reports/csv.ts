/**
 * CSV builder — PURE, no I/O (Task 56). RFC 4180 escaping so a supplier name
 * with a comma, a note with an embedded quote, or a multi-line address never
 * corrupts the accountant's file.
 *
 * Rules:
 *   - A field is quoted iff it contains a comma, a double-quote, a CR or an
 *     LF. Inside a quoted field, every double-quote is doubled.
 *   - Rows are joined with CRLF (the RFC 4180 line terminator Excel expects);
 *     the whole document is prefixed with a UTF-8 BOM by `buildCsvDocument`
 *     so Excel opens accented supplier names / the JMD label correctly.
 *   - null / undefined → empty field; numbers → their plain decimal string
 *     (no thousands separators, so the value re-parses as a number).
 */

export type CsvCell = string | number | boolean | null | undefined;

/** Escapes a single cell per RFC 4180. */
export function csvField(value: CsvCell): string {
  if (value == null) return "";
  const s = typeof value === "string" ? value : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Joins a matrix of cells into a CRLF-terminated CSV body (no BOM). */
export function buildCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}

/**
 * A full CSV document ready to serve as a download: UTF-8 BOM + CRLF body +
 * trailing CRLF. The BOM makes Excel honor UTF-8 (JMD/accented text) without a
 * manual import step.
 */
export function buildCsvDocument(rows: CsvCell[][]): string {
  return `﻿${buildCsv(rows)}\r\n`;
}
