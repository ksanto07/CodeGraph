import { InviteMember } from "@/components/invite-member";
import { analysisStatus } from "@/lib/analysis-state";
import { listAnalyses } from "@/lib/analyses";
import { requireWorkspace } from "@/lib/workspace";
import Link from "next/link";
import { RepositoryForm } from "@/components/repository-form";
import { AnalysisLive } from "@/components/analysis-live";
import { StaleRun } from "@/components/stale-run";

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ repository?: string }> }) {
  const { orgId, has } = await requireWorkspace();
  const analyses = await listAnalyses();
  const { repository } = await searchParams;

  return (
    <main className="workspace-content">
      <header className="analyses-heading">
        <h1>Analyses</h1>
        <p>Repository analyses for your active team.</p>
      </header>
      <RepositoryForm defaultValue={repository} />
      <AnalysisLive />
      {analyses.length === 0 ? (
        <section className="analysis-empty" aria-labelledby="empty-heading">
          <h2 id="empty-heading">No analyses yet</h2>
          <p>Paste a public TypeScript or JavaScript repository above to map its imports.</p>
        </section>
      ) : (
        <section aria-label="Team analyses">
          <div className="analysis-table-scroll" role="region" aria-label="Analyses table" tabIndex={0}>
            <table className="analysis-table">
              <caption>Latest analyses, up to 50. All times in UTC.</caption>
              <thead><tr><th scope="col">Repository</th><th scope="col">State</th><th scope="col">Created (UTC)</th></tr></thead>
              <tbody>
                {analyses.map((analysis) => {
                  const status = analysisStatus(analysis.state);
                  return (
                    <tr key={analysis.id}>
                      <td><Link href={`/analyses/${analysis.id}`}><code>{analysis.repository}</code></Link></td>
                      <td><span className={`analysis-status status-${status.tone}`} title={analysis.message}><span className="status-dot" aria-hidden="true" />{status.label}{analysis.state === 'running' && ` · ${analysis.stage}`}</span><StaleRun state={analysis.state} updatedAt={analysis.updatedAt} /></td>
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
