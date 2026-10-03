import { useMemo, useState } from 'react';
import { category, type FolderGraph, type Selection } from '@/lib/canvas/model';
import { walk, type WalkDirection } from '@/lib/canvas/graph-maths';
import { folderKinds, type DetailIndex } from '@/lib/canvas/details';
import type { FrameworkMetadata } from '@/lib/adapters/taxonomy';

interface DetailProps { metadata: FrameworkMetadata; categoryFiles: Set<string> | null; repositoryName: string; edgeCount: number; index: DetailIndex; graph: FolderGraph; selection: Selection; hover: Selection; selectFile: (id: string) => void; setHover: (selection: Selection) => void }
export function DetailPane({ metadata, categoryFiles, repositoryName, edgeCount, index, graph, selection, hover, selectFile, setHover }: DetailProps) {
  const [tab, setTab] = useState<'structure' | 'explanation'>('structure');
  const [traversal, setTraversal] = useState<{ id: string; direction: WalkDirection } | null>(null);
  const file = selection?.kind === 'file' ? index.files.get(selection.id) : undefined;
  const direction = file && traversal?.id === file.id ? traversal.direction : null;
  const result = useMemo(() => file && direction ? walk(index, file.id, direction) : null, [index, file, direction]);
  const count = (ids: readonly string[]) => categoryFiles ? `${ids.filter(id => categoryFiles.has(id)).length} / ${ids.length} matched` : ids.length;
  const path = (id: string) => <button className={`detail-path ${categoryFiles && !categoryFiles.has(id) ? 'category-dimmed' : ''} ${hover?.kind === 'file' && hover.id === id || hover?.kind === 'folder' && graph.owner.get(id) === hover.id ? 'hovered' : ''}`} onClick={() => selectFile(id)} onMouseEnter={() => setHover({ kind: 'file', id })} onMouseLeave={() => setHover(null)} onFocus={() => setHover({ kind: 'file', id })} onBlur={() => setHover(null)}>{id}</button>;
  const neighbors = (direction: 'incoming' | 'outgoing', id: string) => {
    const rows = index[direction].get(id)!;
    return <section className="detail-section"><h3>{direction === 'outgoing' ? 'Dependencies' : 'Dependents'} <span>{count(rows.map(row => row.file.id))}</span></h3>{rows.length ? <ul className="detail-list">{rows.map(row => <li key={row.file.id} className={categoryFiles && !categoryFiles.has(row.file.id) ? 'category-dimmed' : ''}>{path(row.file.id)}<small>{row.kinds.join(', ')}</small></li>)}</ul> : <p className="detail-empty">None.</p>}</section>;
  };
  const folder = selection?.kind === 'folder' ? graph.folders.find(item => item.id === selection.id) : undefined;
  return <aside className="preview-details" aria-label="Details">
    {selection && <div className="detail-tabs" role="tablist" aria-label="Detail view">{(['structure', 'explanation'] as const).map(name => <button key={name} id={`detail-tab-${name}`} role="tab" aria-selected={tab === name} aria-controls={`detail-${name}`} onClick={() => setTab(name)}>{name === 'structure' ? 'Structure' : 'Explanation'}</button>)}</div>}
    <div id={selection ? `detail-${tab}` : undefined} role={selection ? "tabpanel" : undefined} aria-labelledby={selection ? `detail-tab-${tab}` : undefined}>
      {selection && tab === 'explanation' ? <><h2 className="detail-heading detail-mono">{file ? path(file.id) : folder?.id}</h2><p className="detail-empty">No explanation yet.</p></> : file ? <>
        <h2 className="detail-heading">{path(file.id)}</h2>
        <dl className="detail-facts"><dt>Kind</dt><dd>{category(file).name}</dd><dt>Module</dt><dd>{file.moduleKind}</dd><dt>Folder</dt><dd className="detail-mono">{file.folder || '.'}</dd><dt>Lines</dt><dd>{file.lines}</dd></dl>
        <section className="detail-section"><h3>Trace this file</h3><div className="traversal-buttons">{(['incoming', 'outgoing'] as const).map(value => <button key={value} aria-pressed={direction === value} onClick={() => setTraversal(direction === value ? null : { id: file.id, direction: value })}>{value === 'incoming' ? 'Blast radius' : 'Dependency chain'}</button>)}</div>
          {result && <div className="traversal-results">{result.levels.map(level => <section key={level.depth} className="detail-section"><h3>{level.depth} {level.depth === 1 ? 'step' : 'steps'} <span>{count(level.files.map(member => member.id))}</span></h3>{level.files.length ? <ul className="detail-list">{level.files.map(member => <li key={member.id} className={categoryFiles && !categoryFiles.has(member.id) ? 'category-dimmed' : ''}>{path(member.id)}</li>)}</ul> : <p className="detail-empty">None.</p>}</section>)}<p className="detail-empty">{result.furtherCount} further {result.furtherCount === 1 ? 'file' : 'files'} beyond 2 steps.</p></div>}
        </section>
        {neighbors('outgoing', file.id)}{neighbors('incoming', file.id)}
      </> : folder ? <>
        <h2 className="detail-heading detail-mono">{folder.id}</h2><p className="detail-empty">{categoryFiles ? `${count(folder.files.map(member => member.id))}` : `${folder.files.length} files`}</p>
        {folderKinds(folder).map(group => <section key={group.id} className="detail-section"><h3>{group.name} <span>{count(group.files.map(member => member.id))}</span></h3><ul className="detail-list">{group.files.map(member => <li key={member.id} className={categoryFiles && !categoryFiles.has(member.id) ? 'category-dimmed' : ''}>{path(member.id)}</li>)}</ul></section>)}
      </> : <>
        <h2 className="detail-heading">{repositoryName}</h2>
        <dl className="detail-facts"><dt>Framework</dt><dd>{metadata.framework === 'none' ? 'Not detected' : metadata.framework}</dd><dt>Files</dt><dd>{index.files.size}</dd><dt>Imports</dt><dd>{edgeCount}</dd><dt>Routes</dt><dd>{metadata.routes.length}</dd><dt>Unidentified</dt><dd>{index.unidentified}</dd></dl>
        <p className="detail-empty">Routes are emitted only when the method and full pattern can be recovered exactly.</p>
        <section className="detail-section"><h3>Routes <span>{metadata.routes.length}</span></h3>{metadata.routes.length ? <table className="routes-table"><thead><tr><th>Method</th><th>Pattern</th></tr></thead><tbody>{metadata.routes.map(route => <tr key={`${route.file}:${route.method}:${route.path}`}><td><code>{route.method}</code></td><td><button className="detail-path" title={route.file} onClick={() => selectFile(route.file)}>{route.path}</button></td></tr>)}</tbody></table> : <p className="detail-empty">No exactly recoverable routes.</p>}</section>
        <section className="detail-section"><h3>Most depended on <span>{count(index.dependedOn.map(member => member.id))}</span></h3>{index.dependedOn.length ? <ol className="detail-list detail-ranking">{index.dependedOn.map(member => <li key={member.id} className={categoryFiles && !categoryFiles.has(member.id) ? 'category-dimmed' : ''}>{path(member.id)}<small>{index.incoming.get(member.id)!.length} dependents</small></li>)}</ol> : <p className="detail-empty">None.</p>}</section>
        <section className="detail-section"><h3>Where to start <span>{count(index.entryFiles.map(member => member.id))}</span></h3><p className="detail-empty">Files nothing imports, ordered by dependency count.</p>{index.entryFiles.length ? <ol className="detail-list detail-ranking">{index.entryFiles.map(member => <li key={member.id} className={categoryFiles && !categoryFiles.has(member.id) ? 'category-dimmed' : ''}>{path(member.id)}<small>{index.outgoing.get(member.id)!.length} dependencies</small></li>)}</ol> : <p className="detail-empty">None.</p>}</section>
      </>}
    </div>
  </aside>;
}
