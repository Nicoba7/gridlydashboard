import type { OptimizerInput, OptimizerOutput } from "../domain";
import { optimize } from "./engine";

export interface CanonicalPlanBuildResult {
  planId: string;
  generatedAt: string;
  headline: string;
  decisions: OptimizerOutput["decisions"];
  recommendedCommands: OptimizerOutput["recommendedCommands"];
  summary: OptimizerOutput["summary"];
  diagnostics: OptimizerOutput["diagnostics"];
  confidence: number;
}

/**
 * Build canonical input payload for the plan bridge.
 *
 * This is intentionally pure so callers can test or evolve input shaping
 * without touching runtime orchestration.
 */
export function buildOptimizerInput(input: OptimizerInput): OptimizerInput {
  return {
    systemState: {
      ...input.systemState,
      devices: [...input.systemState.devices],
    },
    forecasts: {
      ...input.forecasts,
      householdLoadKwh: [...input.forecasts.householdLoadKwh],
      solarGenerationKwh: [...input.forecasts.solarGenerationKwh],
      carbonIntensity: input.forecasts.carbonIntensity
        ? [...input.forecasts.carbonIntensity]
        : undefined,
    },
    tariffSchedule: {
      ...input.tariffSchedule,
      importRates: [...input.tariffSchedule.importRates],
      exportRates: input.tariffSchedule.exportRates
        ? [...input.tariffSchedule.exportRates]
        : undefined,
    },
    constraints: {
      ...input.constraints,
    },
  };
}

function mapOptimizerOutputToPlanResult(
  optimizerOutput: OptimizerOutput,
): CanonicalPlanBuildResult {
  return {
    planId: optimizerOutput.planId,
    generatedAt: optimizerOutput.generatedAt,
    headline: optimizerOutput.headline,
    decisions: optimizerOutput.decisions,
    recommendedCommands: optimizerOutput.recommendedCommands,
    summary: optimizerOutput.summary,
    diagnostics: optimizerOutput.diagnostics,
    confidence: optimizerOutput.confidence,
  };
}

/**
 * Plan UI bridge orchestration.
 *
 * Flow:
 * 1) normalize canonical input
 * 2) run canonical optimizer entrypoint
 * 3) map optimizer output into existing plan/UI bridge shape
 */
export function buildCanonicalPlan(input: OptimizerInput): CanonicalPlanBuildResult {
  const optimizerInput = buildOptimizerInput(input);
  const optimizerOutput = optimize(optimizerInput);

  return mapOptimizerOutputToPlanResult(optimizerOutput);
}
