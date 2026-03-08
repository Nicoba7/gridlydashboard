import { Sun, Car, Battery, Cpu, BarChart3, Zap, ArrowDown, ArrowRight, Wifi, PoundSterling } from "lucide-react";

const FlowNode = ({
  icon: Icon,
  label,
  sublabel,
  colorClass,
  bgClass,
}: {
  icon: React.ElementType;
  label: string;
  sublabel: string;
  colorClass: string;
  bgClass: string;
}) => (
  <div className="flex flex-col items-center text-center gap-2">
    <div className={`rounded-2xl p-4 ${bgClass} border border-border shadow-sm`}>
      <Icon className={`w-7 h-7 ${colorClass}`} />
    </div>
    <div>
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground leading-tight max-w-[140px]">{sublabel}</p>
    </div>
  </div>
);

const FlowArrow = ({ label, direction = "down" }: { label: string; direction?: "down" | "right" }) => (
  <div className={`flex ${direction === "down" ? "flex-col" : "flex-row"} items-center gap-1 py-2`}>
    {direction === "down" ? (
      <ArrowDown className="w-5 h-5 text-muted-foreground" />
    ) : (
      <ArrowRight className="w-5 h-5 text-muted-foreground" />
    )}
    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
  </div>
);

const HowItWorks = () => {
  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Header */}
      <div className="px-5 pt-12 pb-2">
        <p className="text-xs font-medium text-primary uppercase tracking-wider">How it works</p>
        <h1 className="text-2xl font-bold text-foreground mt-1">Energy Optimisation Platform</h1>
        <p className="text-sm text-muted-foreground mt-1">From your rooftop to your wallet — automated.</p>
      </div>

      {/* Step 1 — Assets */}
      <div className="px-5 mt-6">
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">1</span>
            <h2 className="text-sm font-semibold text-foreground">Household Assets</h2>
          </div>
          <div className="flex justify-around">
            <FlowNode icon={Sun} label="Solar Panels" sublabel="Generate clean energy" colorClass="text-solar" bgClass="bg-solar/10" />
            <FlowNode icon={Car} label="Electric Vehicle" sublabel="Smart charging" colorClass="text-ev" bgClass="bg-ev/10" />
            <FlowNode icon={Battery} label="Home Battery" sublabel="Store & discharge" colorClass="text-battery" bgClass="bg-battery/10" />
          </div>
        </div>
      </div>

      {/* Arrow */}
      <div className="flex justify-center">
        <FlowArrow label="Real-time data" />
      </div>

      {/* Step 2 — Data Collection */}
      <div className="px-5">
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">2</span>
            <h2 className="text-sm font-semibold text-foreground">Data Collection & APIs</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl p-3 bg-secondary shrink-0">
              <Wifi className="w-5 h-5 text-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Smart Meter & Inverter APIs</p>
              <p className="text-xs text-muted-foreground">Collects generation, consumption, battery SoC, EV charge state, tariff rates, and weather forecasts in real time.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["Solar inverter", "EV charger", "Battery BMS", "Smart meter", "Tariff API", "Weather API"].map((tag) => (
              <span key={tag} className="text-[10px] font-medium px-2 py-1 rounded-full bg-muted text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Arrow */}
      <div className="flex justify-center">
        <FlowArrow label="Processed signals" />
      </div>

      {/* Step 3 — Optimisation Engine */}
      <div className="px-5">
        <div className="rounded-2xl bg-card border border-border p-5 energy-glow">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">3</span>
            <h2 className="text-sm font-semibold text-foreground">Optimisation Engine</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl p-3 bg-primary/10 shrink-0">
              <Cpu className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Rule-Based Intelligence</p>
              <p className="text-xs text-muted-foreground">Decides when to charge EV, store in battery, use solar directly, or export to grid — maximising savings & earnings.</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              "Charge EV from solar first",
              "Store excess in battery",
              "Export at peak tariff",
              "Minimise grid import",
            ].map((rule) => (
              <div key={rule} className="flex items-start gap-1.5 text-xs text-foreground">
                <span className="text-primary mt-0.5">●</span>
                <span>{rule}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Arrows splitting */}
      <div className="flex justify-center">
        <FlowArrow label="Actions & results" />
      </div>

      {/* Step 4 & 5 — Dashboard + Grid */}
      <div className="px-5 grid grid-cols-2 gap-3">
        {/* Dashboard */}
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">4</span>
            <h2 className="text-xs font-semibold text-foreground">Dashboard</h2>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-xl p-3 bg-primary/10">
              <BarChart3 className="w-6 h-6 text-primary" />
            </div>
            <p className="text-xs text-muted-foreground text-center">User sees savings, earnings & live energy flow</p>
            <div className="flex items-center gap-1 mt-1">
              <PoundSterling className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm font-bold text-foreground">£3.80</span>
              <span className="text-[10px] text-muted-foreground">today</span>
            </div>
          </div>
        </div>

        {/* Grid Export */}
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">5</span>
            <h2 className="text-xs font-semibold text-foreground">Grid & Market</h2>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-xl p-3 bg-grid/10">
              <Zap className="w-6 h-6 text-grid" />
            </div>
            <p className="text-xs text-muted-foreground text-center">Surplus energy exported & sold at peak rates</p>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-sm font-bold text-foreground">4.2 kWh</span>
              <span className="text-[10px] text-muted-foreground">exported</span>
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="px-5 mt-6">
        <div className="rounded-2xl bg-muted/50 border border-border p-4">
          <p className="text-xs font-semibold text-foreground mb-2">Flow Legend</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 rounded-full bg-solar" />
              <span className="text-[10px] text-muted-foreground">Energy flow</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 rounded-full bg-ev" />
              <span className="text-[10px] text-muted-foreground">Data / API</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 rounded-full bg-primary" />
              <span className="text-[10px] text-muted-foreground">Optimisation</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 rounded-full bg-grid" />
              <span className="text-[10px] text-muted-foreground">Grid export</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HowItWorks;
