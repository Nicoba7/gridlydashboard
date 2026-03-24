import type { DeviceConfig } from "../pages/SimplifiedDashboard";

export type OptimizationAction = {
  title: string;
  detail: string;
  impactMonthly: number;
  type: "saving" | "earning";
};

export function buildOptimizationActions(params: {
  connectedDevices: DeviceConfig[];
  currentPence: number;
  bestSlotPrice: number;
  solarKw: number;
  gridExportW: number;
}): OptimizationAction[] {
  const { connectedDevices, currentPence, bestSlotPrice, solarKw, gridExportW } = params;
  const has = (id: string) => connectedDevices.some(d => d.id === id);
  const delta = Math.max(0, currentPence - bestSlotPrice);

  const actions: OptimizationAction[] = [];

  if (has("battery") && delta > 0.5) {
    actions.push({
      title: "Shift battery charging to cheaper slots",
      detail: `Wait for ~${bestSlotPrice.toFixed(1)}p slots instead of charging now at ${currentPence.toFixed(1)}p.`,
      impactMonthly: Number((delta * 1.8).toFixed(2)),
      type: "saving",
    });
  }

  if (has("ev") && delta > 0.5) {
    actions.push({
      title: "Delay EV charging to off-peak",
      detail: `Scheduling overnight could reduce charging cost spread by ${delta.toFixed(1)}p/kWh.`,
      impactMonthly: Number((delta * 2.4).toFixed(2)),
      type: "saving",
    });
  }

  if (has("solar") && has("grid") && solarKw > 1) {
    actions.push({
      title: "Maximise export in peak windows",
      detail: gridExportW > 0
        ? "You are exporting now — keep battery reserve available for evening peaks."
        : "Use battery reserve strategy to export more during expensive grid periods.",
      impactMonthly: Number((solarKw * 3.1).toFixed(2)),
      type: "earning",
    });
  }

  return actions
    .sort((a, b) => b.impactMonthly - a.impactMonthly)
    .slice(0, 3);
}
