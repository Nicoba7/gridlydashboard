import { type GridlyMode } from "./gridlyEngine";

export type OptimisationGoal = "MAX_SAVINGS" | "LOWEST_CARBON" | "BATTERY_CARE" | "EV_READY";

export type CopilotAction = "START_CHARGE" | "DELAY_90" | "PAUSE_UNTIL_CHEAP" | "EXPORT_NOW" | "HOLD";

export type FeedbackEvent = "accepted" | "skipped";

type CandidateAction = {
  action: CopilotAction;
  title: string;
  reason: string;
  impact: string;
};

export type AiRecommendationInput = {
  mode: GridlyMode;
  currentPence: number;
  bestSlotPence: number;
  hasBattery: boolean;
  hasGrid: boolean;
  hasEV: boolean;
  optimisationGoal: OptimisationGoal;
  projectedDayPlanSavings: number;
};

export type AiRecommendation = CandidateAction & {
  confidence: number;
  trustScore: number;
};

const COPILOT_FEEDBACK_KEY = "gridly.ai.feedback.v1";

type StoredFeedback = {
  accepted: number;
  skipped: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readFeedback(): StoredFeedback {
  if (typeof window === "undefined") {
    return { accepted: 0, skipped: 0 };
  }

  const raw = window.localStorage.getItem(COPILOT_FEEDBACK_KEY);
  if (!raw) return { accepted: 0, skipped: 0 };

  try {
    const parsed = JSON.parse(raw) as Partial<StoredFeedback>;
    return {
      accepted: Math.max(0, parsed.accepted ?? 0),
      skipped: Math.max(0, parsed.skipped ?? 0),
    };
  } catch {
    return { accepted: 0, skipped: 0 };
  }
}

function writeFeedback(feedback: StoredFeedback) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COPILOT_FEEDBACK_KEY, JSON.stringify(feedback));
}

export function recordAiFeedback(event: FeedbackEvent) {
  const feedback = readFeedback();
  if (event === "accepted") feedback.accepted += 1;
  else feedback.skipped += 1;
  writeFeedback(feedback);
  return feedback;
}

export function getAiTrustScore() {
  const feedback = readFeedback();
  const total = feedback.accepted + feedback.skipped;

  if (total === 0) return 0.66;

  const acceptanceRate = feedback.accepted / total;
  const volumeBoost = clamp(total / 24, 0, 1) * 0.1;
  return clamp(0.45 + acceptanceRate * 0.45 + volumeBoost, 0.4, 0.95);
}

function getCandidates(input: AiRecommendationInput): CandidateAction[] {
  const { bestSlotPence, currentPence, hasBattery, hasEV, mode, optimisationGoal } = input;

  return [
    {
      action: "EXPORT_NOW",
      title: "Export now",
      reason: "Current price is in a premium window, so this is a strong earning slot.",
      impact: "Estimated +£0.45 this hour",
    },
    {
      action: "DELAY_90",
      title: "Delay charging by 90 minutes",
      reason: `A cheaper slot is coming (${bestSlotPence.toFixed(1)}p). Waiting captures better value.`,
      impact: `Estimated saving ~£${((currentPence - bestSlotPence) * 0.08).toFixed(2)}`,
    },
    {
      action: "START_CHARGE",
      title: "Start EV charging now",
      reason: "EV-ready mode prioritises hitting your target on time.",
      impact: "Higher readiness confidence by departure time",
    },
    {
      action: "PAUSE_UNTIL_CHEAP",
      title: "Pause until cleaner window",
      reason: "Lowest-carbon mode shifts usage to greener grid periods.",
      impact: "Lower CO₂ intensity for this session",
    },
    {
      action: "HOLD",
      title: "Hold current plan",
      reason: "Gridly is already in a near-optimal state for your selected goal.",
      impact: "No major change expected",
    },
  ].filter((candidate) => {
    if (candidate.action === "EXPORT_NOW") return mode === "EXPORT" && hasBattery && input.hasGrid;
    if (candidate.action === "DELAY_90") return currentPence - bestSlotPence >= 4 && (hasBattery || hasEV);
    if (candidate.action === "START_CHARGE") return optimisationGoal === "EV_READY" && hasEV;
    if (candidate.action === "PAUSE_UNTIL_CHEAP") return optimisationGoal === "LOWEST_CARBON";
    return true;
  });
}

function scoreCandidate(candidate: CandidateAction, input: AiRecommendationInput, trustScore: number) {
  const { currentPence, bestSlotPence, hasBattery, hasEV, hasGrid, optimisationGoal, projectedDayPlanSavings } = input;
  const priceDelta = currentPence - bestSlotPence;
  let score = 45;

  if (candidate.action === "EXPORT_NOW") {
    score += hasBattery && hasGrid ? 20 : -10;
    score += currentPence >= 30 ? 12 : 0;
    score += optimisationGoal === "MAX_SAVINGS" ? 8 : 0;
  }

  if (candidate.action === "DELAY_90") {
    score += clamp(priceDelta * 2, -4, 16);
    score += hasBattery || hasEV ? 10 : -6;
    score += optimisationGoal === "MAX_SAVINGS" ? 6 : 0;
  }

  if (candidate.action === "START_CHARGE") {
    score += hasEV ? 16 : -20;
    score += optimisationGoal === "EV_READY" ? 16 : 0;
    score += currentPence <= 14 ? 8 : 0;
  }

  if (candidate.action === "PAUSE_UNTIL_CHEAP") {
    score += optimisationGoal === "LOWEST_CARBON" ? 18 : 0;
    score += priceDelta > 2 ? 5 : 0;
    score += currentPence > 20 ? 8 : 0;
  }

  if (candidate.action === "HOLD") {
    score += 6;
    score += Math.abs(priceDelta) <= 1 ? 8 : 0;
  }

  score += clamp(projectedDayPlanSavings * 8, 0, 12);
  score = score * trustScore;

  return clamp(Math.round(score), 35, 95);
}

export function buildAiRecommendation(input: AiRecommendationInput): AiRecommendation {
  const trustScore = getAiTrustScore();
  const candidates = getCandidates(input);

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      confidence: scoreCandidate(candidate, input, trustScore),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const top = ranked[0];

  return {
    ...top,
    trustScore,
  };
}
