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

  back: {
    fontSize: 13,
    color: "#9CA3AF",
    textDecoration: "none",
  } as React.CSSProperties,

  heading: {
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: -0.8,
    color: "#F9FAFB",
    marginBottom: 32,
    marginTop: 8,
    lineHeight: 1.2,
  } as React.CSSProperties,

  section: {
    marginBottom: 36,
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#4B5563",
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    marginBottom: 10,
  } as React.CSSProperties,

  body: {
    fontSize: 14,
    color: "#D1D5DB",
    lineHeight: 1.65,
    margin: 0,
  } as React.CSSProperties,

  list: {
    margin: "8px 0 0 0",
    padding: "0 0 0 18px",
    fontSize: 14,
    color: "#D1D5DB",
    lineHeight: 1.75,
  } as React.CSSProperties,

  link: {
    color: "#22C55E",
    textDecoration: "none",
  } as React.CSSProperties,

  footer: {
    borderTop: "1px solid #111827",
    padding: "20px 0 32px",
    fontSize: 12,
    color: "#374151",
    textAlign: "center" as const,
    marginTop: 12,
  } as React.CSSProperties,
};

export default function Privacy() {
  return (
    <div style={S.page}>
      {/* Nav */}
      <nav style={S.nav}>
        <a href="/" style={S.logo}>Aveum</a>
        <a href="/" style={S.back}>← Back</a>
      </nav>

      <h1 style={S.heading}>Privacy &amp; Security</h1>

      {/* What we collect */}
      <section style={S.section}>
        <div style={S.sectionTitle}>What we collect</div>
        <p style={S.body}>
          Your name, email address, and device credentials — things like your Octopus API key,
          inverter serial number, or charger login. Nothing else.
        </p>
      </section>

      {/* How we store it */}
      <section style={S.section}>
        <div style={S.sectionTitle}>How we store it</div>
        <p style={S.body}>
          Everything is encrypted and stored in a London-region database. Your credentials are
          never stored in plain text. We use them only to connect to your devices on your behalf —
          for example, to schedule overnight charging.
        </p>
      </section>

      {/* What we never do */}
      <section style={S.section}>
        <div style={S.sectionTitle}>What we never do</div>
        <ul style={S.list}>
          <li>Sell your data</li>
          <li>Share it with third parties</li>
          <li>Access your devices outside of the scheduled optimisation window</li>
          <li>Make changes without your permission</li>
        </ul>
      </section>

      {/* Deleting your account */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Deleting your account</div>
        <p style={S.body}>
          Email{" "}
          <a href="mailto:hello@getaveum.com" style={S.link}>hello@getaveum.com</a>
          {" "}and we'll delete everything within 24 hours. No questions asked.
        </p>
      </section>

      {/* Security */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Security</div>
        <ul style={S.list}>
          <li>HTTPS for all connections</li>
          <li>Device credentials encrypted at rest</li>
          <li>Automated secret scanning on every code change</li>
        </ul>
      </section>

      {/* Footer */}
      <footer style={S.footer}>
        getaveum.com · © 2026 Aveum · Built in London
      </footer>
    </div>
  );
}
