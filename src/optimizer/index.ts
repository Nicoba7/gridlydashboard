export { optimize } from "./engine";
export { buildOptimizerExplanation, type OptimizerExplanation } from "./explain";
export {
  buildOptimizerInputFromLegacyPlanContext,
  type LegacyConnectedDeviceId,
  type LegacyPlanContextInput,
  type LegacyPlanningStyle,
  type LegacyRate,
} from "./inputAdapter";
export {
  buildCanonicalPlan,
  type CanonicalPlanBuildResult,
  type GridlyPlanSession,
  type PlanSlot,
  type PlanSummary,
  type PlanWithSessions,
} from "./planBuilder";
export { optimizeForLegacyPlanUi, type LegacyPlanUiResult } from "./uiAdapter";