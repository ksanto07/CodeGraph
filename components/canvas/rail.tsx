import { category, type FolderGraph } from '@/lib/canvas/model';
import { insightSentences, longFileThreshold, type Insights } from '@/lib/canvas/graph-maths';
import type { DetailIndex } from '@/lib/canvas/details';
import type { FileNode } from '@/lib/parser/types';

export interface CoverageSummary { skipped: number; unresolved: number; diagnostics: number }
interface RailProps {
  repositoryName: string; files: FileNode[]; edgeCount: number; graph: FolderGraph; index: DetailIndex; findings: Insights;
  coverage: CoverageSummary; activeCategory: string | null; setCategory: (id: string | null) => void; selectFile: (id: string) => void;
}
export function Rail({ repositoryName, files, edgeCount, graph, index, findings, coverage, activeCategory, setCategory, selectFile }: RailProps) {
  const counts = new Map<string, { name: string; color: string; count: number }>();
  for (const file of files) {
    const item = category(file);
    counts.set(item.id, { ...item, count: (counts.get(item.id)?.count ?? 0) + 1 });
  }
  const matched = (members: readonly FileNode[]) => members.filter(file => !activeCategory || category(file).id === activeCategory).length;
  const count = (members: readonly FileNode[]) => activeCategory ? `${matched(members)} / ${members.length}` : members.length;
  const path = (file: FileNode, key = file.id) => <li key={key} className={activeCategory && category(file).id !== activeCategory ? 'category-dimmed' : ''}><button className="detail-path" onClick={() => selectFile(file.id)}>{file.id}</button></li>;
  return <aside className="preview-rail" aria-label="Repository categories and insights">
    <h1>{repositoryName}</h1><p className="preview-meta">{files.length} files<br />{edgeCount} imports<br />{graph.folders.length} folders</p>
    <ul className="category-list"><li><button aria-pressed={!activeCategory} onClick={() => setCategory(null)}><span /><span>All files</span><span className="category-total">{files.length}</span></button></li>{[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([id, item]) => <li key={id}><button aria-pressed={activeCategory === id} onClick={() => setCategory(activeCategory === id ? null : id)}><span className="category-dot" style={{ background: item.color }} /><span>{item.name}</span><span className="category-total">{item.count}</span></button></li>)}</ul>
    <details className="preview-coverage"><summary>Parser coverage</summary><p>{coverage.skipped} skipped files<br />{coverage.unresolved} unresolved imports<br />{coverage.diagnostics} config diagnostics</p><p>Unresolved imports produce no edges.</p></details>
    <details className="preview-insights"><summary>Insights</summary>
      <section className="insight-group"><h2>Files nothing imports <span>{count(findings.unimported)}</span></h2><p>{insightSentences.unimported}</p><ul>{findings.unimported.map(file => path(file))}</ul>{!findings.unimported.length && <p>None.</p>}</section>
      <section className="insight-group"><h2>High fan-in <span>{count(findings.highFanIn)}</span></h2><p>{insightSentences.highFanIn}</p><p>{findings.fanInThreshold} or more importing files. At least 10 and two standard deviations above the mean.</p><ul>{findings.highFanIn.map(file => <li key={file.id} className={activeCategory && category(file).id !== activeCategory ? 'category-dimmed' : ''}><button className="detail-path" onClick={() => selectFile(file.id)}>{file.id}</button><small>{index.incoming.get(file.id)!.length} importing files</small></li>)}</ul>{!findings.highFanIn.length && <p>None.</p>}</section>
      <section className="insight-group"><h2>Import cycles <span>{findings.cycles.length}</span></h2><p>{insightSentences.cycle}</p>{findings.cycles.map(cycle => <details key={cycle.files[0].id} className="insight-cycle"><summary>{count(cycle.files)} files</summary><p>One directed cycle in this connected group. Read top to bottom, including the repeated starting file.</p><ol>{cycle.witness.map((file, i) => path(file, `${file.id}-${i}`))}</ol><details><summary>All group members</summary><ul>{cycle.files.map(file => path(file))}</ul></details></details>)}{!findings.cycles.length && <p>None.</p>}</section>
      <section className="insight-group"><h2>Long files <span>{count(findings.longFiles)}</span></h2><p>{insightSentences.longFile}</p><p>More than {longFileThreshold} lines.</p><ul>{findings.longFiles.map(file => <li key={file.id} className={activeCategory && category(file).id !== activeCategory ? 'category-dimmed' : ''}><button className="detail-path" onClick={() => selectFile(file.id)}>{file.id}</button><small>{file.lines} lines</small></li>)}</ul>{!findings.longFiles.length && <p>None.</p>}</section>
    </details>
  </aside>;
}
