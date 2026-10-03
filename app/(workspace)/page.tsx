import { InviteMember } from "@/components/invite-member";
import { analysisStatus } from "@/lib/analysis-state";
import { listAnalyses } from "@/lib/analyses";
import { requireWorkspace } from "@/lib/workspace";

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function WorkspacePage() {
  const { orgId, has } = await requireWorkspace();
  const analyses = await listAnalyses();

  return (
    <main className="workspace-content">
      <header className="analyses-heading">
        <h1>Analyses</h1>
        <p>Repository analyses for your active team.</p>
      </header>
      {analyses.length === 0 ? (
        <section className="analysis-empty" aria-labelledby="empty-heading">
          <h2 id="empty-heading">No analyses yet</h2>
          <p>This team has no analyses. Repository analysis is not available yet.</p>
        </section>
      ) : (
        <section aria-label="Team analyses">
          <p className="fixture-note">Seeded examples. These repositories have not been analyzed.</p>
          <div className="analysis-table-scroll" role="region" aria-label="Analyses table" tabIndex={0}>
            <table className="analysis-table">
              <caption>Latest analyses, up to 50. All times in UTC.</caption>
              <thead><tr><th scope="col">Repository</th><th scope="col">State</th><th scope="col">Created (UTC)</th></tr></thead>
              <tbody>
                {analyses.map((analysis) => {
                  const status = analysisStatus(analysis.state);
                  return (
                    <tr key={analysis.id}>
                      <td><code>{analysis.repository}</code></td>
                      <td><span className={`analysis-status status-${status.tone}`}><span className="status-dot" aria-hidden="true" />{status.label}</span></td>
                      <td><time dateTime={analysis.createdAt}>{dateFormat.format(new Date(analysis.createdAt))}</time></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {has({ role: "org:admin" }) && <InviteMember key={orgId} />}
    </main>
  );
}
