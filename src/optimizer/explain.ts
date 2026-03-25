import type { OptimizerDiagnostic, OptimizerInput } from "../domain";
import type { CanonicalPlanBuildResult } from "./planBuilder";

export interface OptimizerExplanation {
  headline: string;
  diagnostics: OptimizerDiagnostic[];
  confidence: number;
}

function dedupeDiagnostics(diagnostics: OptimizerDiagnostic[]): OptimizerDiagnostic[] {
  const seen = new Set<string>();
  const unique: OptimizerDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.message}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(diagnostic);
  }

  return unique;
}

function buildConstraintDigest(input: OptimizerInput): OptimizerDiagnostic[] {
  const diagnostics: OptimizerDiagnostic[] = [];

  diagnostics.push({
    code: "MODE_SELECTION",
    message: `Planner mode is '${input.constraints.mode}', using the current legacy strategy bridge for fast migration.`,
    severity: "info",
  });

  if (input.constraints.batteryReservePercent !== undefined) {
    diagnostics.push({
      code: "BATTERY_RESERVE_TARGET",
      message: `Battery reserve target is set to ${input.constraints.batteryReservePercent}%.`,
      severity: "info",
    });
  }

  if (input.constraints.maxBatteryCyclesPerDay !== undefined) {
    diagnostics.push({
      code: "BATTERY_CYCLE_LIMIT",
      message: `Battery cycling is limited to ${input.constraints.maxBatteryCyclesPerDay} planned charge window(s) per day.`,
      severity: "info",
    });
  }

  return diagnostics;
}

function chooseHeadline(result: CanonicalPlanBuildResult): string {
  const firstActiveDecision = result.decisions.find((decision) => decision.action !== "hold");
  if (!firstActiveDecision) {
    return "Aveum is holding steady while it waits for a stronger opportunity.";
  }

  return result.headline;
}

export function buildOptimizerExplanation(
  input: OptimizerInput,
  result: CanonicalPlanBuildResult,
): OptimizerExplanation {
  const diagnostics = dedupeDiagnostics([
    ...result.diagnostics,
    ...buildConstraintDigest(input),
  ]);

  return {
    headline: chooseHeadline(result),
    diagnostics,
    confidence: result.confidence,
  };
}