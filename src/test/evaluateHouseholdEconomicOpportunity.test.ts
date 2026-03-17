import { describe, expect, it } from "vitest";
import { evaluateHouseholdEconomicOpportunity } from "../application/controlLoopExecution/evaluateHouseholdEconomicOpportunity";
import type { EconomicActionCandidate } from "../application/controlLoopExecution/evaluateEconomicActionPreference";

function buildCandidate(
  executionRequestId: string,
  input: {
    targetDeviceId: string;
    action?: EconomicActionCandidate["action"];
    effectiveStoredEnergyValue?: number;
    netStoredEnergyValue?: number;
    marginalImportAvoidance?: number;
    marginalExportValue?: number;
  },
): EconomicActionCandidate {
  return {
    opportunityId: executionRequestId,
    executionRequestId,
    targetDeviceId: input.targetDeviceId,
    action: input.action,
    command: {
      kind: "set_mode",
      targetDeviceId: input.targetDeviceId,
      mode: input.action === "export_to_grid" ? "export" : "charge",
    },
    effectiveStoredEnergyValue: input.effectiveStoredEnergyValue,
    netStoredEnergyValue: input.netStoredEnergyValue,
    marginalImportAvoidance: input.marginalImportAvoidance,
    marginalExportValue: input.marginalExportValue,
  };
}

describe("evaluateHouseholdEconomicOpportunity", () => {
  it("returns null when there are not at least two cross-asset value-seeking opportunities", () => {
    expect(
      evaluateHouseholdEconomicOpportunity(
        [
          buildCandidate("req-1", {
            targetDeviceId: "battery_1",
            action: "export_to_grid",
            effectiveStoredEnergyValue: 12,
          }),
        ],
        { planningConfidenceLevel: "high", optimizationMode: "balanced" },
      ),
    ).toBeNull();
  });

  it("returns null under low planning confidence so conservative guardrails can win", () => {
    expect(
      evaluateHouseholdEconomicOpportunity(
        [
          buildCandidate("req-export", {
            targetDeviceId: "battery_1",
            action: "export_to_grid",
            effectiveStoredEnergyValue: 16,
          }),
          buildCandidate("req-ev", {
            targetDeviceId: "ev_charger",
            action: "charge_ev",
            effectiveStoredEnergyValue: 8,
          }),
        ],
        { planningConfidenceLevel: "low", optimizationMode: "balanced" },
      ),
    ).toBeNull();
  });

  it("selects the highest-value opportunity across devices", () => {
    const result = evaluateHouseholdEconomicOpportunity(
      [
        buildCandidate("req-export", {
          targetDeviceId: "grid_export_control",
          action: "export_to_grid",
          effectiveStoredEnergyValue: 18.4,
        }),
        buildCandidate("req-ev", {
          targetDeviceId: "ev_charger",
          action: "charge_ev",
          effectiveStoredEnergyValue: 9.2,
        }),
      ],
      { planningConfidenceLevel: "high", optimizationMode: "balanced" },
    );

    expect(result).not.toBeNull();
    expect(result!.preferredOpportunityId).toBe("req-export");
    expect(result!.preferredRequestId).toBe("req-export");
    expect(result!.selectionScore).toBeCloseTo(18.4);
    expect(result!.rejections).toHaveLength(1);
    expect(result!.rejections[0].opportunityId).toBe("req-ev");
    expect(result!.rejections[0].executionRequestId).toBe("req-ev");
    expect(result!.rejections[0].inferiorByPencePerKwh).toBeCloseTo(9.2);
  });

  it("uses marginalExportValue when other stronger signals are absent", () => {
    const result = evaluateHouseholdEconomicOpportunity(
      [
        buildCandidate("req-export", {
          targetDeviceId: "grid_export_control",
          action: "export_to_grid",
          marginalExportValue: 14.5,
        }),
        buildCandidate("req-ev", {
          targetDeviceId: "ev_charger",
          action: "charge_ev",
          marginalImportAvoidance: 7.3,
        }),
      ],
      { planningConfidenceLevel: "high", optimizationMode: "cost" },
    );

    expect(result!.preferredOpportunityId).toBe("req-export");
  });

  it("ignores non-value-seeking actions when arbitrating household opportunities", () => {
    const result = evaluateHouseholdEconomicOpportunity(
      [
        buildCandidate("req-hold", {
          targetDeviceId: "battery_1",
          action: "hold",
          effectiveStoredEnergyValue: 0,
        }),
        buildCandidate("req-ev", {
          targetDeviceId: "ev_charger",
          action: "charge_ev",
          effectiveStoredEnergyValue: 10,
        }),
        buildCandidate("req-export", {
          targetDeviceId: "grid_export_control",
          action: "export_to_grid",
          effectiveStoredEnergyValue: 13,
        }),
      ],
      { planningConfidenceLevel: "high", optimizationMode: "balanced" },
    );

    expect(result!.preferredOpportunityId).toBe("req-export");
    expect(result!.alternativesConsidered).toBe(2);
    expect(result!.rejections).toHaveLength(1);
  });
});