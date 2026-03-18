import { describe, expect, it } from "vitest";
import { evaluateExecutionPolicy } from "../application/controlLoopExecution/evaluateExecutionPolicy";
import type { CommandExecutionRequest } from "../application/controlLoopExecution/types";
import type { ControlLoopResult } from "../controlLoop/controlLoop";
import type { OptimizerOutput } from "../domain/optimizer";

function buildRequest(overrides?: Partial<CommandExecutionRequest>): CommandExecutionRequest {
  return {
    executionRequestId: "exec-1",
    requestId: "exec-1",
    idempotencyKey: "idem-1",
    decisionId: "decision-1",
    targetDeviceId: "battery",
    planId: "plan-1",
    requestedAt: "2026-03-16T10:00:00.000Z",
    commandId: "cmd-1",
    canonicalCommand: {
      kind: "set_mode",
      targetDeviceId: "battery",
      effectiveWindow: {
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
      },
      mode: "charge",
    },
    ...overrides,
  } as CommandExecutionRequest;
}

function buildControlLoopResult(overrides?: Partial<ControlLoopResult>): ControlLoopResult {
  return {
    activeDecisions: [
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
        reason: "Test",
        confidence: 0.8,
      },
    ],
    commandsToIssue: [],
    skippedDecisions: [],
    replanRequired: false,
    reasons: [],
    ...overrides,
  };
}

function buildOptimizerOutput(overrides?: Partial<OptimizerOutput>): OptimizerOutput {
  return {
    planId: "plan-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    status: "ok",
    headline: "Test",
    decisions: [],
    recommendedCommands: [],
    summary: {
      expectedImportCostPence: 1,
      expectedExportRevenuePence: 0,
      planningNetRevenueSurplusPence: -1,
    },
    diagnostics: [],
    confidence: 0.8,
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    feasibility: {
      executable: true,
      reasonCodes: ["PLAN_COMPUTED"],
    },
    ...overrides,
  };
}

describe("evaluateExecutionPolicy", () => {
  it("denies when execution window is not active", () => {
    const decision = evaluateExecutionPolicy({
      now: "2026-03-16T10:45:00.000Z",
      request: buildRequest(),
      controlLoopResult: buildControlLoopResult(),
      optimizerOutput: buildOptimizerOutput(),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain("EXECUTION_WINDOW_NOT_ACTIVE");
  });

  it("denies when planning window is expired", () => {
    const decision = evaluateExecutionPolicy({
      now: "2026-03-16T11:00:00.000Z",
      request: buildRequest(),
      controlLoopResult: buildControlLoopResult(),
      optimizerOutput: buildOptimizerOutput(),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain("PLANNING_WINDOW_EXPIRED");
  });

  it("denies when plan is infeasible", () => {
    const decision = evaluateExecutionPolicy({
      now: "2026-03-16T10:05:00.000Z",
      request: buildRequest(),
      controlLoopResult: buildControlLoopResult(),
      optimizerOutput: buildOptimizerOutput({ feasibility: { executable: false, reasonCodes: ["PLAN_INFEASIBLE"] } }),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain("PLAN_INFEASIBLE");
  });

  it("denies conflicting same-device request in batch", () => {
    const decision = evaluateExecutionPolicy({
      now: "2026-03-16T10:05:00.000Z",
      request: buildRequest(),
      controlLoopResult: buildControlLoopResult(),
      optimizerOutput: buildOptimizerOutput(),
      reservedDeviceIds: new Set(["battery"]),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain("CONFLICTING_COMMAND_FOR_DEVICE");
  });

  it("allows when policy checks pass", () => {
    const decision = evaluateExecutionPolicy({
      now: "2026-03-16T10:05:00.000Z",
      request: buildRequest(),
      controlLoopResult: buildControlLoopResult(),
      optimizerOutput: buildOptimizerOutput(),
      reservedDeviceIds: new Set(),
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCodes).toHaveLength(0);
  });

  it("denies high-risk command when observed state is missing", () => {
    const decision = evaluateExecutionPolicy({
      now: "2026-03-16T10:05:00.000Z",
      request: buildRequest({
        canonicalCommand: {
          kind: "set_mode",
          targetDeviceId: "battery",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
          mode: "charge",
        },
      }),
      controlLoopResult: buildControlLoopResult(),
      optimizerOutput: buildOptimizerOutput(),
      observedStateFreshness: {
        capturedAt: "2026-03-16T10:05:00.000Z",
        maxAgeSeconds: 300,
        overallStatus: "missing",
        counts: { fresh: 0, stale: 0, missing: 1, unknown: 0 },
        devices: [{ deviceId: "battery", status: "missing" }],
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain("OBSERVED_STATE_MISSING");
  });

  it("denies high-risk command when observed state is stale", () => {
    const decision = evaluateExecutionPolicy({
      now: "2026-03-16T10:05:00.000Z",
      request: buildRequest(),
      controlLoopResult: buildControlLoopResult(),
      optimizerOutput: buildOptimizerOutput(),
      observedStateFreshness: {
        capturedAt: "2026-03-16T10:05:00.000Z",
        maxAgeSeconds: 60,
        overallStatus: "stale",
        counts: { fresh: 0, stale: 1, missing: 0, unknown: 0 },
        devices: [
          {
            deviceId: "battery",
            status: "stale",
            lastTelemetryAt: "2026-03-16T10:00:00.000Z",
            ageSeconds: 300,
          },
        ],
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain("OBSERVED_STATE_STALE");
  });

  it("denies high-risk command when observed state is unknown", () => {
    const decision = evaluateExecutionPolicy({
      now: "2026-03-16T10:05:00.000Z",
      request: buildRequest(),
      controlLoopResult: buildControlLoopResult(),
      optimizerOutput: buildOptimizerOutput(),
      observedStateFreshness: {
        capturedAt: "2026-03-16T10:05:00.000Z",
        maxAgeSeconds: 60,
        overallStatus: "unknown",
        counts: { fresh: 0, stale: 0, missing: 0, unknown: 1 },
        devices: [{ deviceId: "battery", status: "unknown" }],
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain("OBSERVED_STATE_UNKNOWN");
  });

  it("allows low-risk refresh_state even when observed state is stale", () => {
    const decision = evaluateExecutionPolicy({
      now: "2026-03-16T10:05:00.000Z",
      request: buildRequest({
        canonicalCommand: {
          kind: "refresh_state",
          targetDeviceId: "battery",
        },
      }),
      controlLoopResult: buildControlLoopResult(),
      optimizerOutput: buildOptimizerOutput(),
      observedStateFreshness: {
        capturedAt: "2026-03-16T10:05:00.000Z",
        maxAgeSeconds: 60,
        overallStatus: "stale",
        counts: { fresh: 0, stale: 1, missing: 0, unknown: 0 },
        devices: [{ deviceId: "battery", status: "stale" }],
      },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCodes).toHaveLength(0);
  });
});
