import { Sun, Car, Battery, AlertTriangle, TrendingDown, Zap, CheckCircle, PoundSterling, TrendingUp, ArrowRight } from "lucide-react";

const ProblemItem = ({ icon: Icon, text }: { icon: React.ElementType; text: string }) => (
  <div className="flex items-start gap-2.5">
    <div className="rounded-lg p-1.5 bg-destructive/10 shrink-0 mt-0.5">
      <Icon className="w-4 h-4 text-destructive" />
    </div>
    <p className="text-sm text-foreground leading-snug">{text}</p>
  </div>
);

const SolutionItem = ({ icon: Icon, text }: { icon: React.ElementType; text: string }) => (
  <div className="flex items-start gap-2.5">
    <div className="rounded-lg p-1.5 bg-primary/10 shrink-0 mt-0.5">
      <Icon className="w-4 h-4 text-primary" />
    </div>
    <p className="text-sm text-foreground leading-snug">{text}</p>
  </div>
);

const CustomerValue = () => {
  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Header */}
      <div className="px-5 pt-12 pb-2">
        <p className="text-xs font-medium text-primary uppercase tracking-wider">Customer Value</p>
        <h1 className="text-2xl font-bold text-foreground mt-1">Why Homeowners Need This</h1>
        <p className="text-sm text-muted-foreground mt-1">The gap between owning assets and optimising them.</p>
      </div>

      {/* Two Panels */}
      <div className="px-5 mt-6 space-y-4">

        {/* Problem Panel */}
        <div className="rounded-2xl border border-destructive/20 bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-destructive" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Today — Without Optimisation</h2>
              <p className="text-xs text-muted-foreground">Assets underused, money wasted</p>
            </div>
          </div>

          <div className="space-y-3">
            <ProblemItem icon={Car} text="EV charges from the grid at peak rates — £0.30/kWh when solar is available for free" />
            <ProblemItem icon={Sun} text="Solar energy goes unused or exported at low feed-in rates (£0.04/kWh)" />
            <ProblemItem icon={Battery} text="Home battery sits idle — no smart scheduling for peak shaving" />
            <ProblemItem icon={TrendingDown} text="No visibility into what's happening — homeowner has no idea they're losing money" />
          </div>

          {/* Cost callout */}
          <div className="mt-4 rounded-xl bg-destructive/5 border border-destructive/10 p-3 flex items-center gap-3">
            <PoundSterling className="w-5 h-5 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">~£850/year wasted</p>
              <p className="text-xs text-muted-foreground">Unnecessary grid imports + missed export revenue</p>
            </div>
          </div>
        </div>

        {/* Arrow transition */}
        <div className="flex flex-col items-center gap-1 py-1">
          <ArrowRight className="w-5 h-5 text-primary rotate-90" />
          <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">With our platform</span>
        </div>

        {/* Solution Panel */}
        <div className="rounded-2xl border border-primary/20 bg-card p-5 energy-glow">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Tomorrow — With Optimisation</h2>
              <p className="text-xs text-muted-foreground">Automated, intelligent, profitable</p>
            </div>
          </div>

          <div className="space-y-3">
            <SolutionItem icon={Car} text="EV charges automatically from solar — zero grid cost during the day" />
            <SolutionItem icon={Sun} text="Solar prioritised for home use, excess stored in battery for peak hours" />
            <SolutionItem icon={Battery} text="Battery discharges to grid at peak tariff (£0.30/kWh) — earning money" />
            <SolutionItem icon={CheckCircle} text="Dashboard shows real-time savings, earnings, and smart decisions in action" />
          </div>

          {/* Savings callout */}
          <div className="mt-4 rounded-xl bg-primary/5 border border-primary/10 p-3">
            <div className="flex items-center gap-3 mb-2">
              <PoundSterling className="w-5 h-5 text-primary shrink-0" />
              <p className="text-sm font-semibold text-foreground">Daily example — 8 March</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Saved</span>
                <span className="text-lg font-bold text-foreground">£3.00</span>
                <span className="text-[10px] text-muted-foreground">EV charged via solar</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Earned</span>
                <span className="text-lg font-bold text-foreground">£0.80</span>
                <span className="text-[10px] text-muted-foreground">4.2 kWh grid export</span>
              </div>
            </div>
          </div>

          {/* Annual projection */}
          <div className="mt-3 rounded-xl bg-primary/5 border border-primary/10 p-3 flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">~£1,200/year projected</p>
              <p className="text-xs text-muted-foreground">Combined savings + export earnings</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom summary */}
      <div className="px-5 mt-6">
        <div className="rounded-2xl bg-muted/50 border border-border p-4 text-center">
          <p className="text-sm font-semibold text-foreground">Same assets. Smarter software.</p>
          <p className="text-xs text-muted-foreground mt-1">No new hardware needed — just connect and optimise.</p>
        </div>
      </div>
    </div>
  );
};

export default CustomerValue;
