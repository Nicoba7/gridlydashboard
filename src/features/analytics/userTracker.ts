/**
 * userTracker.ts — logs per-user daily optimizer results to a Notion database.
 *
 * Each row captures what Aveum did for a user on a given day:
 * savings, export earnings, EV outcome, cheapest slot used,
 * discharge peak avoided, the email one-liner, and whether the
 * morning email was delivered.
 *
 * Environment variables required:
 *   NOTION_API_KEY            — Notion integration secret (Internal Integration Token)
 *   NOTION_RESULTS_DATABASE_ID — ID of the target Notion database
 *
 * The Notion database must have these properties (names must match exactly):
 *   Name (title), Email (email), Date (date), Saved (pence) (number),
 *   Earned (pence) (number), Net cost (pence) (number),
 *   EV target achieved (select), Cheapest slot (rich_text),
 *   Discharge peak (rich_text), Summary (rich_text), Email sent (checkbox)
 */

import type { DailySavingsReport } from "../report/dailySavingsReport";

// ── Input shape ────────────────────────────────────────────────────────────────

export interface DailyResultTrackingInput {
  /** Display name of the user (from registration). */
  userName: string;
  /** Notification email address for the user. */
  notifyEmail: string;
  /** ISO date string for the run (YYYY-MM-DD). */
  dateIso: string;
  /** Completed savings report for the day. */
  report: DailySavingsReport;
  /**
   * Net energy cost for the day in pence (importCost − exportRevenue).
   * Derived from the optimizer summary: expectedImportCostPence − expectedExportRevenuePence.
   */
  netCostPence: number;
  /** Whether the EV reached its target SoC by the ready-by time. */
  evTargetAchieved: boolean | null;
  /** Whether the morning email was successfully delivered. */
  emailSent: boolean;
}

// ── Notion API helpers ─────────────────────────────────────────────────────────

interface NotionRichText {
  type: "text";
  text: { content: string };
}

function richText(content: string): NotionRichText[] {
  // Notion rich_text values are capped at 2000 characters per element.
  return [{ type: "text", text: { content: content.slice(0, 2000) } }];
}

function slotLabel(slot: DailySavingsReport["cheapestSlotUsed"]): string {
  if (!slot) return "—";
  return `${slot.time} · ${slot.pricePencePerKwh.toFixed(1)}p/kWh`;
}

// ── Core function ──────────────────────────────────────────────────────────────

export interface TrackDailyResultEnv {
  NOTION_API_KEY?: string;
  NOTION_RESULTS_DATABASE_ID?: string;
}

export interface TrackDailyResultOutcome {
  tracked: boolean;
  notionPageId?: string;
  skippedReason?: string;
  error?: string;
}

/**
 * Appends a row to the Notion results database for a single user's daily run.
 *
 * Returns a result object — never throws. Tracking failures are non-blocking
 * so a Notion outage does not interrupt the cron run.
 */
export async function trackDailyResult(
  input: DailyResultTrackingInput,
  env: TrackDailyResultEnv = process.env as TrackDailyResultEnv,
): Promise<TrackDailyResultOutcome> {
  const apiKey = env.NOTION_API_KEY?.trim();
  const databaseId = env.NOTION_RESULTS_DATABASE_ID?.trim();

  if (!apiKey) {
    return { tracked: false, skippedReason: "NOTION_API_KEY not set." };
  }
  if (!databaseId) {
    return { tracked: false, skippedReason: "NOTION_RESULTS_DATABASE_ID not set." };
  }

  const { userName, notifyEmail, dateIso, report, netCostPence, evTargetAchieved, emailSent } = input;

  const body = {
    parent: { database_id: databaseId },
    properties: {
      // Title column — required by Notion
      "Name": {
        title: richText(userName || "Unknown"),
      },
      "Email": {
        email: notifyEmail || null,
      },
      "Date": {
        date: { start: dateIso.slice(0, 10) },
      },
      "Saved (pence)": {
        number: report.savedTodayPence,
      },
      "Earned (pence)": {
        number: report.earnedFromExportPence,
      },
      "Net cost (pence)": {
        number: netCostPence,
      },
      "EV target achieved": {
        select: evTargetAchieved === null
          ? null
          : { name: evTargetAchieved ? "Yes" : "No" },
      },
      "Cheapest slot": {
        rich_text: richText(slotLabel(report.cheapestSlotUsed)),
      },
      "Discharge peak": {
        rich_text: richText(slotLabel(report.batteryDischargedAt)),
      },
      "Summary": {
        rich_text: richText(report.oneLiner),
      },
      "Email sent": {
        checkbox: emailSent,
      },
    },
  };

  try {
    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(unreadable)");
      return {
        tracked: false,
        error: `Notion API ${response.status}: ${text.slice(0, 300)}`,
      };
    }

    const page = (await response.json()) as { id?: string };
    return { tracked: true, notionPageId: page.id };
  } catch (err) {
    return {
      tracked: false,
      error: `Notion fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
