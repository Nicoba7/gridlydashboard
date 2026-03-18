import { describe, expect, it } from "vitest";
import type { ControlLoopInput, ControlLoopResult } from "../controlLoop/controlLoop";
import { buildExecutionPlan } from "../application/controlLoopExecution/stages/buildExecutionPlan";
import type { EligibleOpportunity } from "../application/controlLoopExecution/pipelineTypes";

const input: ControlLoopInput = {
  now: "2026-03-16T10:05:00.000Z",
  systemState: {
    siteId: "site-1",
    capturedAt: "2026-03-16T10:05:00.000Z",
    timezone: "Europe/London",
    devices: [],
    homeLoadW: 1000,
    solarGenerationW: 0,
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 1000,
  },
  optimizerOutput: {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    status: "ok",
    headline: "Test",
    decisions: [
      {
        decisionId: "decision-req-1",
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
        executionWindow: {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
        },
        action: "charge_battery",
        targetDeviceIds: ["battery"],
        targetDevices: [{ deviceId: "battery" }],
        reason: "test",
        confidence: 0.8,
      },
      {
        decisionId: "decision-req-2",
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
        executionWindow: {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
        },
        action: "charge_ev",
        targetDeviceIds: ["ev"],
        targetDevices: [{ deviceId: "ev" }],
        reason: "test",
        confidence: 0.8,
      },
    ],
    recommendedCommands: [],
    summary: {
      expectedImportCostPence: 0,
      expectedExportRevenuePence: 0,
      planningNetRevenueSurplusPence: 0,
    },
    diagnostics: [],
    feasibility: {
      executable: true,
      reasonCodes: ["PLAN_COMPUTED"],
    },
    assumptions: [],
    warnings: [],
    confidence: 1,
  },
};

const controlLoopResult: ControlLoopResult = {
  activeDecisions: [...input.optimizerOutput.decisions],
  skippedDecisions: [],
  commandsToIssue: [],
  activeOpportunities: [],
  replanRequired: false,
  reasons: [],
};

function buildEligibleOpportunity(deviceId: string, executionRequestId: string): EligibleOpportunity {
  return {
    opportunityId: `opp-${executionRequestId}`,
    decisionId: `decision-${executionRequestId}`,
    targetDeviceId: deviceId,
    canonicalCommand: {
      kind: "set_mode",
      targetDeviceId: deviceId,
      mode: "charge",
    },
    commandId: `cmd-${executionRequestId}`,
    planId: "plan-1",
    requestedAt: input.now,
    executionAuthorityMode: "full_canonical",
    eligibilityBasis: {
      runtimeGuardrailPassed: true,
      capabilityValidationPassed: true,
      reconciliationPassed: true,
      executionPolicyPassed: true,
      observedStateStatus: "fresh",
    },
  };
}

describe("buildExecutionPlan stage", () => {
  it("returns dispatchable opportunities outside canonical plan and preserves selected opportunity", () => {
    const opportunities = [
      buildEligibleOpportunity("battery", "req-1"),
      buildEligibleOpportunity("ev", "req-2"),
    ];

    const result = buildExecutionPlan({
      opportunities,
      input,
      controlLoopResult,
    });

    expect(result.plan.kind).toBe("executable");
    expect(result.plan.selectedOpportunityId).toBe("opp-req-1");
    expect(result.dispatchableOpportunities).toHaveLength(2);
    expect(result.compatibilityOutcomes).toEqual([]);
  });

  it("returns non-executable plan when no opportunities are dispatchable", () => {
    const result = buildExecutionPlan({
      opportunities: [],
      input,
      controlLoopResult,
    });

    expect(result.plan.kind).toBe("non_executable");
    expect(result.dispatchableOpportunities).toEqual([]);
    expect(result.compatibilityOutcomes).toEqual([]);
  });
});
