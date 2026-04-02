import { useState } from "react";

const S = {
  page: {
    background: "#060A12",
    minHeight: "100vh",
    color: "#F9FAFB",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    maxWidth: 480,
    margin: "0 auto",
    padding: "0 20px",
  } as React.CSSProperties,

  nav: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px 0 24px",
  } as React.CSSProperties,

  logo: {
    fontSize: 18,
    fontWeight: 800,
    color: "#F9FAFB",
    textDecoration: "none",
    letterSpacing: -0.5,
  } as React.CSSProperties,

  signIn: {
    fontSize: 13,
    color: "#9CA3AF",
    textDecoration: "none",
  } as React.CSSProperties,

  hero: {
    paddingTop: 32,
    paddingBottom: 40,
  } as React.CSSProperties,

  headline: {
    fontSize: 34,
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacing: -1,
    marginBottom: 16,
    color: "#F9FAFB",
  } as React.CSSProperties,

  subheadline: {
    fontSize: 15,
    lineHeight: 1.6,
    color: "#9CA3AF",
    marginBottom: 28,
  } as React.CSSProperties,

  ctaButton: {
    display: "inline-block",
    background: "#22C55E",
    color: "#030712",
    fontWeight: 700,
    fontSize: 15,
    padding: "14px 28px",
    borderRadius: 12,
    textDecoration: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
  } as React.CSSProperties,

  proofBar: {
    borderTop: "1px solid #111827",
    borderBottom: "1px solid #111827",
    padding: "14px 0",
    marginBottom: 44,
  } as React.CSSProperties,

  proofText: {
    fontSize: 12,
    color: "#4B5563",
    lineHeight: 1.5,
  } as React.CSSProperties,

  section: {
    marginBottom: 44,
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#4B5563",
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    marginBottom: 20,
  } as React.CSSProperties,

  step: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 18,
  } as React.CSSProperties,

  stepNum: {
    width: 24,
    height: 24,
    borderRadius: "50%",
    background: "#111827",
    border: "1px solid #1F2937",
    color: "#6B7280",
    fontSize: 12,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  } as React.CSSProperties,

  stepText: {
    fontSize: 14,
    color: "#D1D5DB",
    lineHeight: 1.5,
  } as React.CSSProperties,

  worksWith: {
    fontSize: 13,
    color: "#4B5563",
    lineHeight: 1.6,
  } as React.CSSProperties,

  betaCard: {
    background: "#0B1120",
    border: "1px solid #1F2937",
    borderRadius: 14,
    padding: "24px 20px",
    marginBottom: 44,
  } as React.CSSProperties,

  betaTitle: {
    fontSize: 17,
    fontWeight: 700,
    color: "#F9FAFB",
    marginBottom: 16,
  } as React.CSSProperties,

  inputRow: {
    display: "flex",
    gap: 8,
  } as React.CSSProperties,

  emailInput: {
    flex: 1,
    background: "#111827",
    border: "1px solid #374151",
    borderRadius: 10,
    padding: "11px 13px",
    color: "#F9FAFB",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    minWidth: 0,
  } as React.CSSProperties,

  submitBtn: {
    background: "#22C55E",
    color: "#030712",
    fontWeight: 700,
    fontSize: 13,
    padding: "11px 16px",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
  } as React.CSSProperties,

  successMsg: {
    fontSize: 13,
    color: "#86EFAC",
    marginTop: 12,
  } as React.CSSProperties,

  footer: {
    borderTop: "1px solid #111827",
    padding: "20px 0 32px",
    fontSize: 12,
    color: "#374151",
    textAlign: "center" as const,
  } as React.CSSProperties,
};

export default function LandingPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/users?action=waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSubmitted(true);
    } catch {
      setSubmitted(true); // still show success to user
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={S.page}>
      {/* Nav */}
      <nav style={S.nav}>
        <a href="/" style={S.logo}>Aveum</a>
        <a href="/dashboard" style={S.signIn}>Sign in</a>
      </nav>

      {/* Hero */}
      <section style={S.hero}>
        <h1 style={S.headline}>Stop overpaying for electricity.</h1>
        <p style={S.subheadline}>
          Aveum runs your home at the cheapest times — automatically.
        </p>
        <p style={S.subheadline}>
          Works with Octopus Agile. EV, battery, or just one device. No solar required.
        </p>
        <a href="/onboarding" style={S.ctaButton}>Join the beta — it's free</a>
        <p style={S.proofText}>No setup. No technical knowledge. You stay in control.</p>
      </section>

      {/* Proof bar */}
      <div style={S.proofBar}>
        <p style={S.proofText}>
          We've already saved users money overnight by using cheaper electricity hours.
        </p>
      </div>

      {/* How it works */}
      <section style={S.section}>
        <div style={S.sectionTitle}>How it works</div>
        <div style={S.step}>
          <div style={S.stepNum}>1</div>
          <span style={S.stepText}>Connect your device — takes 2 minutes</span>
        </div>
        <div style={S.step}>
          <div style={S.stepNum}>2</div>
          <span style={S.stepText}>We run your home when electricity is cheapest</span>
        </div>
        <div style={S.step}>
          <div style={S.stepNum}>3</div>
          <span style={S.stepText}>Wake up to money saved</span>
        </div>
      </section>

      {/* Works with */}
      <section style={S.section}>
        <p style={S.worksWith}>
          Works with Octopus Agile · Tesla · GivEnergy · Solax · Ohme
        </p>
        <p style={S.worksWith}>
          🔒 Your credentials are encrypted and stored in a London-region database. We never sell your data.
        </p>
        <p style={S.worksWith}>
          You can delete your account and all data at any time.
        </p>
      </section>

      {/* Beta signup */}
      <div style={S.betaCard}>
        <div style={S.betaTitle}>Request early access</div>
        <form onSubmit={handleWaitlist}>
          <div style={S.inputRow}>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={S.emailInput}
              required
            />
            <button type="submit" style={S.submitBtn} disabled={submitting}>
              {submitting ? "..." : "Get access"}
            </button>
          </div>
        </form>
        {submitted && <p style={S.successMsg}>You're on the list.</p>}
      </div>

      {/* Footer */}
      <footer style={S.footer}>
        getaveum.com · © 2026 Aveum · Built in London ·{" "}
        <a href="/privacy" style={{ color: "#4B5563", textDecoration: "none" }}>Privacy</a>
      </footer>
    </div>
  );
}
