import { describe, expect, it, vi } from "vitest";
import {
  buildEnvLocalContent,
  runBetaOnboardingWithAsk,
  type OnboardingAnswers,
  type AskFn,
} from "../features/onboarding/betaOnboarding";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Builds an AskFn that returns answers from a queue in order. */
function makeSequentialAsk(answers: string[]): AskFn {
  const queue = [...answers];
  return async (_question: string) => queue.shift() ?? "";
}

/** Full happy-path answer sequence matching the prompt order. */
function happyPathAnswers(): string[] {
  return [
    "Alice",                    // name
    "alice@example.com",        // email
    "1,2,5",                    // devices: Tesla EV, GivEnergy battery, Octopus smart meter
    "sk_live_abc123",           // Octopus API key
    "A-1A2B3C4D",              // Octopus account number
    "solcast-key-xyz",          // Solcast API key
    "abc-resource-123",         // Solcast resource ID
    "07:30",                    // EV departure time
    "80",                       // EV target charge %
  ];
}

function happyPathAnswerObject(): OnboardingAnswers {
  return {
    name: "Alice",
    email: "alice@example.com",
    devices: ["tesla_ev", "givenergy_battery", "octopus_smart_meter"],
    octopusApiKey: "sk_live_abc123",
    octopusAccountNumber: "A-1A2B3C4D",
    solcastApiKey: "solcast-key-xyz",
    solcastResourceId: "abc-resource-123",
    evDepartureTime: "07:30",
    evTargetChargePercent: "80",
  };
}

// ── buildEnvLocalContent ───────────────────────────────────────────────────────

describe("buildEnvLocalContent", () => {
  it("contains AVEUM_USER_NAME", () => {
    const content = buildEnvLocalContent(happyPathAnswerObject());
    expect(content).toContain("AVEUM_USER_NAME=Alice");
  });

  it("contains AVEUM_NOTIFY_EMAIL", () => {
    const content = buildEnvLocalContent(happyPathAnswerObject());
    expect(content).toContain("AVEUM_NOTIFY_EMAIL=alice@example.com");
  });

  it("contains OCTOPUS_API_KEY", () => {
    const content = buildEnvLocalContent(happyPathAnswerObject());
    expect(content).toContain("OCTOPUS_API_KEY=sk_live_abc123");
  });

  it("contains OCTOPUS_ACCOUNT_NUMBER", () => {
    const content = buildEnvLocalContent(happyPathAnswerObject());
    expect(content).toContain("OCTOPUS_ACCOUNT_NUMBER=A-1A2B3C4D");
  });

  it("contains AVEUM_DEVICES listing selected devices", () => {
    const content = buildEnvLocalContent(happyPathAnswerObject());
    expect(content).toContain("AVEUM_DEVICES=tesla_ev,givenergy_battery,octopus_smart_meter");
  });

  it("contains EV departure time and target charge when Tesla EV selected", () => {
    const content = buildEnvLocalContent(happyPathAnswerObject());
    expect(content).toContain("EV_DEPARTURE_TIME=07:30");
    expect(content).toContain("EV_TARGET_CHARGE_PERCENT=80");
  });

  it("omits EV keys when Tesla EV is not in devices", () => {
    const answers: OnboardingAnswers = {
      ...happyPathAnswerObject(),
      devices: ["octopus_smart_meter"],
      evDepartureTime: "",
      evTargetChargePercent: "",
    };
    const content = buildEnvLocalContent(answers);
    expect(content).not.toContain("EV_DEPARTURE_TIME");
    expect(content).not.toContain("EV_TARGET_CHARGE_PERCENT");
  });

  it("contains Solcast keys when solcastApiKey is provided", () => {
    const content = buildEnvLocalContent(happyPathAnswerObject());
    expect(content).toContain("SOLCAST_API_KEY=solcast-key-xyz");
    expect(content).toContain("SOLCAST_RESOURCE_ID=abc-resource-123");
  });

  it("omits Solcast section when solcastApiKey is empty", () => {
    const answers: OnboardingAnswers = {
      ...happyPathAnswerObject(),
      solcastApiKey: "",
      solcastResourceId: "",
    };
    const content = buildEnvLocalContent(answers);
    expect(content).not.toContain("SOLCAST_API_KEY=");
  });

  it("contains GivEnergy placeholder keys when battery selected", () => {
    const content = buildEnvLocalContent(happyPathAnswerObject());
    expect(content).toContain("GIVENERGY_API_KEY=");
    expect(content).toContain("GIVENERGY_INVERTER_SERIAL=");
  });

  it("omits GivEnergy section when battery not selected", () => {
    const answers: OnboardingAnswers = {
      ...happyPathAnswerObject(),
      devices: ["tesla_ev"],
    };
    const content = buildEnvLocalContent(answers);
    expect(content).not.toContain("GIVENERGY_API_KEY");
  });

  it("contains Solax placeholder keys when Solax inverter selected", () => {
    const answers: OnboardingAnswers = {
      ...happyPathAnswerObject(),
      devices: ["solax_inverter"],
    };
    const content = buildEnvLocalContent(answers);
    expect(content).toContain("SOLAX_API_KEY=");
    expect(content).toContain("SOLAX_INVERTER_SN=");
  });

  it("contains Zappi placeholder keys when Zappi charger selected", () => {
    const answers: OnboardingAnswers = {
      ...happyPathAnswerObject(),
      devices: ["zappi_charger"],
    };
    const content = buildEnvLocalContent(answers);
    expect(content).toContain("MYENERGI_HUB_SERIAL=");
    expect(content).toContain("MYENERGI_API_KEY=");
  });

  it("starts with the do-not-commit warning comment", () => {
    const content = buildEnvLocalContent(happyPathAnswerObject());
    expect(content.startsWith("# Generated by Aveum beta onboarding")).toBe(true);
  });
});

// ── runBetaOnboardingWithAsk ───────────────────────────────────────────────────

describe("runBetaOnboardingWithAsk", () => {
  it("writes .env.local to the project root", async () => {
    const writeFileFn = vi.fn();
    const ask = makeSequentialAsk(happyPathAnswers());

    await runBetaOnboardingWithAsk(ask, writeFileFn, "/tmp/project");

    expect(writeFileFn).toHaveBeenCalledTimes(1);
    const [filePath] = writeFileFn.mock.calls[0] as [string, string];
    expect(filePath).toBe("/tmp/project/.env.local");
  });

  it("written content contains all expected keys", async () => {
    const writeFileFn = vi.fn();
    const ask = makeSequentialAsk(happyPathAnswers());

    await runBetaOnboardingWithAsk(ask, writeFileFn, "/tmp/project");

    const [, content] = writeFileFn.mock.calls[0] as [string, string];
    expect(content).toContain("AVEUM_USER_NAME=Alice");
    expect(content).toContain("AVEUM_NOTIFY_EMAIL=alice@example.com");
    expect(content).toContain("OCTOPUS_API_KEY=sk_live_abc123");
    expect(content).toContain("OCTOPUS_ACCOUNT_NUMBER=A-1A2B3C4D");
    expect(content).toContain("SOLCAST_API_KEY=solcast-key-xyz");
    expect(content).toContain("EV_DEPARTURE_TIME=07:30");
    expect(content).toContain("EV_TARGET_CHARGE_PERCENT=80");
  });

  it("returns the answers and envLocalPath", async () => {
    const writeFileFn = vi.fn();
    const ask = makeSequentialAsk(happyPathAnswers());

    const result = await runBetaOnboardingWithAsk(ask, writeFileFn, "/tmp/project");

    expect(result.answers.name).toBe("Alice");
    expect(result.answers.email).toBe("alice@example.com");
    expect(result.envLocalPath).toBe("/tmp/project/.env.local");
  });

  it("skips Solcast resource ID prompt when API key is empty", async () => {
    const writeFileFn = vi.fn();
    // Replace Solcast answers with empty key (no resource ID prompt follows)
    const answers = [
      "Bob",
      "bob@example.com",
      "5",              // only octopus smart meter — no Tesla EV, so no EV prompts
      "oct-key",
      "A-9Z8Y7X6W",
      "",               // empty Solcast API key → skip resource ID
      // no more prompts
    ];
    const ask = makeSequentialAsk(answers);

    const result = await runBetaOnboardingWithAsk(ask, writeFileFn, "/tmp/project");

    expect(result.answers.solcastApiKey).toBe("");
    expect(result.answers.solcastResourceId).toBe("");
    const [, content] = writeFileFn.mock.calls[0] as [string, string];
    expect(content).not.toContain("SOLCAST_API_KEY=");
  });

  it("skips EV prompts when Tesla EV is not selected", async () => {
    const writeFileFn = vi.fn();
    const answers = [
      "Carol",
      "carol@example.com",
      "2",          // only GivEnergy battery
      "oct-key",
      "A-1234",
      "",           // no Solcast
    ];
    const ask = makeSequentialAsk(answers);

    const result = await runBetaOnboardingWithAsk(ask, writeFileFn, "/tmp/project");

    expect(result.answers.devices).toEqual(["givenergy_battery"]);
    expect(result.answers.evDepartureTime).toBe("");
    expect(result.answers.evTargetChargePercent).toBe("");
    const [, content] = writeFileFn.mock.calls[0] as [string, string];
    expect(content).not.toContain("EV_DEPARTURE_TIME");
  });

  it("handles no devices selected gracefully", async () => {
    const writeFileFn = vi.fn();
    const answers = [
      "Dave",
      "dave@example.com",
      "",       // no devices
      "oct",
      "A-0000",
      "",       // no Solcast
    ];
    const ask = makeSequentialAsk(answers);

    const result = await runBetaOnboardingWithAsk(ask, writeFileFn, "/tmp/project");

    expect(result.answers.devices).toEqual([]);
    const [, content] = writeFileFn.mock.calls[0] as [string, string];
    expect(content).toContain("AVEUM_DEVICES=");
  });
});
