"use client";

export default function WorkspaceError({ retry }: { retry: () => void }) {
  return (
    <main className="workspace-content">
      <section className="analysis-empty" role="alert" aria-labelledby="error-heading">
        <h1 id="error-heading">Analyses could not load</h1>
        <p>Try loading this team&apos;s analyses again.</p>
        <button type="button" onClick={() => retry()}>Try again</button>
      </section>
    </main>
  );
}
