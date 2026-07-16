/**
 * Quote PDF document (Task 18). Renders server-side via
 * `@react-pdf/renderer`'s `renderToBuffer` — see app/api/quotes/[id]/pdf/route.ts.
 *
 * PRD §6.4 step 1 / §6.4 rules this document must follow:
 *   - ALL client-facing prices are ONE all-inclusive per-door or per-line JMD
 *     figure (product + freight + duty + brokerage rolled together). The
 *     client never sees landed cost, margin, cost components, or supplier
 *     names — this file must not receive or render any of those.
 *   - Grand total = sum of the already-rounded per-line/per-door components
 *     (never re-derived from unrounded totals) per Build Plan §3.3.
 *   - Lead-time estimates are per-origin, sourced from the quote's OWN frozen
 *     parameters_snapshot (never live business_parameters).
 *   - Branding: the Header component below renders the real founder-supplied
 *     logo mark (public/brand/logo-mark-ink.png — ink variant, since this is
 *     a light/paper document) beside the "VERIDAN LIMITED" text, matching
 *     the same principle as components/Wordmark.tsx (PRD §13 item 1).
 *
 * React-PDF does not read Tailwind/globals.css — styles are a self-contained
 * StyleSheet below, with brand hex values copied from app/globals.css'
 * --color-* custom properties (see that file's comment header) so the PDF
 * matches the site's "near-black ink, warm paper, brass accent" feel.
 */

import fs from "fs";
import path from "path";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  formatCount,
  formatDoorNumbers,
  formatIsoDate,
  formatJmd2dp,
  formatJmdWhole,
  formatValidUntil,
  summarizeComposition,
} from "./format";

// Brand palette — copied from app/globals.css :root custom properties.
const INK = "#0c0c0d";
const WARM_GRAY = "#6f6a60";
const WARM_GRAY_LIGHT = "#d9d5cc";
const WARM_GRAY_PALE = "#f3f1ec";
const PAPER = "#faf9f6";
const ACCENT = "#a9895c";

// Read the ink-variant mark into a buffer at module load. react-pdf's
// <Image> resolves local `src` strings via Node's `url.parse`, which
// misreads a Windows absolute path (e.g. "C:\...") as having a "c:"
// protocol and falls through to `fetch()` — silently dropping the image.
// Passing `{ data, format }` sidesteps path/URL resolution entirely and
// works the same on Windows dev machines and Linux production hosts.
const LOGO_MARK_PATH = path.join(process.cwd(), "public", "brand", "logo-mark-ink.png");
const LOGO_MARK_SRC = { data: fs.readFileSync(LOGO_MARK_PATH), format: "png" as const };

export interface QuotePdfDoorGroupRow {
  setCode: string;
  setName: string | null;
  /** Composition summary items — one per distinct product on the set. */
  compositionItems: Array<{ description: string; qty: number }>;
  doorNumbers: string[];
  doorCount: number;
  /** All-inclusive per-door JMD price (rounded whole dollar, §3.3). */
  pricePerDoorJmd: number;
  /** Sum of this group's per-door prices (rounded components, §3.3). */
  totalJmd: number;
}

export interface QuotePdfFlatLineRow {
  description: string;
  qty: number;
  unitPriceJmd: number;
  lineTotalJmd: number;
}

export interface QuotePdfOriginLeadTime {
  label: string;
  leadTime: string;
}

export interface QuotePdfCompanyDetails {
  name: string;
  address: string;
  trn: string;
  phone: string;
  email: string;
}

export interface QuotePdfProps {
  wordmark: string;
  quoteRef: string;
  quoteDateIso: string;
  validityDays: number;
  isDraft: boolean;
  project: {
    name: string;
    clientCompanyName: string | null;
    siteAddress: string | null;
    architectCompanyName: string | null;
  };
  mode: "door_register" | "line_item";
  doorGroups: QuotePdfDoorGroupRow[];
  flatLines: QuotePdfFlatLineRow[];
  grandTotalJmd: number;
  leadTimes: QuotePdfOriginLeadTime[];
  depositPct: number;
  company: QuotePdfCompanyDetails;
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
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoMark: {
    width: 20,
    height: 22,
    marginRight: 8,
  },
  wordmark: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: 3,
    color: INK,
  },
  tagline: {
    fontSize: 8,
    color: WARM_GRAY,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  quoteMetaBox: {
    alignItems: "flex-end",
  },
  quoteRef: {
    fontSize: 13,
    fontWeight: 700,
    color: INK,
  },
  metaLine: {
    fontSize: 9,
    color: WARM_GRAY,
    marginTop: 2,
  },
  draftBanner: {
    marginBottom: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: ACCENT,
    borderStyle: "solid",
    backgroundColor: "#f6efe4",
  },
  draftBannerText: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.5,
    color: "#7a5a2e",
  },
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
  detailsCol: {
    flex: 1,
    paddingRight: 16,
  },
  detailsLabel: {
    fontSize: 8,
    color: WARM_GRAY,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailsValue: {
    fontSize: 10,
    color: INK,
    marginBottom: 8,
  },
  table: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: WARM_GRAY_LIGHT,
    borderStyle: "solid",
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: WARM_GRAY_PALE,
    borderBottomWidth: 1,
    borderBottomColor: WARM_GRAY_LIGHT,
    borderBottomStyle: "solid",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: WARM_GRAY_LIGHT,
    borderBottomStyle: "solid",
  },
  tableRowLast: {
    flexDirection: "row",
  },
  th: {
    paddingVertical: 7,
    paddingHorizontal: 8,
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: WARM_GRAY,
  },
  td: {
    paddingVertical: 7,
    paddingHorizontal: 8,
    fontSize: 9.5,
    color: INK,
  },
  tdSub: {
    fontSize: 8,
    color: WARM_GRAY,
    marginTop: 2,
  },
  colDescription: { flex: 3.2 },
  colDoors: { flex: 2 },
  colCount: { flex: 0.8, textAlign: "right" },
  colPrice: { flex: 1.4, textAlign: "right" },
  colTotal: { flex: 1.4, textAlign: "right" },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: INK,
    borderTopStyle: "solid",
  },
  totalsLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: INK,
    marginRight: 16,
  },
  totalsValue: {
    fontSize: 12,
    fontWeight: 700,
    color: INK,
  },
  leadTimeSection: {
    marginTop: 26,
  },
  leadTimeRow: {
    flexDirection: "row",
    paddingVertical: 4,
  },
  leadTimeLabel: {
    width: 120,
    fontSize: 9.5,
    color: INK,
  },
  leadTimeValue: {
    fontSize: 9.5,
    color: WARM_GRAY,
  },
  termsSection: {
    marginTop: 26,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: WARM_GRAY_LIGHT,
    borderTopStyle: "solid",
  },
  termLine: {
    fontSize: 9.5,
    color: INK,
    marginBottom: 5,
    lineHeight: 1.4,
  },
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
  footerText: {
    fontSize: 8,
    color: WARM_GRAY,
    textAlign: "center",
  },
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

function DoorGroupTable({ rows }: { rows: QuotePdfDoorGroupRow[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        <Text style={[styles.th, styles.colDescription]}>Hardware set</Text>
        <Text style={[styles.th, styles.colDoors]}>Doors</Text>
        <Text style={[styles.th, styles.colCount]}>Qty</Text>
        <Text style={[styles.th, styles.colPrice]}>Price / door (JMD)</Text>
        <Text style={[styles.th, styles.colTotal]}>Total (JMD)</Text>
      </View>
      {rows.map((row, i) => {
        const isLast = i === rows.length - 1;
        const composition = summarizeComposition(row.compositionItems);
        const setLabel = [row.setCode, row.setName].filter(Boolean).join(" — ");
        return (
          <View key={`${row.setCode}-${i}`} style={isLast ? styles.tableRowLast : styles.tableRow}>
            <View style={[styles.td, styles.colDescription]}>
              <Text>{setLabel}</Text>
              {composition ? <Text style={styles.tdSub}>{composition}</Text> : null}
            </View>
            <Text style={[styles.td, styles.colDoors]}>{formatDoorNumbers(row.doorNumbers)}</Text>
            <Text style={[styles.td, styles.colCount]}>{formatCount(row.doorCount)}</Text>
            <Text style={[styles.td, styles.colPrice]}>{formatJmdWhole(row.pricePerDoorJmd)}</Text>
            <Text style={[styles.td, styles.colTotal]}>{formatJmdWhole(row.totalJmd)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function FlatLineTable({ rows }: { rows: QuotePdfFlatLineRow[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        <Text style={[styles.th, styles.colDescription]}>Description</Text>
        <Text style={[styles.th, styles.colCount]}>Qty</Text>
        <Text style={[styles.th, styles.colPrice]}>Unit price (JMD)</Text>
        <Text style={[styles.th, styles.colTotal]}>Line total (JMD)</Text>
      </View>
      {rows.map((row, i) => {
        const isLast = i === rows.length - 1;
        return (
          <View key={`${row.description}-${i}`} style={isLast ? styles.tableRowLast : styles.tableRow}>
            <Text style={[styles.td, styles.colDescription]}>{row.description}</Text>
            <Text style={[styles.td, styles.colCount]}>{formatCount(row.qty)}</Text>
            <Text style={[styles.td, styles.colPrice]}>{formatJmd2dp(row.unitPriceJmd)}</Text>
            <Text style={[styles.td, styles.colTotal]}>{formatJmd2dp(row.lineTotalJmd)}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function QuotePdf(props: QuotePdfProps) {
  const {
    wordmark,
    quoteRef,
    quoteDateIso,
    validityDays,
    isDraft,
    project,
    mode,
    doorGroups,
    flatLines,
    grandTotalJmd,
    leadTimes,
    depositPct,
    company,
  } = props;

  return (
    <Document title={`${quoteRef} — Veridan quote`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Header wordmark={wordmark} />
            <Text style={styles.tagline}>Verified Quality. Delivered.</Text>
          </View>
          <View style={styles.quoteMetaBox}>
            <Text style={styles.quoteRef}>{quoteRef}</Text>
            <Text style={styles.metaLine}>Date: {formatIsoDate(quoteDateIso)}</Text>
            <Text style={styles.metaLine}>Valid until: {formatValidUntil(quoteDateIso, validityDays)}</Text>
          </View>
        </View>

        {isDraft && (
          <View style={styles.draftBanner}>
            <Text style={styles.draftBannerText}>DRAFT — NOT YET APPROVED FOR SENDING</Text>
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
            <Text style={styles.detailsLabel}>Site</Text>
            <Text style={styles.detailsValue}>{project.siteAddress ?? "—"}</Text>
            <Text style={styles.detailsLabel}>Architect</Text>
            <Text style={styles.detailsValue}>{project.architectCompanyName ?? "—"}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Pricing</Text>
        {mode === "door_register" ? <DoorGroupTable rows={doorGroups} /> : <FlatLineTable rows={flatLines} />}

        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>Grand total (JMD)</Text>
          <Text style={styles.totalsValue}>{formatJmdWhole(grandTotalJmd)}</Text>
        </View>

        {leadTimes.length > 0 && (
          <View style={styles.leadTimeSection}>
            <Text style={styles.sectionTitle}>Estimated lead time</Text>
            {leadTimes.map((lt) => (
              <View key={lt.label} style={styles.leadTimeRow}>
                <Text style={styles.leadTimeLabel}>{lt.label}</Text>
                <Text style={styles.leadTimeValue}>{lt.leadTime}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.termsSection}>
          <Text style={styles.sectionTitle}>Terms</Text>
          <Text style={styles.termLine}>
            Deposit: {depositPct}% due on acceptance; balance due on delivery.
          </Text>
          <Text style={styles.termLine}>This quote is valid for {validityDays} days from the quote date above.</Text>
          <Text style={styles.termLine}>
            All prices are all-inclusive, delivered duty-paid to site — there are no hidden fees.
          </Text>
          <Text style={styles.termLine}>Prices are quoted in Jamaican dollars (JMD).</Text>
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
