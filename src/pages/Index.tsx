import { Sun, Zap, Battery, ArrowUpRight, PoundSterling, TrendingUp } from "lucide-react";
import CircularProgress from "@/components/CircularProgress";
import EnergyFlowChart from "@/components/EnergyFlowChart";
import HighlightCard from "@/components/HighlightCard";

const StatCard = ({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  unit,
  sub,
}: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  unit: string;
  sub?: string;
}) => (
  <div className="rounded-2xl bg-card border border-border p-4 flex items-start gap-3">
    <div className={`rounded-xl p-2.5 ${iconBg} shrink-0`}>
      <Icon className={`w-5 h-5 ${iconColor}`} />
    </div>
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground">
        {value} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  </div>
);

const Index = () => {
  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <div className="px-5 pt-12 pb-4">
        <p className="text-xs text-muted-foreground">Saturday, 8 March</p>
        <h1 className="text-2xl font-bold text-foreground mt-1">Good afternoon ☀️</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your home energy at a glance</p>
      </div>

      {/* Money Summary */}
      <div className="px-5 mb-5">
        <div className="rounded-2xl bg-card border border-border p-4 flex gap-4">
          <div className="flex-1 flex items-center gap-3">
            <div className="rounded-xl p-2.5 bg-primary/10 shrink-0">
              <PoundSterling className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Saved today</p>
              <p className="text-xl font-bold text-foreground">£3.00</p>
            </div>
          </div>
          <div className="w-px bg-border" />
          <div className="flex-1 flex items-center gap-3">
            <div className="rounded-xl p-2.5 bg-accent/10 shrink-0">
              <TrendingUp className="w-5 h-5 text-accent" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Earned (export)</p>
              <p className="text-xl font-bold text-foreground">£0.80</p>
            </div>
          </div>
        </div>
      </div>

      {/* Circular Gauges */}
      <div className="px-5 mb-5">
        <div className="rounded-2xl bg-card border border-border p-5 flex justify-around">
          <CircularProgress
            value={85}
            max={100}
            color="hsl(var(--ev))"
            label="EV Battery"
            unit="%"
            sublabel="40 kWh charged"
          />
          <CircularProgress
            value={62}
            max={100}
            color="hsl(var(--battery))"
            label="Home Battery"
            unit="%"
            sublabel="8.1 / 13.5 kWh"
          />
        </div>
      </div>

      {/* Stat Cards */}
      <div className="px-5 grid grid-cols-2 gap-3 mb-5">
        <StatCard
          icon={Sun}
          iconBg="bg-solar/10"
          iconColor="text-solar"
          label="Solar Generated"
          value="12.0"
          unit="kWh"
          sub="Peak at 12:15pm"
        />
        <StatCard
          icon={Zap}
          iconBg="bg-ev/10"
          iconColor="text-ev"
          label="EV Charging"
          value="40"
          unit="kWh"
          sub="Fully charged ✓"
        />
        <StatCard
          icon={Battery}
          iconBg="bg-battery/10"
          iconColor="text-battery"
          label="Battery Stored"
          value="8.1"
          unit="kWh"
          sub="62% capacity"
        />
        <StatCard
          icon={ArrowUpRight}
          iconBg="bg-grid/10"
          iconColor="text-grid"
          label="Grid Export"
          value="4.2"
          unit="kWh"
          sub="£0.80 earned"
        />
      </div>

      {/* Energy Flow Chart */}
      <div className="px-5 mb-5">
        <EnergyFlowChart />
      </div>

      {/* Highlights */}
      <div className="px-5">
        <HighlightCard />
      </div>
    </div>
  );
};

export default Index;
