export default function AskAveumCard() {
  return (
    <div style={{ margin: "0 20px 16px", background: "#0D1117", border: "1px solid #1F2937", borderRadius: 16, padding: "16px 20px" }}>
      <div style={{ fontSize: 10, color: "#93C5FD", fontWeight: 700, letterSpacing: 1.5, marginBottom: 10 }}>ASK GRIDLY</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[
          "Why isn’t my battery charging?",
          "What if I charged the EV now?",
          "How much solar will I generate tomorrow?",
        ].map((q) => (
          <button
            key={q}
            style={{
              flex: 1,
              minWidth: 150,
              background: "#0F172A",
              border: "1px solid #1F2937",
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 12,
              color: "#94A3B8",
              cursor: "pointer",
              textAlign: "left",
            }}
            onClick={() => {
              window.alert("Aveum: " + q);
            }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
