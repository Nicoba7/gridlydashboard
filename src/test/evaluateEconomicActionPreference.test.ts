import { describe, expect, it } from "vitest";
import {
  evaluateEconomicActionPreference,
  type EconomicActionCandidate,
  type EconomicPreferenceContext,
} from "../application/controlLoopExecution/evaluateEconomicActionPreference";

function makeCandidate(
  id: string,
  opts: {
    action?: EconomicActionCandidate["action"];
    effectiveStoredEnergyValue?: number;
    netStoredEnergyValue?: number;
    marginalImportAvoidance?: number;
  } = {},
): EconomicActionCandidate {
  return {
    opportunityId: id,
    executionRequestId: id,
    targetDeviceId: "device-1",
    action: opts.action,
    command: { kind: "set_mode", mode: "charge", targetDeviceId: "device-1" },
    effectiveStoredEnergyValue: opts.effectiveStoredEnergyValue,
    netStoredEnergyValue: opts.netStoredEnergyValue,
    marginalImportAvoidance: opts.marginalImportAvoidance,
  };
}

const normalContext: EconomicPreferenceContext = {
  optimizationMode: "cost",
  planningConfidenceLevel: "high",
};

describe("evaluateEconomicActionPreference", () => {
  describe("returns null when no selection is needed", () => {
    it("returns null for empty candidates array", () => {
      expect(evaluateEconomicActionPreference([], normalContext)).toBeNull();
    });

    it("returns null for a single candidate", () => {
      const candidate = makeCandidate("req-1", { effectiveStoredEnergyValue: 10 });
      expect(evaluateEconomicActionPreference([candidate], normalContext)).toBeNull();
    });

    it("returns null when no candidate has economic data", () => {
      const candidates = [
        makeCandidate("req-1"),
        makeCandidate("req-2"),
      ];
      expect(evaluateEconomicActionPreference(candidates, normalContext)).toBeNull();
    });
  });

  describe("economic-value-based selection under normal confidence", () => {
    it("selects the candidate with higher effectiveStoredEnergyValue", () => {
      const candidates = [
        makeCandidate("req-low", { action: "charge_battery", effectiveStoredEnergyValue: 4.8 }),
        makeCandidate("req-high", { action: "discharge_battery", effectiveStoredEnergyValue: 16.5 }),
      ];

      const result = evaluateEconomicActionPreference(candidates, normalContext);

      expect(result).not.toBeNull();
      expect(result!.preferredOpportunityId).toBe("req-high");
      expect(result!.preferredRequestId).toBe("req-high");
      expect(result!.isFallback).toBe(false);
      expect(result!.rejections).toHaveLength(1);
      expect(result!.rejections[0].opportunityId).toBe("req-low");
      expect(result!.rejections[0].executionRequestId).toBe("req-low");
      expect(result!.rejections[0].reasonCode).toBe("INFERIOR_ECONOMIC_VALUE");
      expect(result!.rejections[0].inferiorByPencePerKwh).toBeCloseTo(11.7, 1);
    });

    it("uses netStoredEnergyValue as secondary score when effectiveStoredEnergyValue is absent", () => {
      const candidates = [
        makeCandidate("req-net-low", { netStoredEnergyValue: 5.0 }),
        makeCandidate("req-net-high", { netStoredEnergyValue: 12.0 }),
      ];

      const result = evaluateEconomicActionPreference(candidates, normalContext);

      expect(result!.preferredOpportunityId).toBe("req-net-high");
      expect(result!.selectionScore).toBeCloseTo(12.0);
    });

    it("uses marginalImportAvoidance as tertiary score", () => {
      const candidates = [
        makeCandidate("req-margin-low", { marginalImportAvoidance: 7.0 }),
        makeCandidate("req-margin-high", { marginalImportAvoidance: 22.5 }),
      ];

      const result = evaluateEconomicActionPreference(candidates, normalContext);

      expect(result!.preferredOpportunityId).toBe("req-margin-high");
    });

    it("effectiveStoredEnergyValue takes precedence over netStoredEnergyValue", () => {
      const candidates = [
        // High net but low effective (degradation heavy)
        makeCandidate("req-net-dominant", {
          effectiveStoredEnergyValue: 3.0,
          netStoredEnergyValue: 20.0,
        }),
        // Lower net but higher effective
        makeCandidate("req-effective-dominant", {
          effectiveStoredEnergyValue: 14.0,
          netStoredEnergyValue: 15.0,
        }),
      ];

      const result = evaluateEconomicActionPreference(candidates, normalContext);

      // effectiveStoredEnergyValue is the decisive score (14 > 3)
      expect(result!.preferredOpportunityId).toBe("req-effective-dominant");
    });

    it("prefers candidate with 0.0 explicit value over undefined (only one has data)", () => {
      const candidates = [
        makeCandidate("req-no-data"),
        makeCandidate("req-explicit-zero", { effectiveStoredEnergyValue: 0.0 }),
        makeCandidate("req-positive", { effectiveStoredEnergyValue: 5.0 }),
      ];

      const result = evaluateEconomicActionPreference(candidates, normalContext);

      expect(result!.preferredOpportunityId).toBe("req-positive");
    });

    it("selects the first candidate on an exact tie (deterministic tiebreak)", () => {
      const candidates = [
        makeCandidate("req-first", { effectiveStoredEnergyValue: 8.0 }),
        makeCandidate("req-second", { effectiveStoredEnergyValue: 8.0 }),
      ];

      const result = evaluateEconomicActionPreference(candidates, normalContext);

      expect(result!.preferredOpportunityId).toBe("req-first");
      expect(result!.rejections[0].reasonCode).toBe("ECONOMIC_PREFERENCE_TIE_BROKEN");
      expect(result!.isFallback).toBe(false);
    });

    it("handles three candidates and rejects two", () => {
      const candidates = [
        makeCandidate("req-mid", { effectiveStoredEnergyValue: 7.0 }),
        makeCandidate("req-best", { effectiveStoredEnergyValue: 19.2 }),
        makeCandidate("req-worst", { effectiveStoredEnergyValue: 2.1 }),
      ];

      const result = evaluateEconomicActionPreference(candidates, normalContext);

      expect(result!.preferredOpportunityId).toBe("req-best");
      expect(result!.rejections).toHaveLength(2);
      const rejectedIds = result!.rejections.map((r) => r.opportunityId);
      expect(rejectedIds).toContain("req-mid");
      expect(rejectedIds).toContain("req-worst");
      expect(result!.alternativesConsidered).toBe(3);
    });
  });

  describe("low-confidence fallback to safest action", () => {
    const lowConfidenceContext: EconomicPreferenceContext = {
      optimizationMode: "cost",
      planningConfidenceLevel: "low",
    };

    it("selects hold action over higher-value aggressive action when confidence is low", () => {
      const candidates = [
        makeCandidate("req-charge", {
          action: "charge_battery",
          effectiveStoredEnergyValue: 14.0,
        }),
        makeCandidate("req-hold", {
          action: "hold",
          effectiveStoredEnergyValue: 0.0,
        }),
      ];

      const result = evaluateEconomicActionPreference(candidates, lowConfidenceContext);

      expect(result!.preferredOpportunityId).toBe("req-hold");
      expect(result!.isFallback).toBe(true);
      expect(result!.rejections[0].opportunityId).toBe("req-charge");
      expect(result!.rejections[0].reasonCode).toBe("INFERIOR_ECONOMIC_VALUE");
      expect(result!.selectionReason).toContain("Low planning confidence");
    });

    it("falls back to first candidate when no hold-like action is present", () => {
      const candidates = [
        makeCandidate("req-first", {
          action: "charge_battery",
          effectiveStoredEnergyValue: 5.0,
        }),
        makeCandidate("req-second", {
          action: "discharge_battery",
          effectiveStoredEnergyValue: 18.0,
        }),
      ];

      const result = evaluateEconomicActionPreference(candidates, lowConfidenceContext);

      // No hold action available; first candidate is used as conservative fallback
      expect(result!.preferredOpportunityId).toBe("req-first");
      expect(result!.isFallback).toBe(true);
    });

    it("treats undefined action as hold-like under low-confidence fallback", () => {
      const candidates = [
        makeCandidate("req-aggressive", {
          action: "export_to_grid",
          effectiveStoredEnergyValue: 20.0,
        }),
        makeCandidate("req-unmatched"),  // no action = hold-like, no economic data (scores 0)
      ];

      const result = evaluateEconomicActionPreference(candidates, lowConfidenceContext);

      // req-aggressive has economic data so hasEconomicData is true.
      // Under low confidence the function selects the hold-like (undefined action) candidate.
      expect(result).not.toBeNull();
      expect(result!.preferredOpportunityId).toBe("req-unmatched");
      expect(result!.isFallback).toBe(true);
      expect(result!.rejections[0].opportunityId).toBe("req-aggressive");
    });
  });

  describe("integration with mixed data sources", () => {
    it("only one candidate has economic data; still triggers selection", () => {
      const candidates = [
        makeCandidate("req-no-data"),
        makeCandidate("req-with-data", { effectiveStoredEnergyValue: 10.0 }),
      ];

      const result = evaluateEconomicActionPreference(candidates, normalContext);

      // hasEconomicData is true because req-with-data has value
      // req-no-data scores 0, req-with-data scores 10 → req-with-data wins
      expect(result).not.toBeNull();
      expect(result!.preferredOpportunityId).toBe("req-with-data");
      expect(result!.rejections[0].opportunityId).toBe("req-no-data");
      expect(result!.rejections[0].inferiorByPencePerKwh).toBeCloseTo(10.0);
    });

    it("includes selection explanation text in result", () => {
      const candidates = [
        makeCandidate("req-inferior", { action: "charge_battery", effectiveStoredEnergyValue: 3.0 }),
        makeCandidate("req-superior", { action: "discharge_battery", effectiveStoredEnergyValue: 15.0 }),
      ];

      const result = evaluateEconomicActionPreference(candidates, normalContext);

      expect(result!.selectionReason).toContain("discharge_battery");
      expect(result!.rejections[0].selectionReason).toContain("3.00 p/kWh");
      expect(result!.rejections[0].selectionReason).toContain("15.00 p/kWh");
    });

    it("returns correct alternativesConsidered count", () => {
      const candidates = [
        makeCandidate("r1", { effectiveStoredEnergyValue: 1 }),
        makeCandidate("r2", { effectiveStoredEnergyValue: 2 }),
        makeCandidate("r3", { effectiveStoredEnergyValue: 3 }),
        makeCandidate("r4", { effectiveStoredEnergyValue: 4 }),
      ];

      const result = evaluateEconomicActionPreference(candidates, normalContext);

      expect(result!.alternativesConsidered).toBe(4);
      expect(result!.preferredOpportunityId).toBe("r4");
      expect(result!.rejections).toHaveLength(3);
    });
  });
});
