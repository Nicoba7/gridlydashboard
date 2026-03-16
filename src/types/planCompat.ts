export type ConnectedDeviceId = "solar" | "battery" | "ev" | "grid";

export type OptimisationMode = "CHEAPEST" | "BALANCED" | "GREENEST";

export type PlanActionType = "CHARGE" | "EXPORT" | "HOLD" | "SOLAR";

export type PlanSlot = {
  time: string;
  action: PlanActionType;
  title: string;
  reason: string;
  price: number;
  color: string;
  requires: ConnectedDeviceId[];
  highlight?: boolean;
  score?: number;
  decisionType?: "battery_charge" | "ev_charge" | "export" | "solar" | "hold";
};

export type GridlyPlanSessionType = "battery_charge" | "ev_charge" | "export" | "solar_use" | "hold";

export type GridlyPlanSession = {
  type: GridlyPlanSessionType;
  start: string;
  end: string;
  reasoning?: string[];
  priceRange?: string;
  priceMin: number;
  priceMax: number;
  color: string;
  highlight: boolean;
  slotCount: number;
};

export type PlanWithSessions = PlanSlot[] & {
  sessions: GridlyPlanSession[];
};

export type PlanSummary = {
  projectedEarnings: number;
  projectedSavings: number;
  cheapestSlot: string;
  cheapestPrice: number;
  peakSlot: string;
  peakPrice: number;
  mode: OptimisationMode;
  batteryReserveTargetPct: number;
  batteryReserveStartPct: number;
  batteryCyclesPlanned: number;
  evReadyBy?: string;
  evSlotsPlanned: number;
  estimatedImportSpend: number;
  estimatedExportRevenue: number;
  rationale: string[];
};

export type GridlyPlanIntent =
  | "capture_cheap_energy"
  | "protect_deadline"
  | "use_solar"
  | "avoid_peak_import"
  | "export_at_peak";

export type GridlyPlanSummary = {
  planHeadline: string;
  keyOutcomes: string[];
  intent: GridlyPlanIntent;
  customerReason: string;
  estimatedValue?: number;
  showSolarInsight: boolean;
  showPriceChart: boolean;
  showInsightCard: boolean;
};