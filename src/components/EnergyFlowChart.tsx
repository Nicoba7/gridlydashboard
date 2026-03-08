import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const data = [
  { time: "6am", solar: 0.1, consumption: 0.8, exported: 0 },
  { time: "7am", solar: 0.5, consumption: 1.0, exported: 0 },
  { time: "8am", solar: 1.8, consumption: 1.2, exported: 0.2 },
  { time: "9am", solar: 3.2, consumption: 1.5, exported: 0.8 },
  { time: "10am", solar: 4.1, consumption: 2.8, exported: 0.5 },
  { time: "11am", solar: 4.5, consumption: 1.8, exported: 1.5 },
  { time: "12pm", solar: 4.8, consumption: 1.2, exported: 2.0 },
  { time: "1pm", solar: 4.6, consumption: 3.5, exported: 0.4 },
  { time: "2pm", solar: 3.9, consumption: 2.0, exported: 1.0 },
  { time: "3pm", solar: 2.8, consumption: 1.6, exported: 0.6 },
  { time: "4pm", solar: 1.5, consumption: 1.8, exported: 0 },
  { time: "5pm", solar: 0.4, consumption: 2.2, exported: 0 },
];

const EnergyFlowChart = () => {
  return (
    <div className="rounded-2xl bg-card p-4 border border-border">
      <h3 className="text-sm font-semibold text-foreground mb-1">Energy Flow Today</h3>
      <p className="text-xs text-muted-foreground mb-4">Solar vs Consumption vs Export</p>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="solarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(45, 92%, 55%)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(45, 92%, 55%)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="consumeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(210, 80%, 55%)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(210, 80%, 55%)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="exportGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(280, 60%, 55%)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(280, 60%, 55%)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: "hsl(220, 10%, 50%)" }}
              axisLine={false}
              tickLine={false}
              interval={2}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(220, 10%, 50%)" }}
              axisLine={false}
              tickLine={false}
              unit="kW"
            />
            <Tooltip
              contentStyle={{
                background: "hsl(220, 18%, 11%)",
                border: "1px solid hsl(220, 15%, 18%)",
                borderRadius: "0.75rem",
                fontSize: "12px",
                color: "hsl(220, 10%, 92%)",
              }}
            />
            <Area
              type="monotone"
              dataKey="solar"
              stroke="hsl(45, 92%, 55%)"
              fill="url(#solarGrad)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="consumption"
              stroke="hsl(210, 80%, 55%)"
              fill="url(#consumeGrad)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="exported"
              stroke="hsl(280, 60%, 55%)"
              fill="url(#exportGrad)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-4 mt-3 justify-center">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-solar" />
          <span className="text-xs text-muted-foreground">Solar</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-ev" />
          <span className="text-xs text-muted-foreground">Usage</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-grid" />
          <span className="text-xs text-muted-foreground">Export</span>
        </div>
      </div>
    </div>
  );
};

export default EnergyFlowChart;
