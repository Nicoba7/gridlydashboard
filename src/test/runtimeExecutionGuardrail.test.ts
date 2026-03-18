import { describe, expect, it, vi } from "vitest";
import type { SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOutput } from "../domain/optimizer";
import { evaluateRuntimeExecutionGuardrail } from "../application/controlLoopExecution/evaluateRuntimeExecutionGuardrail";
import { classifyRuntimeExecutionPosture } from "../application/controlLoopExecution/classifyRuntimeExecutionPosture";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
} from "../application/controlLoopExecution/types";
import { InMemoryExecutionJournalStore } from "../journal/executionJournalStore";

function buildSystemState(): SystemState {
  return {
    siteId: "site-1",
    capturedAt: "2026-03-16T10:00:00.000Z",
    timezone: "Europe/London",
    devices: [],
    homeLoadW: 1200,
    solarGenerationW: 800,
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 400,
  };
}

function buildDecision(action: OptimizerDecision["action"] = "charge_battery"): OptimizerDecision {
  return {
    decisionId: "decision-1",
    startAt: "2026-03-16T10:00:00.000Z",
    endAt: "2026-03-16T10:30:00.000Z",
    executionWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    action,
    targetDeviceIds: ["battery"],
    targetDevices: [{ deviceId: "battery", kind: "battery", requiredCapabilities: ["set_mode"] }],
    reason: "Test decision",
    confidence: 0.8,
  };
}

function buildOutput(commandMode: "charge" | "hold" = "charge", action: OptimizerDecision["action"] = "charge_battery"): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    status: "ok",
    headline: "Guardrail test plan",
    decisions: [buildDecision(action)],
    recommendedCommands: [
      {
        commandId: "cmd-1",
        deviceId: "battery",
        issuedAt: "2026-03-16T10:00:00.000Z",
        type: "set_mode",
        mode: commandMode,
        effectiveWindow: {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
        },
      },
    ],
    summary: {
      expectedImportCostPence: 100,
      expectedExportRevenuePence: 0,
      planningNetRevenueSurplusPence: -100,
    },
    diagnostics: [],
    feasibility: {
      executable: true,
      reasonCodes: ["PLAN_COMPUTED"],
    },
    assumptions: [],
    warnings: [],
    confidence: 0.8,
  };
}

describe("evaluateRuntimeExecutionGuardrail", () => {
  it("suppresses aggressive dispatch under safe-hold mode", () => {
    const result = evaluateRuntimeExecutionGuardrail({
      command: {
        kind: "set_mode",
        targetDeviceId: "battery",
        mode: "charge",
      },
      decisionAction: "charge_battery",
      runtimeContext: {
        safeHoldMode: true,
        planFreshnessStatus: "expired",
        replanTrigger: "expired_plan",
        stalePlanReuseCount: 3,
        stalePlanWarning: "Safe-hold mode active",
      },
    });

    expect(result.policy).toBe("suppress");
    expect(result.reasonCodes).toEqual([
      "RUNTIME_CONSERVATIVE_MODE_ACTIVE",
      "RUNTIME_SAFE_HOLD_ACTIVE",
      "RUNTIME_PLAN_EXPIRED",
      "RUNTIME_REPLAN_GUARD_ACTIVE",
    ]);
  });

  it("allows hold/no-op style commands in conservative mode", () => {
    const result = evaluateRuntimeExecutionGuardrail({
      command: {
        kind: "set_mode",
        targetDeviceId: "battery",
        mode: "hold",
      },
      decisionAction: "hold",
      runtimeContext: {
        safeHoldMode: true,
        planFreshnessStatus: "stale",
        replanTrigger: "stale_plan",
        stalePlanReuseCount: 2,
      },
    });

    expect(result.policy).toBe("allow");
    expect(result.reasonCodes).toEqual([]);
  });

  it("allows normal execution on fresh plans", () => {
    const result = evaluateRuntimeExecutionGuardrail({
      command: {
        kind: "set_mode",
        targetDeviceId: "battery",
        mode: "charge",
      },
      decisionAction: "charge_battery",
      runtimeContext: {
        safeHoldMode: false,
        planFreshnessStatus: "fresh",
        stalePlanReuseCount: 0,
      },
    });

    expect(result.policy).toBe("allow");
    expect(result.reasonCodes).toEqual([]);
  });
});

describe("classifyRuntimeExecutionPosture", () => {
  it("returns normal for fresh runtime context", () => {
    const result = classifyRuntimeExecutionPosture({
      safeHoldMode: false,
      planFreshnessStatus: "fresh",
      stalePlanReuseCount: 0,
    });

    expect(result.posture).toBe("normal");
    expect(result.reasonCodes).toEqual([]);
  });

  it("returns conservative for stale/expired or repeated stale reuse", () => {
    const staleResult = classifyRuntimeExecutionPosture({
      safeHoldMode: false,
      planFreshnessStatus: "stale",
      stalePlanReuseCount: 2,
      replanTrigger: "stale_plan",
    });
    const expiredResult = classifyRuntimeExecutionPosture({
      safeHoldMode: false,
      planFreshnessStatus: "expired",
      stalePlanReuseCount: 0,
    });

    expect(staleResult.posture).toBe("conservative");
    expect(staleResult.reasonCodes).toContain("RUNTIME_STALE_PLAN_REUSE");
    expect(expiredResult.posture).toBe("conservative");
    expect(expiredResult.reasonCodes).toContain("RUNTIME_PLAN_EXPIRED");
  });

  it("returns hold_only when safeHoldMode is active", () => {
    const result = classifyRuntimeExecutionPosture({
      safeHoldMode: true,
      planFreshnessStatus: "expired",
      stalePlanReuseCount: 4,
    });

    expect(result.posture).toBe("hold_only");
    expect(result.reasonCodes).toContain("RUNTIME_SAFE_HOLD_ACTIVE");
  });
});

describe("runControlLoopExecutionService runtime guardrails", () => {
  it("fails closed in continuous-live strict mode when runtime context is missing", async () => {
    const execute = vi.fn(async (_requests: CommandExecutionRequest[]) => [] as CommandExecutionResult[]);
    const executor: DeviceCommandExecutor = { execute };

    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput("charge", "charge_battery"),
      },
      executor,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "continuous_live_strict",
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.executionPosture).toBe("hold_only");
    expect(result.executionResults).toHaveLength(1);
    expect(result.executionResults[0].status).toBe("skipped");
    expect(result.executionResults[0].reasonCodes).toEqual([
      "RUNTIME_CONSERVATIVE_MODE_ACTIVE",
      "RUNTIME_CONTEXT_MISSING",
    ]);
  });

  it("surfaces deterministic suppression reason codes in execution results and journal", async () => {
    const execute = vi.fn(async (_requests: CommandExecutionRequest[]) => [] as CommandExecutionResult[]);
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();

    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput("charge", "charge_battery"),
      },
      executor,
      undefined,
      undefined,
      journal,
      undefined,
      {
        safeHoldMode: true,
        planFreshnessStatus: "expired",
        replanTrigger: "command_outcome_failure",
        stalePlanReuseCount: 2,
      },
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.executionPosture).toBe("hold_only");
    expect(result.executionResults).toHaveLength(1);
    expect(result.executionResults[0].status).toBe("skipped");
    expect(result.executionResults[0].executionPosture).toBe("hold_only");
    expect(result.executionResults[0].reasonCodes).toEqual([
      "RUNTIME_CONSERVATIVE_MODE_ACTIVE",
      "RUNTIME_SAFE_HOLD_ACTIVE",
      "RUNTIME_PLAN_EXPIRED",
      "RUNTIME_REPLAN_GUARD_ACTIVE",
    ]);

    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("skipped");
    expect(entries[0].stage).toBe("dispatch");
    expect(entries[0].reasonCodes).toEqual([
      "RUNTIME_CONSERVATIVE_MODE_ACTIVE",
      "RUNTIME_SAFE_HOLD_ACTIVE",
      "RUNTIME_PLAN_EXPIRED",
      "RUNTIME_REPLAN_GUARD_ACTIVE",
    ]);
  });
});
