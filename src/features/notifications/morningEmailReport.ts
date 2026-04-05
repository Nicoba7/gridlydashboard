import nodemailer from "nodemailer";
import type { DailySavingsReport } from "../report/dailySavingsReport";

// ── Config ─────────────────────────────────────────────────────────────────────

export interface MorningEmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  /** Recipient address for the morning report. */
  notifyEmail: string;
  /** From address — defaults to smtpUser when absent. */
  fromEmail?: string;
}

export interface MorningEmailEnv {
  AVEUM_SMTP_HOST?: string;
  AVEUM_SMTP_PORT?: string;
  AVEUM_SMTP_USER?: string;
  AVEUM_SMTP_PASS?: string;
  AVEUM_NOTIFY_EMAIL?: string;
  AVEUM_FROM_EMAIL?: string;
}

/**
 * Reads SMTP configuration from environment variables.
 * Returns null when AVEUM_NOTIFY_EMAIL is absent — caller should skip sending.
 */
export function readMorningEmailConfigFromEnv(env: MorningEmailEnv): MorningEmailConfig | null {
  const notifyEmail = env.AVEUM_NOTIFY_EMAIL?.trim();
  if (!notifyEmail) return null;

  const smtpHost = env.AVEUM_SMTP_HOST?.trim() ?? "";
  const smtpUser = env.AVEUM_SMTP_USER?.trim() ?? "";
  const smtpPass = env.AVEUM_SMTP_PASS?.trim() ?? "";
  const smtpPort = parseInt(env.AVEUM_SMTP_PORT ?? "587", 10);

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.warn(
      "[Aveum] AVEUM_NOTIFY_EMAIL is set but AVEUM_SMTP_HOST / AVEUM_SMTP_USER / AVEUM_SMTP_PASS are missing — skipping morning report.",
    );
    return null;
  }

  return {
    smtpHost,
    smtpPort: Number.isFinite(smtpPort) ? smtpPort : 587,
    smtpUser,
    smtpPass,
    notifyEmail,
    fromEmail: env.AVEUM_FROM_EMAIL?.trim() || smtpUser,
  };
}

// ── Email content ──────────────────────────────────────────────────────────────

export interface MorningEmailContent {
  subject: string;
  text: string;
  html: string;
}

function formatDateLabel(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatPounds(pence: number): string {
  return `£${(Math.abs(pence) / 100).toFixed(2)}`;
}

function formatPenceRate(p: number): string {
  return `${p.toFixed(1)}p/kWh`;
}

/**
 * Builds the bullet point list for both plain text and HTML variants.
 * Returns an array of strings — one per bullet.
 */
function buildBullets(report: DailySavingsReport): string[] {
  const bullets: string[] = [];

  if (report.cheapestSlotUsed) {
    bullets.push(
      `Battery charged at ${formatPenceRate(report.cheapestSlotUsed.pricePencePerKwh)} (${report.cheapestSlotUsed.time})`,
    );
  }

  if (report.batteryDischargedAt) {
    bullets.push(
      `Battery discharged during peak pricing at ${formatPenceRate(report.batteryDischargedAt.pricePencePerKwh)} — home powered from stored energy`,
    );
  }

  if (report.v2hDischargeEvent) {
    bullets.push(
      `EV powered your home ${report.v2hDischargeEvent.timeRangeLabel} · saved ${formatPounds(report.v2hDischargeEvent.savedPence)} · ${report.v2hDischargeEvent.chargeUsedPercent}% charge used · ${report.v2hDischargeEvent.remainingPercent}% remaining for tomorrow.`,
    );
  }

  if (report.solarDivertEvent) {
    bullets.push(
      `Diverted ${report.solarDivertEvent.divertedKwh.toFixed(1)}kWh of surplus solar to your ${report.solarDivertEvent.destination} — saved ${formatPounds(report.solarDivertEvent.savedPence)} vs grid charging.`,
    );
  }

  if (report.powerUpOvernightSummary && report.powerUpOvernightSummary.count > 0) {
    bullets.push(
      `Caught ${report.powerUpOvernightSummary.count} Octopus Power-Up${report.powerUpOvernightSummary.count === 1 ? "" : "s"} last night — charged ${report.powerUpOvernightSummary.chargedKwh.toFixed(1)}kWh for free.`,
    );
  }

  if (report.savingSessionOvernightSummary?.participated) {
    bullets.push(
      `Saving Session: participated, estimated earning £${report.savingSessionOvernightSummary.estimatedEarningPounds.toFixed(2)}.`,
    );
  }

  if (report.evChargedAt) {
    bullets.push(
      `EV charged from ${report.evChargedAt.time} at an average of ${formatPenceRate(report.evChargedAt.pricePencePerKwh)} — ready before departure`,
    );
  }

  if (report.heatPumpPreHeatEvent) {
    const event = report.heatPumpPreHeatEvent;
    const hwNote = event.hotWaterSavingsPounds != null && event.hotWaterSavingsPounds > 0
      ? ` · ${formatPounds(event.hotWaterSavingsPounds * 100)} hot water saving`
      : "";
    bullets.push(
      `Pre-heated home ${event.timeRangeLabel} at ${formatPenceRate(event.effectiveHeatCostPencePerKwh)} effective heat cost — saved ${formatPounds(event.savedPence)} vs peak rate${hwNote}`,
    );
  }

  if (report.earnedFromExportPence > 1) {
    bullets.push(`Earned ${formatPounds(report.earnedFromExportPence)} exporting solar surplus to the grid`);
  }

  if (bullets.length === 0) {
    bullets.push("Aveum monitored your system — no high-value opportunity was available today");
  }

  return bullets;
}

export function buildMorningEmailContent(
  report: DailySavingsReport,
  dateIso: string,
): MorningEmailContent {
  const dateLabel = formatDateLabel(dateIso);
  const subject = `Aveum — your energy summary for ${dateLabel}`;

  const heroLine =
    report.savedTodayPence > 0
      ? `You saved ${formatPounds(report.savedTodayPence)} today`
      : `Aveum kept your system optimised today`;

  const bullets = buildBullets(report);
  const footer = "Aveum is running automatically — nothing to do.";

  // ── Plain text ───────────────────────────────────────────────────────────────
  const bulletText = bullets.map((b) => `  • ${b}`).join("\n");
  const text = [
    subject,
    "",
    heroLine,
    "",
    "What Aveum did:",
    bulletText,
    "",
    report.nightlyNarrative,
    "",
    "─".repeat(48),
    footer,
  ].join("\n");

  // ── HTML ─────────────────────────────────────────────────────────────────────
  const bulletHtml = bullets
    .map((b) => `<li style="margin:6px 0;color:#374151;">${escapeHtml(b)}</li>`)
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

          <!-- Header bar -->
          <tr>
            <td style="background:#0f172a;padding:20px 32px;">
              <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Aveum</span>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="padding:32px 32px 16px;">
              <p style="margin:0 0 4px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;">Your energy summary · ${escapeHtml(dateLabel)}</p>
              <h1 style="margin:0;font-size:36px;font-weight:800;color:#0f172a;letter-spacing:-1px;">${escapeHtml(heroLine)}</h1>
            </td>
          </tr>

          <!-- Bullets -->
          <tr>
            <td style="padding:8px 32px 24px;">
              <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">What Aveum did</p>
              <ul style="margin:0;padding:0 0 0 20px;">
                ${bulletHtml}
              </ul>
            </td>
          </tr>

          <!-- Narrative -->
          <tr>
            <td style="padding:0 32px 28px;">
              <p style="margin:0;font-size:14px;line-height:1.7;color:#6b7280;">${escapeHtml(report.nightlyNarrative)}</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">${escapeHtml(footer)}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Transport ──────────────────────────────────────────────────────────────────

export interface SendMorningReportResult {
  sent: boolean;
  messageId?: string;
  skippedReason?: string;
}

type TransporterLike = {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{ messageId?: string }>;
};

/**
 * Injectable factory for the nodemailer transporter — used in tests to provide a mock.
 */
export type CreateTransporterFn = (config: MorningEmailConfig) => TransporterLike;

const defaultCreateTransporter: CreateTransporterFn = (config) =>
  nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });

/**
 * Builds the email content and sends it via SMTP.
 *
 * @param report  - The completed DailySavingsReport for the day.
 * @param dateIso - ISO-8601 date string used to format the subject and hero line.
 * @param config  - SMTP configuration. Pass null to skip sending (e.g. when env vars are absent).
 * @param createTransporter - Injectable transporter factory; defaults to the real nodemailer transport.
 */
export async function sendMorningReport(
  report: DailySavingsReport,
  dateIso: string,
  config: MorningEmailConfig | null,
  createTransporter: CreateTransporterFn = defaultCreateTransporter,
): Promise<SendMorningReportResult> {
  if (!config) {
    return { sent: false, skippedReason: "No SMTP configuration — AVEUM_NOTIFY_EMAIL not set." };
  }

  const content = buildMorningEmailContent(report, dateIso);
  const from = `"Aveum" <${config.fromEmail ?? config.smtpUser}>`;

  try {
    const transporter = createTransporter(config);
    const info = await transporter.sendMail({
      from,
      to: config.notifyEmail,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });

    return { sent: true, messageId: info.messageId };
  } catch (error) {
    console.warn(
      `[Aveum] Morning email failed to send: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      sent: false,
      skippedReason: `SMTP send failed: ${error instanceof Error ? error.message : "Unknown error."}`,
    };
  }
}
