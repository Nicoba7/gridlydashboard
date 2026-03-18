import { describe, expect, it } from "vitest";
import { buildHomeRuntimeReadModel } from "../features/home/homeRuntimeReadModel";
import type { OptimizerOutput } from "../domain";
import type { CycleHeartbeatEntry } from "../journal/executionJournal";

function buildOptimizerOutput(overrides: Partial<OptimizerOutput> = {}): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    status: "ok",
    headline: "Holding for stronger opportunities",
    decisions: [
      {
        decisionId: "decision-1",
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
        executionWindow: {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
        },
        action: "hold",
        targetDeviceIds: ["battery"],
        reason: "Holding while confidence is mixed due to partial coverage.",
        confidence: 0.74,
      },
    ],
    recommendedCommands: [],
    summary: {
      expectedImportCostPence: 100,
      expectedExportRevenuePence: 20,
      planningNetRevenueSurplusPence: -80,
    },
    diagnostics: [],
    planningConfidenceLevel: "medium",
    conservativeAdjustmentApplied: true,
    conservativeAdjustmentReason: "Conservative thresholds were raised due to partial tariff coverage.",
    confidence: 0.74,
    ...overrides,
  };
}

function buildCycleHeartbeat(overrides: Partial<CycleHeartbeatEntry> = {}): CycleHeartbeatEntry {
  return {
    entryKind: "cycle_heartbeat",
    recordedAt: "2026-03-16T10:15:00.000Z",
    executionPosture: "normal",
    commandsIssued: 0,
    commandsSkipped: 0,
    commandsFailed: 0,
    commandsSuppressed: 0,
    failClosedTriggered: false,
    nextCycleExecutionCaution: "caution",
    householdObjectiveConfidence: "mixed",
    schemaVersion: "cycle-heartbeat.v1",
    ...overrides,
  };
}

describe("buildHomeRuntimeReadModel", () => {
  it("passes through canonical optimizer runtime fields without reinterpretation", () => {
    const optimizerOutput = buildOptimizerOutput();

    const model = buildHomeRuntimeReadModel({ optimizerOutput });

    expect(model.currentDecisionReason).toBe(optimizerOutput.decisions[0].reason);
    expect(model.planningConfidenceLevel).toBe("medium");
    expect(model.planningConfidenceLabel).toBe("Medium");
    expect(model.conservativeAdjustmentApplied).toBe(true);
    expect(model.conservativeAdjustmentReason).toBe(
      "Conservative thresholds were raised due to partial tariff coverage.",
    );
    expect(model.nextCycleExecutionCaution).toBeUndefined();
    expect(model.householdObjectiveConfidence).toBeUndefined();
  });

  it("passes through latest cycle heartbeat caution/objective confidence when present", () => {
    const optimizerOutput = buildOptimizerOutput();
    const latestCycleHeartbeat = buildCycleHeartbeat();

    const model = buildHomeRuntimeReadModel({ optimizerOutput, latestCycleHeartbeat });

    expect(model.nextCycleExecutionCaution).toBe("caution");
    expect(model.householdObjectiveConfidence).toBe("mixed");
  });
});