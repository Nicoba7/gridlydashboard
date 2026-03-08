import { Home, ArrowRight, Zap, Battery, PoundSterling, TrendingUp, Users } from "lucide-react";

const tiers = [
  {
    homes: "1",
    label: "Single Home",
    storage: "13.5 kWh",
    gridPower: "3.6 kW",
    earnings: "£1,200/yr",
    description: "One household optimising its own solar, EV, and battery.",
    iconCount: 1,
  },
  {
    homes: "10",
    label: "Street",
    storage: "135 kWh",
    gridPower: "36 kW",
    earnings: "£14,000/yr",
    description: "Coordinated charging and export across a neighbourhood.",
    iconCount: 3,
  },
  {
    homes: "100",
    label: "Community",
    storage: "1.35 MWh",
    gridPower: "360 kW",
    earnings: "£160,000/yr",
    description: "Virtual power plant — visible to grid operators.",
    iconCount: 5,
  },
  {
    homes: "1,000",
    label: "District",
    storage: "13.5 MWh",
    gridPower: "3.6 MW",
    earnings: "£1.8M/yr",
    description: "Aggregated fleet participates in energy markets directly.",
    iconCount: 7,
  },
];

const NetworkGrowth = () => {
  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Header */}
      <div className="px-5 pt-12 pb-2">
        <p className="text-xs font-medium text-primary uppercase tracking-wider">Network Effect</p>
        <h1 className="text-2xl font-bold text-foreground mt-1">Growth Creates Value</h1>
        <p className="text-sm text-muted-foreground mt-1">More homes = more storage, more power, more earnings.</p>
      </div>

      {/* Tiers */}
      <div className="px-5 mt-6 space-y-3">
        {tiers.map((tier, i) => (
          <div key={tier.homes}>
            <div
              className="rounded-2xl bg-card border border-border p-5"
              style={{
                borderColor: i === tiers.length - 1 ? "hsl(var(--primary) / 0.3)" : undefined,
                boxShadow: i === tiers.length - 1 ? "0 0 20px -5px hsl(var(--primary) / 0.2)" : undefined,
              }}
            >
              {/* Top row: step + home icons */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-base font-bold text-foreground">{tier.homes} {tier.homes === "1" ? "Home" : "Homes"}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{tier.label}</p>
                  </div>
                </div>
                {/* Stacked house icons */}
                <div className="flex -space-x-1.5">
                  {Array.from({ length: tier.iconCount }).map((_, j) => (
                    <div
                      key={j}
                      className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center border-2 border-card"
                      style={{ opacity: 0.5 + (j / tier.iconCount) * 0.5 }}
                    >
                      <Home className="w-3.5 h-3.5 text-primary" />
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-xs text-muted-foreground mb-3">{tier.description}</p>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-muted/50 p-2.5 text-center">
                  <Battery className="w-3.5 h-3.5 text-battery mx-auto mb-1" />
                  <p className="text-xs font-bold text-foreground">{tier.storage}</p>
                  <p className="text-[9px] text-muted-foreground">Storage</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-2.5 text-center">
                  <Zap className="w-3.5 h-3.5 text-grid mx-auto mb-1" />
                  <p className="text-xs font-bold text-foreground">{tier.gridPower}</p>
                  <p className="text-[9px] text-muted-foreground">Grid Power</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-2.5 text-center">
                  <PoundSterling className="w-3.5 h-3.5 text-primary mx-auto mb-1" />
                  <p className="text-xs font-bold text-foreground">{tier.earnings}</p>
                  <p className="text-[9px] text-muted-foreground">Earnings</p>
                </div>
              </div>
            </div>

            {/* Arrow between tiers */}
            {i < tiers.length - 1 && (
              <div className="flex flex-col items-center gap-0.5 py-2">
                <ArrowRight className="w-4 h-4 text-primary rotate-90" />
                <span className="text-[9px] font-semibold text-primary uppercase tracking-wider">
                  {i === 0 ? "10× growth" : i === 1 ? "10× growth" : "10× growth"}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Bottom insight */}
      <div className="px-5 mt-6">
        <div className="rounded-2xl bg-primary/5 border border-primary/10 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <p className="text-sm font-semibold text-foreground">Network Value Multiplier</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Each home added increases the total storage and dispatchable power of the network. At 1,000 homes, the fleet acts as a <span className="font-semibold text-foreground">virtual power plant</span> — unlocking wholesale energy market access and grid balancing revenue.
          </p>
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-foreground">1,000 homes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Battery className="w-4 h-4 text-battery" />
              <span className="text-xs font-medium text-foreground">13.5 MWh</span>
            </div>
            <div className="flex items-center gap-1.5">
              <PoundSterling className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-foreground">£1.8M/yr</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NetworkGrowth;
