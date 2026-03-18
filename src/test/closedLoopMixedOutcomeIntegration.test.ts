import { describe, expect, it } from "vitest";
import type { SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOutput } from "../domain/optimizer";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
} from "../application/controlLoopExecution/types";
import type {
  CycleContext,
  CycleExecutor,
  CycleSummary,
  ContinuousLoopState,
} from "../application/continuousLoop/controlLoopRunnerTypes";
import { runContinuousLoopTick } from "../application/continuousLoop/controlLoopRunner";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import { InMemoryExecutionJournalStore } from "../journal/executionJournalStore";
import { InMemoryDeviceCapabilitiesProvider } from "../capabilities/deviceCapabilitiesProvider";

function buildSystemState(): SystemState {
  return {
    siteId: "site-1",
    capturedAt: "2026-03-16T10:00:00.000Z",
    timezone: "Europe/London",
    devices: [],
    homeLoadW: 1400,
    solarGenerationW: 300,
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 1100,
  };
}

function buildDecision(input: {
  decisionId: string;
  action: OptimizerDecision["action"];
  targetDeviceId: string;
  reason: string;
}): OptimizerDecision {
  return {
    decisionId: input.decisionId,
    startAt: "2026-03-16T10:00:00.000Z",
    endAt: "2026-03-16T10:30:00.000Z",
    executionWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    action: input.action,
    targetDeviceIds: [input.targetDeviceId],
    targetDevices: [{ deviceId: input.targetDeviceId }],
    reason: input.reason,
    expectedBatterySocPercent: input.action === "charge_battery" ? 70 : undefined,
    confidence: 0.85,
  };
}

function buildPlan(input: {
  planId: string;
  generatedAt: string;
  decisions: OptimizerDecision[];
  recommendedCommands: OptimizerOutput["recommendedCommands"];
}): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: input.planId,
    generatedAt: input.generatedAt,
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    status: "ok",
    headline: "Closed-loop mixed-outcome simulation",
    decisions: input.decisions,
    recommendedCommands: input.recommendedCommands,
    summary: {
      expectedImportCostPence: 120,
      expectedExportRevenuePence: 10,
      planningNetRevenueSurplusPence: -110,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.84,
  };
}

class ClosedLoopSimulationExecutor implements CycleExecutor {
  public readonly capturedContexts: CycleContext[] = [];
  public buildPlanAttempts = 0;

  constructor(
    private readonly journal: InMemoryExecutionJournalStore,
    private readonly replannedPlan: OptimizerOutput,
  ) {}

  async buildPlan(): Promise<OptimizerOutput> {
    this.buildPlanAttempts += 1;

    if (this.buildPlanAttempts === 1) {
      throw new Error("initial replan unavailable");
    }

    return this.replannedPlan;
  }

  async execute(ctx: CycleContext): Promise<CycleSummary> {
    this.capturedContexts.push(ctx);

    const cycleNumber = this.capturedContexts.length;
    const capabilities = new InMemoryDeviceCapabilitiesProvider([
      {
        deviceId: "battery-1",
        supportedCommandKinds: ["set_mode"],
        supportedModes: ["charge", "hold"],
        minimumCommandWindowMinutes: 15,
        supportsOverlappingWindows: true,
        supportsImmediateExecution: true,
        schemaVersion: "capabilities.v1",
      },
      {
        deviceId: "ev-1",
        supportedCommandKinds: ["refresh_state"],
        supportsImmediateExecution: true,
        schemaVersion: "capabilities.v1",
      },
      {
        deviceId: "solar-1",
        supportedCommandKinds: ["refresh_state"],
        supportsImmediateExecution: true,
        schemaVersion: "capabilities.v1",
      },
    ]);

    const executor = {
      execute: async (requests: CommandExecutionRequest[]): Promise<CommandExecutionResult[]> =>
        requests.map((request): CommandExecutionResult => {
          if (cycleNumber === 1 && request.targetDeviceId === "ev-1") {
            return {
              executionRequestId: request.executionRequestId,
              requestId: request.requestId,
              idempotencyKey: request.idempotencyKey,
              decisionId: request.decisionId,
              targetDeviceId: request.targetDeviceId,
              commandId: request.commandId,
              deviceId: request.targetDeviceId,
              status: "failed",
              errorCode: "EXECUTOR_ERROR",
              reasonCodes: ["EXECUTOR_ERROR"],
            };
          }

          return {
            executionRequestId: request.executionRequestId,
            requestId: request.requestId,
            idempotencyKey: request.idempotencyKey,
            decisionId: request.decisionId,
            targetDeviceId: request.targetDeviceId,
            commandId: request.commandId,
            deviceId: request.targetDeviceId,
            status: "issued",
          };
        }),
    };

    const execution = await runControlLoopExecutionService(
      {
        now: ctx.nowIso,
        systemState: buildSystemState(),
        optimizerOutput: ctx.currentPlan,
      },
      executor,
      capabilities,
      undefined,
      this.journal,
      {
        optimizationMode: "balanced",
        valueLedger: {
          optimizationMode: "balanced",
          estimatedImportCostPence: 120,
          estimatedExportRevenuePence: 10,
          estimatedBatteryDegradationCostPence: 2,
          estimatedNetCostPence: 112,
          baselineType: "hold_current_state",
          baselineNetCostPence: 118,
          baselineImportCostPence: 128,
          baselineExportRevenuePence: 10,
          baselineBatteryDegradationCostPence: 0,
          estimatedSavingsVsBaselinePence: 6,
          assumptions: [],
          caveats: [],
          confidence: 0.8,
        },
      },
      {
        safeHoldMode: ctx.safeHoldMode,
        planFreshnessStatus: ctx.planFreshnessStatus,
        replanTrigger: ctx.replanTrigger,
        stalePlanReuseCount: ctx.stalePlanReuseCount,
        stalePlanWarning: ctx.stalePlanWarning,
      },
      "continuous_live_strict",
      { cycleId: ctx.cycleId, replanReason: ctx.replanReason },
    );

    return {
      cycleId: ctx.cycleId,
      nowIso: ctx.nowIso,
      status: "ok",
      replanRequired: false,
      issuedCommandCount: execution.executionResults.filter((x) => x.status === "issued").length,
      skippedCommandCount: execution.executionResults.filter((x) => x.status === "skipped").length,
      failedCommandCount: execution.executionResults.filter((x) => x.status === "failed").length,
      journalEntriesWritten: execution.executionResults.length,
      planAgeSeconds: ctx.planAgeSeconds,
      planFreshnessStatus: ctx.planFreshnessStatus,
      replanTriggered: ctx.replanTriggered,
      replanTrigger: ctx.replanTrigger,
      replanReason: ctx.replanReason,
      stalePlanReuseCount: ctx.stalePlanReuseCount,
      observedBatterySocPercent: cycleNumber === 1 ? 55 : 62,
      observedChargingState: cycleNumber === 1 ? "idle" : "charging",
    };
  }
}

describe("closed-loop mixed-outcome integration", () => {
  it("remains operationally and economically coherent across consecutive cycles after mixed outcomes", async () => {
    const mixedPlan = buildPlan({
      planId: "plan-mixed-cycle-1",
      generatedAt: "2026-03-16T10:00:00.000Z",
      decisions: [
        buildDecision({
          decisionId: "decision-battery",
          action: "charge_battery",
          targetDeviceId: "battery-1",
          reason: "Battery charge opportunity",
        }),
        buildDecision({
          decisionId: "decision-ev-refresh",
          action: "hold",
          targetDeviceId: "ev-1",
          reason: "Refresh EV state",
        }),
        buildDecision({
          decisionId: "decision-solar-refresh",
          action: "hold",
          targetDeviceId: "solar-1",
          reason: "Refresh solar state",
        }),
      ],
      recommendedCommands: [
        {
          commandId: "cmd-battery-1",
          deviceId: "battery-1",
          issuedAt: "2026-03-16T10:05:00.000Z",
          type: "set_mode",
          mode: "charge",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
        },
        {
          commandId: "cmd-ev-refresh",
          deviceId: "ev-1",
          issuedAt: "2026-03-16T10:05:00.000Z",
          type: "refresh_state",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
        },
        {
          commandId: "cmd-solar-refresh",
          deviceId: "solar-1",
          issuedAt: "2026-03-16T10:05:00.000Z",
          type: "refresh_state",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
        },
      ],
    });

    const replannedCyclePlan = buildPlan({
      planId: "plan-cycle-2-replanned",
      generatedAt: "2026-03-16T10:10:00.000Z",
      decisions: [
        buildDecision({
          decisionId: "decision-battery-2",
          action: "charge_battery",
          targetDeviceId: "battery-1",
          reason: "Replanned battery action after partial execution",
        }),
        buildDecision({
          decisionId: "decision-solar-refresh-2",
          action: "hold",
          targetDeviceId: "solar-1",
          reason: "Refresh solar state",
        }),
      ],
      recommendedCommands: [
        {
          commandId: "cmd-battery-2",
          deviceId: "battery-1",
          issuedAt: "2026-03-16T10:10:00.000Z",
          type: "set_mode",
          mode: "charge",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
        },
        {
          commandId: "cmd-solar-refresh-2",
          deviceId: "solar-1",
          issuedAt: "2026-03-16T10:10:00.000Z",
          type: "refresh_state",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
        },
      ],
    });

    const journal = new InMemoryExecutionJournalStore();
    const cycleExecutor = new ClosedLoopSimulationExecutor(journal, replannedCyclePlan);

    const initialState: ContinuousLoopState = {
      status: "running",
      cycleCount: 0,
      consecutiveFailures: 0,
      stalePlanCycleCount: 0,
      planGeneratedAt: undefined,
    };

    const cycle1 = await runContinuousLoopTick(
      {
        currentState: initialState,
        currentPlan: mixedPlan,
        siteId: "site-1",
        nowIso: "2026-03-16T10:05:00.000Z",
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
        stalePlanMaxCycles: 3,
        socDriftThresholdPercent: 15,
      },
      cycleExecutor,
    );

    expect(cycle1.summary.status).toBe("ok");
    expect(cycle1.summary.issuedCommandCount).toBe(1);
    expect(cycle1.summary.skippedCommandCount).toBe(1);
    expect(cycle1.summary.failedCommandCount).toBe(1);
    expect(cycle1.nextState.status).toBe("running");

    const cycle2 = await runContinuousLoopTick(
      {
        currentState: cycle1.nextState,
        currentPlan: cycle1.nextPlan,
        siteId: "site-1",
        nowIso: "2026-03-16T10:10:00.000Z",
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
        stalePlanMaxCycles: 3,
        socDriftThresholdPercent: 15,
      },
      cycleExecutor,
    );

    expect(cycle2.summary.status).toBe("ok");
    expect(cycle2.summary.issuedCommandCount).toBe(2);
    expect(cycle2.summary.skippedCommandCount).toBe(0);
    expect(cycle2.summary.failedCommandCount).toBe(0);
    expect(cycle2.nextPlan.planId).toBe("plan-cycle-2-replanned");
    expect(cycle2.nextState.status).toBe("running");

    const cycle2Context = cycleExecutor.capturedContexts[1];
    expect(cycle2Context.replanTriggered).toBe(true);
    expect(cycle2Context.replanReason).toContain("Prior command execution failed");
    expect(cycle2Context.planFreshnessStatus).toBe("fresh");

    const heartbeats = journal.getCycleHeartbeats();
    expect(heartbeats).toHaveLength(2);
    expect(heartbeats[0].executionPosture).toBe("conservative");
    expect(heartbeats[0].commandsIssued).toBe(1);
    expect(heartbeats[0].commandsSkipped).toBe(1);
    expect(heartbeats[0].commandsFailed).toBe(1);
    expect(heartbeats[0].commandsSuppressed).toBe(1);
    expect(heartbeats[0].economicSnapshot?.valueSeekingExecutionDeferred).toBe(true);

    expect(heartbeats[1].executionPosture).toBe("normal");
    expect(heartbeats[1].planFreshnessStatus).toBe("fresh");
    expect(heartbeats[1].commandsIssued).toBe(2);
    expect(heartbeats[1].commandsSkipped).toBe(0);
    expect(heartbeats[1].commandsFailed).toBe(0);
    expect(heartbeats[1].commandsSuppressed).toBe(0);
    expect(heartbeats[1].economicSnapshot?.valueSeekingExecutionDeferred).toBe(false);

    const entries = journal.getAll();
    expect(entries).toHaveLength(5);
    expect(entries.filter((entry) => entry.status === "issued")).toHaveLength(3);
    expect(entries.filter((entry) => entry.status === "skipped")).toHaveLength(1);
    expect(entries.filter((entry) => entry.status === "failed")).toHaveLength(1);
  });
});