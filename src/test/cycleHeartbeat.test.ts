import { describe, expect, it, vi } from "vitest";
import type { SystemState } from "../domain";
import type { OptimizationMode, OptimizerOutput } from "../domain/optimizer";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
} from "../application/controlLoopExecution/types";
import { InMemoryExecutionJournalStore } from "../journal/executionJournalStore";
import type { RuntimeExecutionGuardrailContext } from "../application/controlLoopExecution/executionPolicyTypes";
import type { ExecutionCycleFinancialContext } from "../journal/executionJournal";
import type { CanonicalValueLedger } from "../domain/valueLedger";

function buildSystemState(): SystemState {
  return {
    siteId: "site-1",
    capturedAt: "2026-03-16T10:00:00.000Z",
    timezone: "Europe/London",
    devices: [],
    homeLoadW: 1200,
    solarGenerationW: 0,
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 1200,
  };
}

function buildOptimizerOutput(
  includeCommand: boolean,
  opts?: { planFreshness?: "fresh" | "stale" | "expired" },
): OptimizerOutput {
  const now = "2026-03-16T10:05:00.000Z";
  const generatedAt = opts?.planFreshness === "expired" ? "2026-03-16T07:00:00.000Z" : "2026-03-16T10:00:00.000Z";
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-heartbeat",
    generatedAt,
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    status: "ok",
    headline: "Test heartbeat plan",
    decisions: includeCommand
      ? [
          {
            decisionId: "decision-1",
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
            executionWindow: {
              startAt: "2026-03-16T10:00:00.000Z",
              endAt: "2026-03-16T10:30:00.000Z",
            },
            action: "charge_battery",
            targetDeviceIds: ["battery"],
            targetDevices: [{ deviceId: "battery" }],
            reason: "Cheap rate",
            confidence: 0.9,
          },
        ]
      : [],
    recommendedCommands: includeCommand
      ? [
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: now,
            type: "set_mode",
            mode: "charge",
            effectiveWindow: {
              startAt: "2026-03-16T10:00:00.000Z",
              endAt: "2026-03-16T10:30:00.000Z",
            },
          },
        ]
      : [],
    summary: {
      expectedImportCostPence: 120,
      expectedExportRevenuePence: 0,
      planningNetRevenueSurplusPence: -120,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.9,
  };
}

function buildValueLedger(savingsPence = 28): CanonicalValueLedger {
  return {
    optimizationMode: "cost",
    estimatedImportCostPence: 80,
    estimatedExportRevenuePence: 20,
    estimatedBatteryDegradationCostPence: 2,
    estimatedNetCostPence: 62,
    baselineType: "hold_current_state",
    baselineNetCostPence: 90,
    baselineImportCostPence: 90,
    baselineExportRevenuePence: 0,
    baselineBatteryDegradationCostPence: 0,
    estimatedSavingsVsBaselinePence: savingsPence,
    assumptions: [],
    caveats: [],
    confidence: 0.85,
  };
}

function buildCycleFinancialCtx(opts?: {
  mode?: OptimizationMode;
  conservativeAdjustmentApplied?: boolean;
  savingsPence?: number;
}): Omit<ExecutionCycleFinancialContext, "decisionsTaken"> {
  return {
    optimizationMode: opts?.mode ?? "cost",
    valueLedger: buildValueLedger(opts?.savingsPence ?? 28),
    conservativeAdjustmentApplied: opts?.conservativeAdjustmentApplied,
  };
}

function buildExecutor(status: "issued" | "failed" = "issued"): DeviceCommandExecutor {
  return {
    execute: vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((req): CommandExecutionResult => ({
        executionRequestId: req.executionRequestId,
        requestId: req.requestId,
        idempotencyKey: req.idempotencyKey,
        decisionId: req.decisionId,
        targetDeviceId: req.targetDeviceId,
        commandId: req.commandId,
        deviceId: req.targetDeviceId,
        status,
      })),
    ),
  };
}

const NOW = "2026-03-16T10:05:00.000Z";

describe("cycle heartbeat journal", () => {
  it("writes a heartbeat even when the planner produces no commands", async () => {
    const journal = new InMemoryExecutionJournalStore();
    const executor = buildExecutor();

    await runControlLoopExecutionService(
      {
        now: NOW,
        systemState: buildSystemState(),
        optimizerOutput: buildOptimizerOutput(false),
      },
      executor,
      undefined,
      undefined,
      journal,
      undefined,
      undefined,
      "standard",
      { cycleId: "cycle-no-cmd-1", replanReason: undefined },
    );

    const heartbeats = journal.getCycleHeartbeats();
    expect(heartbeats).toHaveLength(1);

    const hb = heartbeats[0];
    expect(hb.entryKind).toBe("cycle_heartbeat");
    expect(hb.cycleId).toBe("cycle-no-cmd-1");
    expect(hb.recordedAt).toBe(NOW);
    expect(hb.executionPosture).toBe("normal");
    expect(hb.commandsIssued).toBe(0);
    expect(hb.commandsSkipped).toBe(0);
    expect(hb.commandsFailed).toBe(0);
    expect(hb.commandsSuppressed).toBe(0);
    expect(hb.failClosedTriggered).toBe(false);
    expect(hb.schemaVersion).toBe("cycle-heartbeat.v1");

    // No command journal entries written for a no-command cycle
    expect(journal.getAll()).toHaveLength(0);
  });

  it("writes heartbeat with hold_only posture and suppression counts for safeHoldMode cycle", async () => {
    const journal = new InMemoryExecutionJournalStore();
    const executor = buildExecutor();

    const guardrail: RuntimeExecutionGuardrailContext = {
      safeHoldMode: true,
      planFreshnessStatus: "expired",
      replanTrigger: "expired_plan",
      stalePlanReuseCount: 4,
      stalePlanWarning: "Plan has been stale for 4 consecutive cycles. Hold-only mode active.",
    };

    await runControlLoopExecutionService(
      {
        now: NOW,
        systemState: buildSystemState(),
        optimizerOutput: buildOptimizerOutput(true),
      },
      executor,
      undefined,
      undefined,
      journal,
      undefined,
      guardrail,
      "standard",
      { cycleId: "cycle-hold-1", replanReason: "Plan expired, safe hold triggered" },
    );

    const heartbeats = journal.getCycleHeartbeats();
    expect(heartbeats).toHaveLength(1);

    const hb = heartbeats[0];
    expect(hb.entryKind).toBe("cycle_heartbeat");
    expect(hb.cycleId).toBe("cycle-hold-1");
    expect(hb.recordedAt).toBe(NOW);
    expect(hb.executionPosture).toBe("hold_only");
    expect(hb.safeHoldMode).toBe(true);
    expect(hb.planFreshnessStatus).toBe("expired");
    expect(hb.replanTrigger).toBe("expired_plan");
    expect(hb.stalePlanReuseCount).toBe(4);
    expect(hb.stalePlanWarning).toBe("Plan has been stale for 4 consecutive cycles. Hold-only mode active.");
    expect(hb.replanReason).toBe("Plan expired, safe hold triggered");
    expect(hb.commandsIssued).toBe(0);
    expect(hb.commandsSkipped).toBe(1);
    expect(hb.commandsSuppressed).toBe(1);
    expect(hb.failClosedTriggered).toBe(false);

    // Command-level journal entry also written for the suppressed command
    expect(journal.getAll()).toHaveLength(1);
  });

  it("writes heartbeat with failClosedTriggered=true when runtime context is missing in strict mode", async () => {
    const journal = new InMemoryExecutionJournalStore();
    const executor = buildExecutor();

    // No runtimeGuardrailContext, but strict mode: fail-closed should fire
    await runControlLoopExecutionService(
      {
        now: NOW,
        systemState: buildSystemState(),
        optimizerOutput: buildOptimizerOutput(true),
      },
      executor,
      undefined,
      undefined,
      journal,
      undefined,
      undefined, // <-- no guardrail context
      "continuous_live_strict",
      { cycleId: "cycle-fail-closed-1", replanReason: undefined },
    );

    const heartbeats = journal.getCycleHeartbeats();
    expect(heartbeats).toHaveLength(1);

    const hb = heartbeats[0];
    expect(hb.entryKind).toBe("cycle_heartbeat");
    expect(hb.cycleId).toBe("cycle-fail-closed-1");
    expect(hb.executionPosture).toBe("hold_only");
    expect(hb.failClosedTriggered).toBe(true);
    expect(hb.commandsIssued).toBe(0);
    expect(hb.commandsSkipped).toBe(1);
    expect(hb.commandsSuppressed).toBe(1);

    // Command-level journal entry also written for the denied command
    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].reasonCodes).toContain("RUNTIME_CONTEXT_MISSING");
  });

  it("writes a clean heartbeat for a normal fresh cycle with dispatched commands", async () => {
    const journal = new InMemoryExecutionJournalStore();
    const executor = buildExecutor("issued");

    const guardrail: RuntimeExecutionGuardrailContext = {
      safeHoldMode: false,
      planFreshnessStatus: "fresh",
      stalePlanReuseCount: 0,
    };

    await runControlLoopExecutionService(
      {
        now: NOW,
        systemState: buildSystemState(),
        optimizerOutput: buildOptimizerOutput(true),
      },
      executor,
      undefined,
      undefined,
      journal,
      undefined,
      guardrail,
      "continuous_live_strict",
      { cycleId: "cycle-normal-1" },
    );

    const heartbeats = journal.getCycleHeartbeats();
    expect(heartbeats).toHaveLength(1);

    const hb = heartbeats[0];
    expect(hb.entryKind).toBe("cycle_heartbeat");
    expect(hb.cycleId).toBe("cycle-normal-1");
    expect(hb.recordedAt).toBe(NOW);
    expect(hb.executionPosture).toBe("normal");
    expect(hb.safeHoldMode).toBe(false);
    expect(hb.planFreshnessStatus).toBe("fresh");
    expect(hb.stalePlanReuseCount).toBe(0);
    expect(hb.commandsIssued).toBe(1);
    expect(hb.commandsSkipped).toBe(0);
    expect(hb.commandsFailed).toBe(0);
    expect(hb.commandsSuppressed).toBe(0);
    expect(hb.failClosedTriggered).toBe(false);
    expect(hb.replanReason).toBeUndefined();

    // Command-level journal entry also present
    expect(journal.getAll()).toHaveLength(1);
    expect(journal.getAll()[0].status).toBe("issued");
  });

  it("aggregates heartbeat counters for heterogeneous multi-action cycles", async () => {
    const journal = new InMemoryExecutionJournalStore();
    const executor = buildExecutor("issued");

    const guardrail: RuntimeExecutionGuardrailContext = {
      safeHoldMode: false,
      planFreshnessStatus: "fresh",
      stalePlanReuseCount: 0,
    };

    await runControlLoopExecutionService(
      {
        now: NOW,
        systemState: buildSystemState(),
        optimizerOutput: {
          ...buildOptimizerOutput(false),
          decisions: [
            {
              decisionId: "decision-battery",
              startAt: "2026-03-16T10:00:00.000Z",
              endAt: "2026-03-16T10:30:00.000Z",
              executionWindow: {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
              },
              action: "charge_battery",
              targetDeviceIds: ["battery-1"],
              targetDevices: [{ deviceId: "battery-1", kind: "battery" }],
              reason: "Cheap import window",
              confidence: 0.9,
            },
            {
              decisionId: "decision-ev",
              startAt: "2026-03-16T10:00:00.000Z",
              endAt: "2026-03-16T10:30:00.000Z",
              executionWindow: {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
              },
              action: "charge_ev",
              targetDeviceIds: ["ev-1"],
              targetDevices: [{ deviceId: "ev-1", kind: "ev_charger" }],
              reason: "EV charging window",
              confidence: 0.9,
            },
          ],
          recommendedCommands: [
            {
              commandId: "cmd-battery-1",
              deviceId: "battery-1",
              issuedAt: NOW,
              type: "set_mode",
              mode: "charge",
              effectiveWindow: {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
              },
            },
            {
              commandId: "cmd-ev-1",
              deviceId: "ev-1",
              issuedAt: NOW,
              type: "schedule_window",
              window: {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
              },
              targetMode: "charge",
              effectiveWindow: {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
              },
            },
          ],
        },
      },
      executor,
      undefined,
      undefined,
      journal,
      buildCycleFinancialCtx({ mode: "balanced", savingsPence: 17 }),
      guardrail,
      "continuous_live_strict",
      { cycleId: "cycle-multi-action-1" },
    );

    const hb = journal.getCycleHeartbeats()[0];
    expect(hb.executionPosture).toBe("normal");
    expect(hb.commandsIssued).toBe(2);
    expect(hb.commandsSkipped).toBe(0);
    expect(hb.commandsFailed).toBe(0);
    expect(hb.commandsSuppressed).toBe(0);
    expect(hb.economicSnapshot?.hasValueSeekingDecisions).toBe(true);
    expect(journal.getAll()).toHaveLength(2);
  });
});

describe("cycle economic snapshot", () => {
  it("normal fresh cycle with financial context records a complete economic snapshot", async () => {
    const journal = new InMemoryExecutionJournalStore();
    const executor = buildExecutor("issued");

    const guardrail: RuntimeExecutionGuardrailContext = {
      safeHoldMode: false,
      planFreshnessStatus: "fresh",
      stalePlanReuseCount: 0,
    };

    await runControlLoopExecutionService(
      { now: NOW, systemState: buildSystemState(), optimizerOutput: buildOptimizerOutput(true) },
      executor,
      undefined, undefined,
      journal,
      buildCycleFinancialCtx({ mode: "cost", savingsPence: 28 }),
      guardrail,
      "continuous_live_strict",
      { cycleId: "cycle-econ-normal-1" },
    );

    const hb = journal.getCycleHeartbeats()[0];
    expect(hb.economicSnapshot).toBeDefined();
    expect(hb.economicSnapshot?.optimizationMode).toBe("cost");
    expect(hb.economicSnapshot?.hasValueSeekingDecisions).toBe(true);
    expect(hb.economicSnapshot?.valueSeekingExecutionDeferred).toBe(false);
    expect(hb.economicSnapshot?.estimatedSavingsVsBaselinePence).toBe(28);
    expect(hb.economicSnapshot?.conservativeAdjustmentApplied).toBeUndefined();
  });

  it("hold_only cycle with value-seeking decisions marks valueSeekingExecutionDeferred", async () => {
    const journal = new InMemoryExecutionJournalStore();
    const executor = buildExecutor();

    const guardrail: RuntimeExecutionGuardrailContext = {
      safeHoldMode: true,
      planFreshnessStatus: "expired",
      stalePlanReuseCount: 3,
      stalePlanWarning: "Safe hold active",
    };

    await runControlLoopExecutionService(
      { now: NOW, systemState: buildSystemState(), optimizerOutput: buildOptimizerOutput(true) },
      executor,
      undefined, undefined,
      journal,
      buildCycleFinancialCtx({ conservativeAdjustmentApplied: true, savingsPence: 15 }),
      guardrail,
      "standard",
      { cycleId: "cycle-econ-hold-1" },
    );

    const hb = journal.getCycleHeartbeats()[0];
    expect(hb.executionPosture).toBe("hold_only");
    expect(hb.economicSnapshot).toBeDefined();
    expect(hb.economicSnapshot?.hasValueSeekingDecisions).toBe(true);
    expect(hb.economicSnapshot?.valueSeekingExecutionDeferred).toBe(true);
    expect(hb.economicSnapshot?.conservativeAdjustmentApplied).toBe(true);
    expect(hb.economicSnapshot?.estimatedSavingsVsBaselinePence).toBe(15);
  });

  it("quiet no-command cycle still records an economic snapshot cleanly", async () => {
    const journal = new InMemoryExecutionJournalStore();
    const executor = buildExecutor();

    await runControlLoopExecutionService(
      { now: NOW, systemState: buildSystemState(), optimizerOutput: buildOptimizerOutput(false) },
      executor,
      undefined, undefined,
      journal,
      buildCycleFinancialCtx({ mode: "balanced", savingsPence: 0 }),
      undefined,
      "standard",
      { cycleId: "cycle-econ-quiet-1" },
    );

    const heartbeats = journal.getCycleHeartbeats();
    expect(heartbeats).toHaveLength(1);
    const hb = heartbeats[0];
    expect(hb.executionPosture).toBe("normal");
    expect(hb.commandsIssued).toBe(0);
    expect(hb.economicSnapshot).toBeDefined();
    expect(hb.economicSnapshot?.optimizationMode).toBe("balanced");
    expect(hb.economicSnapshot?.hasValueSeekingDecisions).toBe(false);
    expect(hb.economicSnapshot?.valueSeekingExecutionDeferred).toBe(false);
    expect(hb.economicSnapshot?.estimatedSavingsVsBaselinePence).toBe(0);

    // No command-level entries for a no-command cycle
    expect(journal.getAll()).toHaveLength(0);
  });
});
