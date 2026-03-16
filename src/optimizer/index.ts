export { optimize } from "./engine";
export { buildOptimizerExplanation, type OptimizerExplanation } from "./explain";
export {
  buildCanonicalPlan,
  type CanonicalPlanBuildResult,
  type GridlyPlanSession,
  type PlanSlot,
  type PlanSummary,
  type PlanWithSessions,
} from "./planBuilder";