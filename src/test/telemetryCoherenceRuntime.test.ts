/**
 * Telemetry coherence runtime harness.
 *
 * Verifies that Aveum's canonical runtime remains authoritative when device
 * telemetry is stale, delayed, or contradictory.
 *
 * Guardrails enforced by these tests:
 *   - Canonical opportunity identity (opportunityId / decisionId) is never
 *     rewritten by post-execution telemetry observations.
 *   - Journal entries record execution truth, not telemetry state.
 *   - Stale or contradictory telemetry does not generate spurious opportunities
 *     or misclassify dispatched commands as failed.
 *   - Telemetry coherence metadata is informational, not authoritative.
 */
import { describe, expect, it } from "vitest";
import { SimulatedBatteryAdapter } from "../integrations/simulatedBattery/simulatedBatteryAdapter";
import { DeviceAdapterRegistry } from "../adapters/adapterRegistry";
import { LiveAdapterDeviceCommandExecutor } from "../application/controlLoopExecution/liveAdapterExecutor";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import { toExecutionJournalEntry } from "../application/controlLoopExecution/toExecutionJournalEntry";
import { InMemoryDeviceCapabilitiesProvider } from "../capabilities/deviceCapabilitiesProvider";
import { InMemoryExecutionJournalStore } from "../journal/executionJournalStore";
import type { ControlLoopInput } from "../controlLoop/controlLoop";
import type { SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOutput } from "../domain/optimizer";
import type { CommandExecutionResult } from "../application/controlLoopExecution/types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture constants
// ─────────────────────────────────────────────────────────────────────────────
const DEVICE_ID = "simulated-battery";
const PLAN_ID = "plan-coherence-test";
const DECISION_ID = "decision-coherence-test";
const OPPORTUNITY_ID = "opp-coherence-test-1";
const NOW = "2026-03-17T10:05:00.000Z";

function buildSystemState(): SystemState {
  return {
    siteId: "site-coherence",
    capturedAt: NOW,
    timezone: "Europe/London",
    devices: [],
    homeLoadW: 1000,
    solarGenerationW: 200,
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 800,
  };
}

function buildDecision(): OptimizerDecision {
  return {
    decisionId: DECISION_ID,
    startAt: "2026-03-17T10:00:00.000Z",
    endAt: "2026-03-17T10:30:00.000Z",
    executionWindow: {
      startAt: "2026-03-17T10:00:00.000Z",
      endAt: "2026-03-17T10:30:00.000Z",
    },
    action: "charge_battery",
    targetDeviceIds: [DEVICE_ID],
    targetDevices: [{ deviceId: DEVICE_ID }],
    reason: "Coherence test: charge during cheap window",
    confidence: 0.9,
  };
}

function buildOptimizerOutput(): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: PLAN_ID,
    generatedAt: "2026-03-17T10:00:00.000Z",
    planningWindow: {
      startAt: "2026-03-17T10:00:00.000Z",
      endAt: "2026-03-17T10:30:00.000Z",
    },
    status: "ok",
    headline: "Coherence test plan",
    decisions: [buildDecision()],
    opportunities: [
      {
        opportunityId: OPPORTUNITY_ID,
        decisionId: DECISION_ID,
        action: "charge_battery",
        targetDeviceId: DEVICE_ID,
        command: {
          commandId: "cmd-coherence-test-1",
          deviceId: DEVICE_ID,
          issuedAt: "2026-03-17T10:00:00.000Z",
          type: "set_mode",
          mode: "charge",
          effectiveWindow: {
            startAt: "2026-03-17T10:00:00.000Z",
            endAt: "2026-03-17T10:30:00.000Z",
          },
        },
        economicSignals: {
          effectiveStoredEnergyValuePencePerKwh: 14.2,
          marginalImportAvoidancePencePerKwh: 12.4,
        },
      },
    ],
    recommendedCommands: [],
    summary: { expectedImportCostPence: 80, expectedExportRevenuePence: 0, planningNetRevenueSurplusPence: -80 },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.9,
  };
}

function buildInput(): ControlLoopInput {
  return {
    now: NOW,
    systemState: buildSystemState(),
    optimizerOutput: buildOptimizerOutput(),
  };
}

function buildCapabilitiesProvider() {
  return new InMemoryDeviceCapabilitiesProvider([
    {
      deviceId: DEVICE_ID,
      supportedCommandKinds: ["set_mode"],
      supportedModes: ["charge", "discharge", "hold"],
      minimumCommandWindowMinutes: 15,
      supportsOverlappingWindows: true,
      supportsImmediateExecution: true,
      schemaVersion: "capabilities.v1",
    },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: Adapter-level coherence scenario tests
// ─────────────────────────────────────────────────────────────────────────────

describe("SimulatedBatteryAdapter coherence profiles", () => {
  describe("delayed_ack_then_state_update", () => {
    it("returns delayed coherenceStatus for 3 polls after command, then coherent", async () => {
      const adapter = new SimulatedBatteryAdapter({
        deviceId: DEVICE_ID,
        scenario: "delayed_ack_then_state_update",
        initialSocPercent: 40,
        now: () => new Date(NOW),
        random: () => 0.9,
      });

      const cmdResult = await adapter.executeCanonicalCommand({
        kind: "set_mode",
        targetDeviceId: DEVICE_ID,
        mode: "charge",
      });
      expect(cmdResult.status).toBe("accepted");

      // Polls 1–3: reported as delayed (lag window open)
      for (let i = 0; i < 3; i++) {
        const telemetry = await adapter.getTelemetry();
        expect(telemetry.coherenceStatus).toBe("delayed");
        // Mode appears frozen at pre-command value in charge_rate
        expect(telemetry.charge_rate).toBe(0);
      }

      // Poll 4: lag window exhausted, adapter reports converged state
      const converged = await adapter.getTelemetry();
      expect(converged.coherenceStatus).toBe("coherent");
      expect(converged.charge_rate).toBe(3600);
    });

    it("canonical command result is accepted throughout the delay window", async () => {
      const adapter = new SimulatedBatteryAdapter({
        deviceId: DEVICE_ID,
        scenario: "delayed_ack_then_state_update",
        now: () => new Date(NOW),
        random: () => 0.9,
      });

      const result = await adapter.executeCanonicalCommand({
        kind: "set_mode",
        targetDeviceId: DEVICE_ID,
        mode: "charge",
      });

      // The command execution result is authoritative — accepted despite delayed telemetry.
      expect(result.status).toBe("accepted");
      expect(result.failureReasonCode).toBeUndefined();
    });
  });

  describe("accepted_command_but_stale_soc", () => {
    it("power metrics update immediately but SOC stays frozen — contradictory coherence", async () => {
      const adapter = new SimulatedBatteryAdapter({
        deviceId: DEVICE_ID,
        scenario: "accepted_command_but_stale_soc",
        initialSocPercent: 50,
        now: () => new Date(NOW),
        random: () => 0.9,
      });

      const beforeSoc = (await adapter.getTelemetry()).state_of_charge;

      await adapter.executeCanonicalCommand({
        kind: "set_mode",
        targetDeviceId: DEVICE_ID,
        mode: "charge",
      });

      const after = await adapter.getTelemetry();

      // Power metric reflects new mode — the command was executed.
      expect(after.charge_rate).toBe(3600);
      // SOC sensor is stuck — contradictory evidence.
      expect(after.state_of_charge).toBe(beforeSoc);
      expect(after.coherenceStatus).toBe("contradictory");
    });

    it("coherence returns to coherent when mode is idle", async () => {
      const adapter = new SimulatedBatteryAdapter({
        deviceId: DEVICE_ID,
        scenario: "accepted_command_but_stale_soc",
        now: () => new Date(NOW),
        random: () => 0.9,
      });

      // Device starts idle — no contradiction possible
      const telemetry = await adapter.getTelemetry();
      expect(telemetry.coherenceStatus).toBe("coherent");
    });
  });

  describe("contradictory_power_vs_soc", () => {
    it("SOC increments normally but power sensor reports 0 — contradictory coherence", async () => {
      const adapter = new SimulatedBatteryAdapter({
        deviceId: DEVICE_ID,
        scenario: "contradictory_power_vs_soc",
        initialSocPercent: 45,
        now: () => new Date(NOW),
        random: () => 0.9,
      });

      await adapter.executeCanonicalCommand({
        kind: "set_mode",
        targetDeviceId: DEVICE_ID,
        mode: "charge",
      });

      const t1 = await adapter.getTelemetry();
      const t2 = await adapter.getTelemetry();

      // Power sensor always returns 0 — faulty meter.
      expect(t1.charge_rate).toBe(0);
      expect(t1.discharge_rate).toBe(0);
      // SOC ticks upward — device is actually charging.
      expect(t2.state_of_charge).toBeGreaterThanOrEqual(t1.state_of_charge);
      // Coherence is contradictory: energy appears to be flowing but power sensor disagrees.
      expect(t1.coherenceStatus).toBe("contradictory");
    });

    it("coherence is coherent when device is idle — no measurement disagreement", async () => {
      const adapter = new SimulatedBatteryAdapter({
        deviceId: DEVICE_ID,
        scenario: "contradictory_power_vs_soc",
        now: () => new Date(NOW),
        random: () => 0.9,
      });

      const telemetry = await adapter.getTelemetry();
      expect(telemetry.charge_rate).toBe(0);
      expect(telemetry.discharge_rate).toBe(0);
      expect(telemetry.coherenceStatus).toBe("coherent");
    });
  });

  describe("telemetry_replay_old_snapshot", () => {
    it("serves frozen pre-command snapshot for 3 polls (stale), then resumes real state", async () => {
      const adapter = new SimulatedBatteryAdapter({
        deviceId: DEVICE_ID,
        scenario: "telemetry_replay_old_snapshot",
        initialSocPercent: 55,
        now: () => new Date(NOW),
        random: () => 0.9,
      });

      await adapter.executeCanonicalCommand({
        kind: "set_mode",
        targetDeviceId: DEVICE_ID,
        mode: "charge",
      });

      // Polls 1–3: frozen snapshot (old capturedAt, charge_rate = 0 from pre-command mode)
      for (let i = 0; i < 3; i++) {
        const t = await adapter.getTelemetry();
        expect(t.stale).toBe(true);
        expect(t.coherenceStatus).toBe("stale");
        expect(t.charge_rate).toBe(0);
      }

      // Poll 4: snapshot exhausted, adapter returns real state
      const real = await adapter.getTelemetry();
      expect(real.stale).toBe(false);
      expect(real.coherenceStatus).toBe("coherent");
      expect(real.charge_rate).toBe(3600);
    });
  });

  describe("eventual_consistency_device", () => {
    it("delays telemetry convergence for 5 polls, then becomes coherent", async () => {
      const adapter = new SimulatedBatteryAdapter({
        deviceId: DEVICE_ID,
        scenario: "eventual_consistency_device",
        now: () => new Date(NOW),
        random: () => 0.9,
      });

      await adapter.executeCanonicalCommand({
        kind: "set_mode",
        targetDeviceId: DEVICE_ID,
        mode: "discharge",
      });

      // Polls 1–5: delayed
      for (let i = 0; i < 5; i++) {
        const t = await adapter.getTelemetry();
        expect(t.coherenceStatus).toBe("delayed");
        expect(t.discharge_rate).toBe(0);
      }

      // Poll 6: converged
      const converged = await adapter.getTelemetry();
      expect(converged.coherenceStatus).toBe("coherent");
      expect(converged.discharge_rate).toBe(3400);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Multi-cycle canonical identity preservation (full pipeline)
// ─────────────────────────────────────────────────────────────────────────────

describe("Canonical identity survives telemetry coherence drift (full pipeline)", () => {
  it("opportunityId and decisionId are stable across cycles with delayed telemetry", async () => {
    const adapter = new SimulatedBatteryAdapter({
      deviceId: DEVICE_ID,
      scenario: "delayed_ack_then_state_update",
      now: () => new Date(NOW),
      random: () => 0.9,
    });
    const executor = new LiveAdapterDeviceCommandExecutor(new DeviceAdapterRegistry([adapter]));

    const cycleResults: CommandExecutionResult[] = [];

    // Run 4 cycles — the first 3 overlap with the telemetry lag window.
    for (let cycle = 0; cycle < 4; cycle++) {
      const { executionResults } = await runControlLoopExecutionService(
        buildInput(),
        executor,
        buildCapabilitiesProvider(),
      );
      expect(executionResults).toHaveLength(1);
      cycleResults.push(executionResults[0]);
    }

    // Canonical identity must be completely stable across all cycles.
    for (const result of cycleResults) {
      expect(result.opportunityId).toBe(OPPORTUNITY_ID);
      expect(result.decisionId).toBe(DECISION_ID);
      expect(result.opportunityProvenance?.kind).toBe("native_canonical");
    }
  });

  it("journal entries preserve canonical opportunityId regardless of telemetry coherence", async () => {
    const adapter = new SimulatedBatteryAdapter({
      deviceId: DEVICE_ID,
      scenario: "telemetry_replay_old_snapshot",
      now: () => new Date(NOW),
      random: () => 0.9,
    });
    const executor = new LiveAdapterDeviceCommandExecutor(new DeviceAdapterRegistry([adapter]));
    const journal = new InMemoryExecutionJournalStore();

    // Run 4 cycles (3 with stale snapshot + 1 converged)
    for (let cycle = 0; cycle < 4; cycle++) {
      await runControlLoopExecutionService(
        buildInput(),
        executor,
        buildCapabilitiesProvider(),
        undefined,
        journal,
      );
    }

    const entries = journal.getAll();
    expect(entries).toHaveLength(4);

    // Every journal entry must carry the same canonical opportunity — regardless of
    // what the device telemetry reported during any of those cycles.
    for (const entry of entries) {
      expect(entry.opportunityId).toBe(OPPORTUNITY_ID);
      expect(entry.decisionId).toBe(DECISION_ID);
      expect(entry.status).toBe("issued");
    }
  });

  it("delayed telemetry does not misclassify a dispatched command as failed", async () => {
    const adapter = new SimulatedBatteryAdapter({
      deviceId: DEVICE_ID,
      scenario: "delayed_ack_then_state_update",
      now: () => new Date(NOW),
      random: () => 0.9,
    });
    const executor = new LiveAdapterDeviceCommandExecutor(new DeviceAdapterRegistry([adapter]));

    // Run 3 cycles within the delay window
    for (let cycle = 0; cycle < 3; cycle++) {
      const { executionResults } = await runControlLoopExecutionService(
        buildInput(),
        executor,
        buildCapabilitiesProvider(),
      );

      const result = executionResults[0];

      // The execution result reflects what the adapter reported — accepted (issued).
      // It must NOT be reclassified as failed just because telemetry hasn't converged.
      expect(result.status).toBe("issued");
    }

    // Verify the telemetry was indeed in the delayed window (confirming the scenario ran).
    // Each service cycle sends a new command, resetting the lag window — so after 3 cycles
    // the lag is still active. This is the expected real-world behavior: every command
    // resets the convergence window on the device.
    const telemetry = await adapter.getTelemetry();
    expect(telemetry.coherenceStatus).toBe("delayed"); // Lag reset by the most recent command
  });

  it("contradictory telemetry does not generate a spurious second opportunity", async () => {
    const adapter = new SimulatedBatteryAdapter({
      deviceId: DEVICE_ID,
      scenario: "contradictory_power_vs_soc",
      now: () => new Date(NOW),
      random: () => 0.9,
    });
    const executor = new LiveAdapterDeviceCommandExecutor(new DeviceAdapterRegistry([adapter]));
    const journal = new InMemoryExecutionJournalStore();

    await runControlLoopExecutionService(buildInput(), executor, buildCapabilitiesProvider(), undefined, journal);
    await runControlLoopExecutionService(buildInput(), executor, buildCapabilitiesProvider(), undefined, journal);

    const entries = journal.getAll();

    // Two cycles, one opportunity each. No spurious duplicates from contradictory telemetry.
    expect(entries).toHaveLength(2);
    const opportunityIds = entries.map((e) => e.opportunityId);
    // Each entry should have the same canonical opportunity ID — same plan, same command.
    expect(opportunityIds.every((id) => id === OPPORTUNITY_ID)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Journal records telemetry coherence as informational metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("Journal telemetryCoherence field — informational metadata projection", () => {
  const baseResult: CommandExecutionResult = {
    opportunityId: OPPORTUNITY_ID,
    opportunityProvenance: { kind: "native_canonical", canonicalizedFromLegacy: false },
    executionRequestId: "exec-journal-test-1",
    requestId: "exec-journal-test-1",
    idempotencyKey: `${PLAN_ID}:decision:${DECISION_ID}:cmd:battery:set_mode:charge`,
    decisionId: DECISION_ID,
    targetDeviceId: DEVICE_ID,
    commandId: "cmd-journal-test-1",
    deviceId: DEVICE_ID,
    status: "issued",
  };

  const canonicalCommand = {
    kind: "set_mode" as const,
    targetDeviceId: DEVICE_ID,
    mode: "charge" as const,
  };

  it("projects telemetryCoherence: delayed into journal entry without altering status", () => {
    const result: CommandExecutionResult = { ...baseResult, telemetryCoherence: "delayed" };
    const entry = toExecutionJournalEntry(canonicalCommand, result, NOW);

    expect(entry.telemetryCoherence).toBe("delayed");
    // Execution truth is untouched — the command was issued.
    expect(entry.status).toBe("issued");
    expect(entry.opportunityId).toBe(OPPORTUNITY_ID);
    expect(entry.decisionId).toBe(DECISION_ID);
  });

  it("projects telemetryCoherence: contradictory into journal entry without altering status", () => {
    const result: CommandExecutionResult = { ...baseResult, telemetryCoherence: "contradictory" };
    const entry = toExecutionJournalEntry(canonicalCommand, result, NOW);

    expect(entry.telemetryCoherence).toBe("contradictory");
    expect(entry.status).toBe("issued");
  });

  it("projects telemetryCoherence: stale into journal entry without altering status", () => {
    const result: CommandExecutionResult = { ...baseResult, telemetryCoherence: "stale" };
    const entry = toExecutionJournalEntry(canonicalCommand, result, NOW);

    expect(entry.telemetryCoherence).toBe("stale");
    expect(entry.status).toBe("issued");
  });

  it("when telemetryCoherence is absent, journal entry is unaffected — field is optional", () => {
    const entry = toExecutionJournalEntry(canonicalCommand, baseResult, NOW);

    expect(entry.telemetryCoherence).toBeUndefined();
    // Core journal fields are fully populated regardless.
    expect(entry.status).toBe("issued");
    expect(entry.opportunityId).toBe(OPPORTUNITY_ID);
    expect(entry.schemaVersion).toBe("execution-journal.v1");
  });

  it("journal entry with stale telemetryCoherence still records issued status — telemetry is not authoritative", () => {
    // This is the canonical anti-regression test:
    // even when device telemetry says something contradictory,
    // if the adapter accepted the command, the journal says "issued".
    const staleResult: CommandExecutionResult = {
      ...baseResult,
      status: "issued",
      telemetryCoherence: "stale",
    };
    const entry = toExecutionJournalEntry(canonicalCommand, staleResult, NOW);

    expect(entry.status).toBe("issued");
    expect(entry.telemetryCoherence).toBe("stale");
    // Canonical identity is preserved exactly as committed.
    expect(entry.opportunityId).toBe(OPPORTUNITY_ID);
    expect(entry.opportunityProvenance?.kind).toBe("native_canonical");
    expect(entry.decisionId).toBe(DECISION_ID);
  });
});
