const checks = [
  "Supervisor-managed dashboard process",
  "Next.js standalone runtime",
  "Public container port 8000",
  "Python LiveKit worker sidecar"
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="panel" aria-labelledby="page-title">
        <p className="eyebrow">Inbound AI Voice Platform</p>
        <h1 id="page-title">Dashboard runtime is ready</h1>
        <p className="summary">
          This container serves the production Next.js dashboard from standalone output while the
          LiveKit voice worker runs under Supervisor.
        </p>
        <ul className="checks" aria-label="Container runtime checks">
          {checks.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
