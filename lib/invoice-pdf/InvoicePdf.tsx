/**
 * Invoice PDF document (Task 48a). Renders server-side via
 * `@react-pdf/renderer`'s `renderToBuffer` — see lib/invoices/pdf.ts and
 * app/api/invoices/[id]/pdf/route.ts. Deliberately mirrors
 * lib/quote-pdf/QuotePdf.tsx's structure/palette/logo-embedding approach so
 * a founder or client sees one consistent document family, not two.
 *
 * Fields shown, per the Task 48a brief: invoice number, type (Deposit/
 * Balance), issue date, linked quote ref + project/client block, amounts
 * table (subtotal, GCT line only when nonzero, total JMD), the fx_note
 * provenance line, deposit/balance context line, a payment instructions
 * block (honest TODO-labeled placeholder bank details — see
 * lib/site-content.ts invoicePaymentInstructions), due_note, and a status
 * watermark banner for 'void' and 'draft'.
 *
 * This document only ever renders numbers already computed by
 * lib/invoices/amounts.ts and stored on the invoices row — it never
 * recomputes GCT, FX, or totals itself (same fidelity discipline as the
 * quote PDF and amounts.ts's own header note).
 */

import fs from "fs";
import path from "path";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatCount, formatDoorNumbers, formatJmd2dp, formatJmdWhole, summarizeComposition } from "@/lib/quote-pdf/format";
import type { QuotePdfDoorGroupRow, QuotePdfFlatLineRow } from "@/lib/quote-pdf/QuotePdf";
import { formatIsoDate, formatInvoiceJmd, formatInvoiceUsd, INVOICE_PDF_TYPE_LABELS } from "./format";
import type { InvoiceStatus, InvoiceType } from "@/lib/supabase/types";

// Brand palette — copied from app/globals.css :root custom properties, same
// values lib/quote-pdf/QuotePdf.tsx uses.
const INK = "#0c0c0d";
const WARM_GRAY = "#6f6a60";
const WARM_GRAY_LIGHT = "#d9d5cc";
const PAPER = "#faf9f6";
const ACCENT = "#a9895c";
const VOID_RED = "#8a3a2e";

const LOGO_MARK_PATH = path.join(process.cwd(), "public", "brand", "logo-mark-ink.png");
const LOGO_MARK_SRC = { data: fs.readFileSync(LOGO_MARK_PATH), format: "png" as const };

export interface InvoicePdfCompanyDetails {
  name: string;
  address: string;
  trn: string;
  phone: string;
  email: string;
}

export interface InvoicePdfBankDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string;
  routingOrSwift: string;
  note: string;
}

/**
 * The invoice's itemized section (MAJOR-2 fix) — the SAME door_register
 * HW-group rows / line_item flat rows the source quote's own PDF shows
 * (lib/quote-pdf/itemization.ts), carried over from quote_line_items with no
 * re-keying. DISPLAY ONLY: `grandTotalJmd` here is the itemized total of the
 * FULL quote, which is never the invoice's own `amountJmd` (a deposit/balance
 * invoice's amount is a share of the quote total) — `note` explains that
 * mismatch so it never reads as a discrepancy. `null` when the source quote's
 * line items could not be loaded (never blocks rendering the rest of the
 * invoice — see lib/invoices/pdf.ts).
 */
export interface InvoicePdfItemization {
  mode: "door_register" | "line_item";
  doorGroups: QuotePdfDoorGroupRow[];
  flatLines: QuotePdfFlatLineRow[];
  grandTotalJmd: number;
  note: string;
}

export interface InvoicePdfProps {
  wordmark: string;
  invoiceNumber: string;
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  issueDateIso: string | null;
  quoteRef: string | null;
  depositPct: number | null;
  project: {
    name: string;
    clientCompanyName: string | null;
  };
  subtotalJmd: number | null;
  gctAmountJmd: number;
  amountJmd: number;
  amountUsd: number | null;
  fxNote: string | null;
  depositContextLine: string;
  dueNote: string | null;
  company: InvoicePdfCompanyDetails;
  bankDetails: InvoicePdfBankDetails;
  itemization: InvoicePdfItemization | null;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 64,
    paddingHorizontal: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: INK,
    backgroundColor: PAPER,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
  },
  logoRow: { flexDirection: "row", alignItems: "center" },
  logoMark: { width: 20, height: 22, marginRight: 8 },
  wordmark: { fontSize: 20, fontWeight: 700, letterSpacing: 3, color: INK },
  tagline: { fontSize: 8, color: WARM_GRAY, marginTop: 4, letterSpacing: 0.5 },
  metaBox: { alignItems: "flex-end" },
  invoiceNumber: { fontSize: 13, fontWeight: 700, color: INK },
  metaLine: { fontSize: 9, color: WARM_GRAY, marginTop: 2 },
  typeBadge: {
    marginTop: 4,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: WARM_GRAY_LIGHT,
    borderStyle: "solid",
  },
  typeBadgeText: { fontSize: 8, fontWeight: 700, letterSpacing: 1, color: WARM_GRAY, textTransform: "uppercase" },
  statusBanner: {
    marginBottom: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderStyle: "solid",
  },
  draftBanner: { borderColor: ACCENT, backgroundColor: "#f6efe4" },
  voidBanner: { borderColor: VOID_RED, backgroundColor: "#f6e8e5" },
  statusBannerText: { fontSize: 10, fontWeight: 700, letterSpacing: 1.5 },
  draftBannerText: { color: "#7a5a2e" },
  voidBannerText: { color: VOID_RED },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
    color: WARM_GRAY,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  detailsGrid: {
    flexDirection: "row",
    marginBottom: 24,
    borderTopWidth: 1,
    borderTopColor: WARM_GRAY_LIGHT,
    borderTopStyle: "solid",
    paddingTop: 12,
  },
  detailsCol: { flex: 1, paddingRight: 16 },
  detailsLabel: {
    fontSize: 8,
    color: WARM_GRAY,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailsValue: { fontSize: 10, color: INK, marginBottom: 8 },
  table: { marginTop: 4, borderWidth: 1, borderColor: WARM_GRAY_LIGHT, borderStyle: "solid" },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: WARM_GRAY_LIGHT,
    borderBottomStyle: "solid",
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  tableRowLast: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, paddingHorizontal: 8 },
  tableLabel: { fontSize: 9.5, color: INK },
  tableValue: { fontSize: 9.5, color: INK },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: INK,
    borderTopStyle: "solid",
  },
  totalsLabel: { fontSize: 10, fontWeight: 700, color: INK },
  totalsValue: { fontSize: 12, fontWeight: 700, color: INK },
  usdLine: { marginTop: 6, fontSize: 8.5, color: WARM_GRAY, textAlign: "right" },
  noteSection: {
    marginTop: 22,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: WARM_GRAY_LIGHT,
    borderTopStyle: "solid",
  },
  noteLine: { fontSize: 9.5, color: INK, marginBottom: 5, lineHeight: 1.4 },
  bankGrid: { marginTop: 4 },
  bankRow: { flexDirection: "row", paddingVertical: 2 },
  bankLabel: { width: 140, fontSize: 9, color: WARM_GRAY },
  bankValue: { fontSize: 9, color: INK },
  bankTodoNote: { marginTop: 8, fontSize: 8, color: ACCENT, fontWeight: 700 },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    borderTopWidth: 1,
    borderTopColor: WARM_GRAY_LIGHT,
    borderTopStyle: "solid",
    paddingTop: 8,
  },
  footerText: { fontSize: 8, color: WARM_GRAY, textAlign: "center" },
  // Itemized breakdown (MAJOR-2) — same table shape as lib/quote-pdf/QuotePdf.tsx's
  // DoorGroupTable/FlatLineTable, at a slightly smaller scale since it sits
  // below the invoice's own amounts table rather than being the page's focus.
  itemTable: { marginTop: 4, borderWidth: 1, borderColor: WARM_GRAY_LIGHT, borderStyle: "solid" },
  itemHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f3f1ec",
    borderBottomWidth: 1,
    borderBottomColor: WARM_GRAY_LIGHT,
    borderBottomStyle: "solid",
  },
  itemRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: WARM_GRAY_LIGHT,
    borderBottomStyle: "solid",
  },
  itemRowLast: { flexDirection: "row" },
  ith: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: WARM_GRAY,
  },
  itd: { paddingVertical: 6, paddingHorizontal: 8, fontSize: 9, color: INK },
  itdSub: { fontSize: 7.5, color: WARM_GRAY, marginTop: 2 },
  itemColDescription: { flex: 3.2 },
  itemColDoors: { flex: 2 },
  itemColCount: { flex: 0.8, textAlign: "right" },
  itemColPrice: { flex: 1.4, textAlign: "right" },
  itemColTotal: { flex: 1.4, textAlign: "right" },
  itemGrandTotalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: WARM_GRAY_LIGHT,
    borderTopStyle: "solid",
  },
  itemGrandTotalLabel: { fontSize: 9, fontWeight: 700, color: INK, marginRight: 12 },
  itemGrandTotalValue: { fontSize: 10, fontWeight: 700, color: INK },
});

function Header({ wordmark }: { wordmark: string }) {
  return (
    <View style={styles.logoRow}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's <Image>
          is not an HTML <img>; it has no alt prop. */}
      <Image src={LOGO_MARK_SRC} style={styles.logoMark} />
      <Text style={styles.wordmark}>{wordmark}</Text>
    </View>
  );
}

function ItemDoorGroupTable({ rows }: { rows: QuotePdfDoorGroupRow[] }) {
  return (
    <View style={styles.itemTable}>
      <View style={styles.itemHeaderRow}>
        <Text style={[styles.ith, styles.itemColDescription]}>Hardware set</Text>
        <Text style={[styles.ith, styles.itemColDoors]}>Doors</Text>
        <Text style={[styles.ith, styles.itemColCount]}>Qty</Text>
        <Text style={[styles.ith, styles.itemColPrice]}>Price / door (JMD)</Text>
        <Text style={[styles.ith, styles.itemColTotal]}>Total (JMD)</Text>
      </View>
      {rows.map((row, i) => {
        const isLast = i === rows.length - 1;
        const composition = summarizeComposition(row.compositionItems);
        const setLabel = [row.setCode, row.setName].filter(Boolean).join(" — ");
        return (
          <View key={`${row.setCode}-${i}`} style={isLast ? styles.itemRowLast : styles.itemRow}>
            <View style={[styles.itd, styles.itemColDescription]}>
              <Text>{setLabel}</Text>
              {composition ? <Text style={styles.itdSub}>{composition}</Text> : null}
            </View>
            <Text style={[styles.itd, styles.itemColDoors]}>{formatDoorNumbers(row.doorNumbers)}</Text>
            <Text style={[styles.itd, styles.itemColCount]}>{formatCount(row.doorCount)}</Text>
            <Text style={[styles.itd, styles.itemColPrice]}>{formatJmdWhole(row.pricePerDoorJmd)}</Text>
            <Text style={[styles.itd, styles.itemColTotal]}>{formatJmdWhole(row.totalJmd)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function ItemFlatLineTable({ rows }: { rows: QuotePdfFlatLineRow[] }) {
  return (
    <View style={styles.itemTable}>
      <View style={styles.itemHeaderRow}>
        <Text style={[styles.ith, styles.itemColDescription]}>Description</Text>
        <Text style={[styles.ith, styles.itemColCount]}>Qty</Text>
        <Text style={[styles.ith, styles.itemColPrice]}>Unit price (JMD)</Text>
        <Text style={[styles.ith, styles.itemColTotal]}>Line total (JMD)</Text>
      </View>
      {rows.map((row, i) => {
        const isLast = i === rows.length - 1;
        return (
          <View key={`${row.description}-${i}`} style={isLast ? styles.itemRowLast : styles.itemRow}>
            <Text style={[styles.itd, styles.itemColDescription]}>{row.description}</Text>
            <Text style={[styles.itd, styles.itemColCount]}>{formatCount(row.qty)}</Text>
            <Text style={[styles.itd, styles.itemColPrice]}>{formatJmd2dp(row.unitPriceJmd)}</Text>
            <Text style={[styles.itd, styles.itemColTotal]}>{formatJmd2dp(row.lineTotalJmd)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function ItemizedSection({ itemization }: { itemization: InvoicePdfItemization }) {
  return (
    <View style={styles.noteSection}>
      <Text style={styles.sectionTitle}>Itemized breakdown</Text>
      <Text style={styles.noteLine}>{itemization.note}</Text>
      {itemization.mode === "door_register" ? (
        <ItemDoorGroupTable rows={itemization.doorGroups} />
      ) : (
        <ItemFlatLineTable rows={itemization.flatLines} />
      )}
      <View style={styles.itemGrandTotalRow}>
        <Text style={styles.itemGrandTotalLabel}>Itemized total (JMD)</Text>
        <Text style={styles.itemGrandTotalValue}>{formatJmdWhole(itemization.grandTotalJmd)}</Text>
      </View>
    </View>
  );
}

export function InvoicePdf(props: InvoicePdfProps) {
  const {
    wordmark,
    invoiceNumber,
    invoiceType,
    status,
    issueDateIso,
    quoteRef,
    project,
    subtotalJmd,
    gctAmountJmd,
    amountJmd,
    amountUsd,
    fxNote,
    depositContextLine,
    dueNote,
    company,
    bankDetails,
    itemization,
  } = props;

  const showGctLine = Number.isFinite(gctAmountJmd) && gctAmountJmd !== 0;

  return (
    <Document title={`${invoiceNumber} — Veridan invoice`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Header wordmark={wordmark} />
            <Text style={styles.tagline}>Verified Quality. Delivered.</Text>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.invoiceNumber}>{invoiceNumber}</Text>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{INVOICE_PDF_TYPE_LABELS[invoiceType]} invoice</Text>
            </View>
            <Text style={styles.metaLine}>Issue date: {formatIsoDate(issueDateIso)}</Text>
            {quoteRef && <Text style={styles.metaLine}>Quote ref: {quoteRef}</Text>}
          </View>
        </View>

        {status === "void" && (
          <View style={[styles.statusBanner, styles.voidBanner]}>
            <Text style={[styles.statusBannerText, styles.voidBannerText]}>VOID — THIS INVOICE HAS BEEN CANCELLED</Text>
          </View>
        )}
        {status === "draft" && (
          <View style={[styles.statusBanner, styles.draftBanner]}>
            <Text style={[styles.statusBannerText, styles.draftBannerText]}>DRAFT — NOT YET ISSUED</Text>
          </View>
        )}

        <View style={styles.detailsGrid}>
          <View style={styles.detailsCol}>
            <Text style={styles.detailsLabel}>Project</Text>
            <Text style={styles.detailsValue}>{project.name}</Text>
            <Text style={styles.detailsLabel}>Client</Text>
            <Text style={styles.detailsValue}>{project.clientCompanyName ?? "—"}</Text>
          </View>
          <View style={styles.detailsCol}>
            <Text style={styles.detailsLabel}>Invoice type</Text>
            <Text style={styles.detailsValue}>{INVOICE_PDF_TYPE_LABELS[invoiceType]}</Text>
            <Text style={styles.detailsLabel}>Context</Text>
            <Text style={styles.detailsValue}>{depositContextLine}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Amounts</Text>
        <View style={styles.table}>
          <View style={showGctLine ? styles.tableRow : styles.tableRowLast}>
            <Text style={styles.tableLabel}>Subtotal (JMD)</Text>
            <Text style={styles.tableValue}>{formatInvoiceJmd(subtotalJmd)}</Text>
          </View>
          {showGctLine && (
            <View style={styles.tableRowLast}>
              <Text style={styles.tableLabel}>GCT (JMD)</Text>
              <Text style={styles.tableValue}>{formatInvoiceJmd(gctAmountJmd)}</Text>
            </View>
          )}
        </View>

        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>Total due (JMD)</Text>
          <Text style={styles.totalsValue}>{formatInvoiceJmd(amountJmd)}</Text>
        </View>
        {amountUsd != null && (
          <Text style={styles.usdLine}>Informational USD equivalent: {formatInvoiceUsd(amountUsd)}</Text>
        )}

        <View style={styles.noteSection}>
          <Text style={styles.sectionTitle}>Terms</Text>
          {fxNote && <Text style={styles.noteLine}>FX rate (locked from the source quote): {fxNote}</Text>}
          {dueNote && <Text style={styles.noteLine}>{dueNote}</Text>}
          <Text style={styles.noteLine}>Prices are stated in Jamaican dollars (JMD).</Text>
        </View>

        {itemization && <ItemizedSection itemization={itemization} />}

        <View style={styles.noteSection}>
          <Text style={styles.sectionTitle}>Payment instructions</Text>
          <View style={styles.bankGrid}>
            <View style={styles.bankRow}>
              <Text style={styles.bankLabel}>Bank</Text>
              <Text style={styles.bankValue}>{bankDetails.bankName}</Text>
            </View>
            <View style={styles.bankRow}>
              <Text style={styles.bankLabel}>Account name</Text>
              <Text style={styles.bankValue}>{bankDetails.accountName}</Text>
            </View>
            <View style={styles.bankRow}>
              <Text style={styles.bankLabel}>Account number</Text>
              <Text style={styles.bankValue}>{bankDetails.accountNumber}</Text>
            </View>
            <View style={styles.bankRow}>
              <Text style={styles.bankLabel}>Branch</Text>
              <Text style={styles.bankValue}>{bankDetails.branch}</Text>
            </View>
            <View style={styles.bankRow}>
              <Text style={styles.bankLabel}>Routing / SWIFT</Text>
              <Text style={styles.bankValue}>{bankDetails.routingOrSwift}</Text>
            </View>
          </View>
          <Text style={styles.bankTodoNote}>{bankDetails.note}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {company.name}
            {company.address ? ` · ${company.address}` : ""}
            {company.phone ? ` · ${company.phone}` : ""}
            {company.email ? ` · ${company.email}` : ""}
            {company.trn ? ` · TRN ${company.trn}` : ""}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
