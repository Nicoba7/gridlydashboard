import { describe, expect, it } from "vitest";
import {
  evaluateEconomicActionPreference,
  type EconomicActionCandidate,
  type EconomicPreferenceContext,
  type EconomicActionPreferenceResult,
} from "../application/controlLoopExecution/evaluateEconomicActionPreference";
import {
  evaluateHouseholdEconomicOpportunity,
  type HouseholdEconomicOpportunityResult,
} from "../application/controlLoopExecution/evaluateHouseholdEconomicOpportunity";

const highConfidenceContext: EconomicPreferenceContext = {
  optimizationMode: "balanced",
  planningConfidenceLevel: "high",
};

function makeDeviceCandidate(
  opportunityId: string,
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
    opportunityId,
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

function normalizeDeviceResult(
  candidates: EconomicActionCandidate[],
  result: EconomicActionPreferenceResult | null,
) {
  if (!result) {
    return null;
  }

  const opportunityByRequestId = new Map(
    candidates.map((candidate) => [candidate.executionRequestId, candidate.opportunityId]),
  );

  return {
    preferredOpportunityId: result.preferredOpportunityId,
    selectionScore: result.selectionScore,
    selectionReason: result.selectionReason,
    isFallback: result.isFallback,
    alternativesConsidered: result.alternativesConsidered,
    rejections: result.rejections.map((rejection) => ({
      opportunityId: rejection.opportunityId ?? opportunityByRequestId.get(rejection.executionRequestId),
      reasonCode: rejection.reasonCode,
      inferiorByPencePerKwh: rejection.inferiorByPencePerKwh,
      selectionReason: rejection.selectionReason,
    })),
  };
}

function normalizeHouseholdResult(
  candidates: EconomicActionCandidate[],
  result: HouseholdEconomicOpportunityResult | null,
) {
  if (!result) {
    return null;
  }

  const opportunityByRequestId = new Map(
    candidates.map((candidate) => [candidate.executionRequestId, candidate.opportunityId]),
  );

  return {
    preferredOpportunityId: result.preferredOpportunityId,
    selectionScore: result.selectionScore,
    selectionReason: result.selectionReason,
    alternativesConsidered: result.alternativesConsidered,
    rejections: result.rejections.map((rejection) => ({
      opportunityId: rejection.opportunityId ?? opportunityByRequestId.get(rejection.executionRequestId),
      candidateScore: rejection.candidateScore,
      inferiorByPencePerKwh: rejection.inferiorByPencePerKwh,
      selectionReason: rejection.selectionReason,
    })),
  };
}

describe("economic arbitration identity stability", () => {
  it("device arbitration produces the same winner when only executionRequestId values change", () => {
    const baselineCandidates = [
      makeDeviceCandidate("opp-export", "req-export-a", {
        targetDeviceId: "battery",
        action: "export_to_grid",
        effectiveStoredEnergyValue: 18.2,
      }),
      makeDeviceCandidate("opp-charge", "req-charge-a", {
        targetDeviceId: "battery",
        action: "charge_battery",
        effectiveStoredEnergyValue: 7.4,
      }),
    ];

    const rewrittenRequestCandidates = [
      makeDeviceCandidate("opp-export", "req-export-b", {
        targetDeviceId: "battery",
        action: "export_to_grid",
        effectiveStoredEnergyValue: 18.2,
      }),
      makeDeviceCandidate("opp-charge", "req-charge-b", {
        targetDeviceId: "battery",
        action: "charge_battery",
        effectiveStoredEnergyValue: 7.4,
      }),
    ];

    const baseline = normalizeDeviceResult(
      baselineCandidates,
      evaluateEconomicActionPreference(baselineCandidates, highConfidenceContext),
    );
    const rewritten = normalizeDeviceResult(
      rewrittenRequestCandidates,
      evaluateEconomicActionPreference(rewrittenRequestCandidates, highConfidenceContext),
    );

    expect(baseline).toEqual(rewritten);
    expect(baseline?.preferredOpportunityId).toBe("opp-export");
    expect(baseline?.rejections).toEqual([
      expect.objectContaining({
        opportunityId: "opp-charge",
        reasonCode: "INFERIOR_ECONOMIC_VALUE",
      }),
    ]);
  });

  it("device arbitration tie-break reasoning remains stable when only request identifiers change", () => {
    const baselineCandidates = [
      makeDeviceCandidate("opp-first", "req-first-a", {
        targetDeviceId: "battery",
        action: "charge_battery",
        effectiveStoredEnergyValue: 10,
      }),
      makeDeviceCandidate("opp-second", "req-second-a", {
        targetDeviceId: "battery",
        action: "discharge_battery",
        effectiveStoredEnergyValue: 10,
      }),
    ];

    const rewrittenRequestCandidates = [
      makeDeviceCandidate("opp-first", "req-first-b", {
        targetDeviceId: "battery",
        action: "charge_battery",
        effectiveStoredEnergyValue: 10,
      }),
      makeDeviceCandidate("opp-second", "req-second-b", {
        targetDeviceId: "battery",
        action: "discharge_battery",
        effectiveStoredEnergyValue: 10,
      }),
    ];

    const baseline = normalizeDeviceResult(
      baselineCandidates,
      evaluateEconomicActionPreference(baselineCandidates, highConfidenceContext),
    );
    const rewritten = normalizeDeviceResult(
      rewrittenRequestCandidates,
      evaluateEconomicActionPreference(rewrittenRequestCandidates, highConfidenceContext),
    );

    expect(baseline).toEqual(rewritten);
    expect(baseline?.preferredOpportunityId).toBe("opp-first");
    expect(baseline?.rejections[0]).toEqual(
      expect.objectContaining({
        opportunityId: "opp-second",
        reasonCode: "ECONOMIC_PREFERENCE_TIE_BROKEN",
      }),
    );
  });

  it("household arbitration remains stable when only request identifiers change", () => {
    const baselineCandidates = [
      makeDeviceCandidate("opp-export", "req-export-a", {
        targetDeviceId: "grid_export_control",
        action: "export_to_grid",
        effectiveStoredEnergyValue: 16.5,
      }),
      makeDeviceCandidate("opp-ev", "req-ev-a", {
        targetDeviceId: "ev_charger",
        action: "charge_ev",
        effectiveStoredEnergyValue: 8.1,
      }),
    ];

    const rewrittenRequestCandidates = [
      makeDeviceCandidate("opp-export", "req-export-b", {
        targetDeviceId: "grid_export_control",
        action: "export_to_grid",
        effectiveStoredEnergyValue: 16.5,
      }),
      makeDeviceCandidate("opp-ev", "req-ev-b", {
        targetDeviceId: "ev_charger",
        action: "charge_ev",
        effectiveStoredEnergyValue: 8.1,
      }),
    ];

    const baseline = normalizeHouseholdResult(
      baselineCandidates,
      evaluateHouseholdEconomicOpportunity(baselineCandidates, highConfidenceContext),
    );
    const rewritten = normalizeHouseholdResult(
      rewrittenRequestCandidates,
      evaluateHouseholdEconomicOpportunity(rewrittenRequestCandidates, highConfidenceContext),
    );

    expect(baseline).toEqual(rewritten);
    expect(baseline?.preferredOpportunityId).toBe("opp-export");
    expect(baseline?.rejections).toEqual([
      expect.objectContaining({
        opportunityId: "opp-ev",
      }),
    ]);
  });
});