import { describe, expect, it, vi } from "vitest";
import {
  buildMorningEmailContent,
  readMorningEmailConfigFromEnv,
  sendMorningReport,
  type MorningEmailConfig,
} from "../features/notifications/morningEmailReport";
import type { DailySavingsReport } from "../features/report/dailySavingsReport";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const DATE_ISO = "2026-03-25T06:00:00Z";

function makeReport(overrides: Partial<DailySavingsReport> = {}): DailySavingsReport {
  return {
    savedTodayPence: 238,
    earnedFromExportPence: 44,
    cheapestSlotUsed: { time: "01:00", pricePencePerKwh: 2.3 },
    batteryDischargedAt: { time: "17:00", pricePencePerKwh: 34.0 },
    evChargedAt: { time: "07:00", pricePencePerKwh: 7.2 },
    oneLiner:
      "Aveum charged your battery at 2.3p and discharged at 34.0p, saving you £2.38 today.",
    nightlyNarrative:
      "Aveum charged your battery overnight at 2.3p. During the peak period it discharged at 34.0p. Your EV was ready before departure. In total, Aveum saved you £2.38.",
    ...overrides,
  };
}

const SMTP_CONFIG: MorningEmailConfig = {
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUser: "user@example.com",
  smtpPass: "secret",
  notifyEmail: "owner@example.com",
};

// ── buildMorningEmailContent ───────────────────────────────────────────────────

describe("buildMorningEmailContent", () => {
  it("subject contains the formatted date", () => {
    const { subject } = buildMorningEmailContent(makeReport(), DATE_ISO);
    expect(subject).toContain("Wednesday, 25 March 2026");
    expect(subject).toMatch(/^Aveum — your energy summary for /);
  });

  it("subject matches the expected template", () => {
    const { subject } = buildMorningEmailContent(makeReport(), DATE_ISO);
    expect(subject).toBe("Aveum — your energy summary for Wednesday, 25 March 2026");
  });

  it("plain text contains the hero saving figure", () => {
    const { text } = buildMorningEmailContent(makeReport(), DATE_ISO);
    expect(text).toContain("You saved £2.38 today");
  });

  it("HTML contains the hero saving figure", () => {
    const { html } = buildMorningEmailContent(makeReport(), DATE_ISO);
    expect(html).toContain("You saved £2.38 today");
  });

  it("plain text contains charge price bullet", () => {
    const { text } = buildMorningEmailContent(makeReport(), DATE_ISO);
    expect(text).toContain("Battery charged at 2.3p/kWh (01:00)");
  });

  it("plain text contains discharge peak bullet", () => {
    const { text } = buildMorningEmailContent(makeReport(), DATE_ISO);
    expect(text).toContain("34.0p/kWh");
  });

  it("plain text contains EV ready bullet when evChargedAt is set", () => {
    const { text } = buildMorningEmailContent(makeReport(), DATE_ISO);
    expect(text).toMatch(/EV charged.*07:00.*ready before departure/);
  });

  it("plain text contains export earnings bullet when earnedFromExportPence > 1", () => {
    const { text } = buildMorningEmailContent(makeReport({ earnedFromExportPence: 80 }), DATE_ISO);
    expect(text).toContain("£0.80");
  });

  it("omits export bullet when earnedFromExportPence is <= 1", () => {
    const { text } = buildMorningEmailContent(makeReport({ earnedFromExportPence: 0 }), DATE_ISO);
    expect(text).not.toContain("exporting solar");
  });

  it("shows monitoring fallback bullet when no actions occurred", () => {
    const { text } = buildMorningEmailContent(
      makeReport({
        cheapestSlotUsed: null,
        batteryDischargedAt: null,
        evChargedAt: null,
        earnedFromExportPence: 0,
      }),
      DATE_ISO,
    );
    expect(text).toContain("Aveum monitored your system");
  });

  it("shows 'kept optimised' hero when savedTodayPence is zero", () => {
    const { html } = buildMorningEmailContent(makeReport({ savedTodayPence: 0 }), DATE_ISO);
    expect(html).toContain("Aveum kept your system optimised today");
  });

  it("plain text contains the nightly narrative", () => {
    const report = makeReport();
    const { text } = buildMorningEmailContent(report, DATE_ISO);
    expect(text).toContain(report.nightlyNarrative);
  });

  it("plain text ends with the footer", () => {
    const { text } = buildMorningEmailContent(makeReport(), DATE_ISO);
    expect(text).toContain("Aveum is running automatically — nothing to do.");
  });

  it("HTML contains the footer", () => {
    const { html } = buildMorningEmailContent(makeReport(), DATE_ISO);
    expect(html).toContain("Aveum is running automatically");
  });
});

// ── readMorningEmailConfigFromEnv ──────────────────────────────────────────────

describe("readMorningEmailConfigFromEnv", () => {
  it("returns null when AVEUM_NOTIFY_EMAIL is absent", () => {
    expect(readMorningEmailConfigFromEnv({})).toBeNull();
  });

  it("returns null and warns when SMTP creds are incomplete", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = readMorningEmailConfigFromEnv({ AVEUM_NOTIFY_EMAIL: "user@example.com" });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("AVEUM_SMTP_HOST"));
    warnSpy.mockRestore();
  });

  it("parses full env config correctly", () => {
    const config = readMorningEmailConfigFromEnv({
      AVEUM_SMTP_HOST: "smtp.example.com",
      AVEUM_SMTP_PORT: "465",
      AVEUM_SMTP_USER: "user@example.com",
      AVEUM_SMTP_PASS: "secret",
      AVEUM_NOTIFY_EMAIL: "owner@example.com",
    });

    expect(config).not.toBeNull();
    expect(config?.smtpHost).toBe("smtp.example.com");
    expect(config?.smtpPort).toBe(465);
    expect(config?.notifyEmail).toBe("owner@example.com");
    expect(config?.fromEmail).toBe("user@example.com");
  });

  it("defaults port to 587 when AVEUM_SMTP_PORT is absent", () => {
    const config = readMorningEmailConfigFromEnv({
      AVEUM_SMTP_HOST: "smtp.example.com",
      AVEUM_SMTP_USER: "u",
      AVEUM_SMTP_PASS: "p",
      AVEUM_NOTIFY_EMAIL: "owner@example.com",
    });
    expect(config?.smtpPort).toBe(587);
  });
});

// ── sendMorningReport ──────────────────────────────────────────────────────────

describe("sendMorningReport", () => {
  it("skips sending and returns sent:false when config is null", async () => {
    const result = await sendMorningReport(makeReport(), DATE_ISO, null);
    expect(result.sent).toBe(false);
    expect(result.skippedReason).toMatch(/AVEUM_NOTIFY_EMAIL not set/);
  });

  it("calls sendMail with correct subject and content", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "msg-123" }));
    const createTransporter = vi.fn(() => ({ sendMail }));

    const result = await sendMorningReport(makeReport(), DATE_ISO, SMTP_CONFIG, createTransporter);

    expect(result.sent).toBe(true);
    expect(result.messageId).toBe("msg-123");

    const [mailOptions] = sendMail.mock.calls[0] as [Parameters<typeof sendMail>[0]];
    expect(mailOptions.subject).toBe("Aveum — your energy summary for Wednesday, 25 March 2026");
    expect(mailOptions.to).toBe("owner@example.com");
    expect(mailOptions.text).toContain("You saved £2.38 today");
    expect(mailOptions.html).toContain("You saved £2.38 today");
  });

  it("returns sent:false and does not throw when SMTP fails", async () => {
    const sendMail = vi.fn(async () => {
      throw new Error("Connection refused.");
    });
    const createTransporter = vi.fn(() => ({ sendMail }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await sendMorningReport(makeReport(), DATE_ISO, SMTP_CONFIG, createTransporter);

    expect(result.sent).toBe(false);
    expect(result.skippedReason).toContain("Connection refused.");
    warnSpy.mockRestore();
  });

  it("passes SMTP host and auth to the transporter factory", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "x" }));
    const createTransporter = vi.fn(() => ({ sendMail }));

    await sendMorningReport(makeReport(), DATE_ISO, SMTP_CONFIG, createTransporter);

    const [passedConfig] = createTransporter.mock.calls[0] as [MorningEmailConfig];
    expect(passedConfig.smtpHost).toBe("smtp.example.com");
    expect(passedConfig.smtpUser).toBe("user@example.com");
    expect(passedConfig.smtpPass).toBe("secret");
  });
});
