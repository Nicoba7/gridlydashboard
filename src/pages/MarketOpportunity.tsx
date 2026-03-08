import { Car, Sun, Home, TrendingUp, PoundSterling, Target, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

const adoptionData = [
  { year: "2024", evSolar: 1.2, label: "1.2M" },
  { year: "2026", evSolar: 2.4, label: "2.4M" },
  { year: "2028", evSolar: 4.1, label: "4.1M" },
  { year: "2030", evSolar: 6.5, label: "6.5M" },
];

const tamData = [
  { segment: "EV Owners", households: "3.5M", value: "£4.2B", color: "hsl(var(--ev))" },
  { segment: "Solar Homes", households: "1.8M", value: "£2.2B", color: "hsl(var(--solar))" },
  { segment: "EV + Solar", households: "1.2M", value: "£1.4B", color: "hsl(var(--primary))" },
];

const unitEconomics = [
  { label: "Grid cost savings", value: "£850", sub: "Smart EV charging + self-consumption" },
  { label: "Export earnings", value: "£350", sub: "Battery discharge at peak tariff" },
  { label: "Total per home", value: "£1,200", sub: "Annual value per connected household", highlight: true },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.[0]) {
    return (
      <div className="rounded-xl bg-card border border-border p-3 shadow-lg">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p className="text-sm text-primary font-bold">{payload[0].value}M households</p>
      </div>
    );
  }
  return null;
};

const MarketOpportunity = () => {
  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Header */}
      <div className="px-5 pt-12 pb-2">
        <p className="text-xs font-medium text-primary uppercase tracking-wider">Market Opportunity</p>
        <h1 className="text-2xl font-bold text-foreground mt-1">The UK Energy Transition</h1>
        <p className="text-sm text-muted-foreground mt-1">Millions of homes, billions in untapped value.</p>
      </div>

      {/* Key stat banner */}
      <div className="px-5 mt-5">
        <div className="rounded-2xl bg-primary/5 border border-primary/10 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Target className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-lg font-bold text-foreground">£7.8B</p>
            <p className="text-xs text-muted-foreground">Total addressable market by 2030</p>
          </div>
        </div>
      </div>

      {/* Adoption chart */}
      <div className="px-5 mt-5">
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">EV + Solar Household Growth</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">UK households with EV, solar, or both (millions)</p>

          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={adoptionData} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="year"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `${v}M`}
                  domain={[0, 8]}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                <Bar dataKey="evSolar" radius={[6, 6, 0, 0]}>
                  {adoptionData.map((_, idx) => (
                    <Cell
                      key={idx}
                      fill={idx === adoptionData.length - 1 ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.4)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Growth label */}
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary">5.4× growth from 2024 → 2030</span>
          </div>
        </div>
      </div>

      {/* Market segments */}
      <div className="px-5 mt-5">
        <div className="rounded-2xl bg-card border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">Market Segments (2024)</h2>
          <div className="space-y-2.5">
            {tamData.map((seg) => (
              <div key={seg.segment} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{seg.segment}</span>
                    <span className="text-xs font-bold text-foreground">{seg.households}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <div className="h-1.5 rounded-full bg-muted flex-1 mr-3">
                      <div
                        className="h-1.5 rounded-full transition-all duration-700"
                        style={{
                          backgroundColor: seg.color,
                          width: seg.segment === "EV Owners" ? "100%" : seg.segment === "Solar Homes" ? "52%" : "34%",
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{seg.value}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Unit economics */}
      <div className="px-5 mt-5">
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 mb-3">
            <PoundSterling className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Value Per Household</h2>
          </div>
          <div className="space-y-2.5">
            {unitEconomics.map((item) => (
              <div
                key={item.label}
                className={`rounded-xl p-3 ${item.highlight ? "bg-primary/5 border border-primary/10" : "bg-muted/50"}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm ${item.highlight ? "font-bold" : "font-medium"} text-foreground`}>
                    {item.label}
                  </span>
                  <span className={`text-base font-bold ${item.highlight ? "text-primary" : "text-foreground"}`}>
                    {item.value}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{item.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom projection */}
      <div className="px-5 mt-5">
        <div className="rounded-2xl bg-primary/5 border border-primary/10 p-4 text-center">
          <p className="text-xs text-muted-foreground">At 1% market capture by 2030</p>
          <div className="flex items-center justify-center gap-4 mt-2">
            <div>
              <p className="text-lg font-bold text-foreground">65,000</p>
              <p className="text-[10px] text-muted-foreground">Homes</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div>
              <p className="text-lg font-bold text-primary">£78M</p>
              <p className="text-[10px] text-muted-foreground">Annual revenue</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketOpportunity;
