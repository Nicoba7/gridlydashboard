import { useEffect, useState } from "react";

export default function FlowDot({
  active,
  color,
}: {
  active: boolean;
  color: string;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick(n => (n + 1) % 3), 500);
    return () => clearInterval(t);
  }, [active]);

  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: active && i === tick ? color : `${color}25`,
            transition: "background 0.2s",
          }}
        />
      ))}
    </div>
  );
}