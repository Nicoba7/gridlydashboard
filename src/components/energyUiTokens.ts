export const ENERGY_DEVICE_COLORS = {
  solar: "#F5B942",
  grid: "#8B7CF6",
  battery: "#4ADE80",
  ev: "#38BDF8",
  home: "#94A3B8",
} as const;

export const ENERGY_NODE_TOKENS = {
  inactiveFill: "#0C1422",
  inactiveStroke: "#1A2535",
  haloAlpha: "16",
  activeFillAlpha: "0A",
  activeStrokeAlpha: "45",
} as const;

export const ENERGY_CONNECTOR_TOKENS = {
  inactiveStroke: "#141E2C",
  activeAlpha: {
    home: "3A",
    plan: "45",
  },
  strokeWidth: {
    active: 1.5,
    inactive: 1,
  },
  dasharray: "4 3",
} as const;

export const ENERGY_GLOW_TOKENS = {
  timelineDot: {
    active: "0 0 8px %DOT%, 0 0 16px %DOT%55",
    soon: "0 0 6px %DOT%, 0 0 12px %DOT%45",
    planned: "0 0 4px %DOT%, 0 0 8px %DOT%35",
    defaultLeading: "0 0 4px %DOT%, 0 0 8px %DOT%30",
    none: "none",
  },
} as const;
