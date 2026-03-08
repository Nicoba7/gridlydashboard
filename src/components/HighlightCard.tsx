import { Zap, Sun, Battery } from "lucide-react";

const highlights = [
  {
    icon: Sun,
    color: "text-solar",
    bg: "bg-solar/10",
    text: "EV fully charged using solar — zero grid cost",
  },
  {
    icon: Battery,
    color: "text-battery",
    bg: "bg-battery/10",
    text: "Battery discharged to grid at peak rate (£0.30/kWh)",
  },
  {
    icon: Zap,
    color: "text-earnings",
    bg: "bg-accent/10",
    text: "Exported 4.2 kWh surplus to the grid today",
  },
];

const HighlightCard = () => {
  return (
    <div className="space-y-2.5">
      <h3 className="text-sm font-semibold text-foreground">Today's Highlights</h3>
      {highlights.map((h, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-xl bg-card border border-border p-3"
        >
          <div className={`rounded-lg p-2 ${h.bg} shrink-0`}>
            <h.icon className={`w-4 h-4 ${h.color}`} />
          </div>
          <p className="text-sm text-foreground leading-snug">{h.text}</p>
        </div>
      ))}
    </div>
  );
};

export default HighlightCard;
