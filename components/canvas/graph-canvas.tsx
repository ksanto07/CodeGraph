'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Background, Controls, Handle, Panel, Position, ReactFlow, ReactFlowProvider, getNodesBounds, useReactFlow, useStore, useUpdateNodeInternals, type Node, type NodeProps, type Edge as FlowEdge } from '@xyflow/react';
import { category, foldGraph, selectionScope, uniqueLabels, type FolderNode, type Selection } from '@/lib/canvas/model';
import { endpointHandle, layoutGraph, rowHeight, visibleRows } from '@/lib/canvas/layout';
import { detailIndex } from '@/lib/canvas/details';
import { insights } from '@/lib/canvas/graph-maths';
import { canvasViewport } from '@/lib/canvas/viewport';
import { Rail, type CoverageSummary } from './rail';
import { DetailPane, type PaneExplanation } from './detail-pane';
import { classifyAnalysisBatch, explainSelectedTarget } from '@/app/(workspace)/analyses/ai-actions';
import type { AIAvailability, CachedExplanation } from '@/lib/ai/service';
import type { Edge, FileNode } from '@/lib/parser/types';
import type { FrameworkMetadata } from '@/lib/adapters/taxonomy';
import '@xyflow/react/dist/style.css';
import './canvas.css';

type CanvasProps = { analysisId: string; attempt: string; ai: AIAvailability; explanations: CachedExplanation[]; classifiedCount: number; files: FileNode[]; edges: Edge[]; repositoryName: string; coverage: CoverageSummary; metadata: FrameworkMetadata };
type PanelData = { categoryFiles: Set<string> | null; matches: number; folder: FolderNode; expanded: boolean; dimmed: boolean; highlightedFiles: Set<string>; selection: Selection; hover: Selection; reveal: { id: string; revision: number } | null; setHover: (selection: Selection) => void; start: number; labels: Map<string, string>; toggle: (id: string) => void; select: (selection: Selection) => void; scroll: (id: string, start: number) => void };
type PanelNode = Node<PanelData, 'folder'>;
function Endpoint({ id, top }: { id: string; top?: number }) {
  return <><Handle id={id} type="target" position={Position.Left} style={{ top }} /><Handle id={id} type="source" position={Position.Right} style={{ top }} /></>;
}
function FolderPanel({ id, data }: NodeProps<PanelNode>) {
  const { folder, expanded, dimmed, start, scroll: syncScroll, reveal } = data;
  const labels = data.labels;
  const rows = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!expanded || !rows.current) return;
    rows.current.scrollTop = start;
    syncScroll(folder.id, rows.current.scrollTop);
  }, [expanded, start, folder.id, syncScroll, reveal]);
  const updateInternals = useUpdateNodeInternals();
  useLayoutEffect(() => { updateInternals(id); }, [id, expanded, start, updateInternals]);
  const rowStart = Math.floor(start / rowHeight);
  const rowOffset = start % rowHeight;
  const overflow = folder.files.length > visibleRows;
  return <div className={`folder-panel ${expanded ? 'expanded' : ''} ${dimmed ? 'dimmed' : ''} ${data.hover?.id === folder.id || data.hover?.kind === 'file' && folder.files.some(file => file.id === data.hover?.id) ? 'hovered-folder' : ''} ${data.selection?.kind === 'folder' && data.selection.id === folder.id ? 'selected-folder' : ''}`}>
    {!expanded && <Endpoint id="folder" />}
    <button className="folder-header nodrag" aria-expanded={expanded} title={folder.id} onMouseEnter={() => data.setHover({ kind: 'folder', id: folder.id })} onMouseLeave={() => data.setHover(null)} onFocus={() => data.setHover({ kind: 'folder', id: folder.id })} onBlur={() => data.setHover(null)} onClick={() => { data.select({ kind: 'folder', id: folder.id }); data.toggle(folder.id); }}>
      <span className="folder-title">{expanded ? '▾' : '▸'} {labels.get(folder.id)}</span>
      <span className="folder-count">{data.categoryFiles ? `${data.matches} / ${folder.files.length} matched` : `${folder.files.length} files`}{expanded && <span> · {folder.fanIn} in · {folder.fanOut} out</span>}</span>
    </button>
    {expanded && <>
      <div ref={rows} className="file-rows nodrag nowheel" style={{ height: Math.min(visibleRows, folder.files.length) * rowHeight }} onScroll={event => data.scroll(folder.id, event.currentTarget.scrollTop)}>
        {folder.files.map(file => <button key={file.id} title={file.id} aria-label={file.id} className={`file-row ${data.hover?.kind === 'file' && data.hover.id === file.id ? 'hovered' : ''} ${data.selection && !data.highlightedFiles.has(file.id) || data.categoryFiles && !data.categoryFiles.has(file.id) ? 'dimmed' : ''} ${data.selection?.kind === 'file' && data.selection.id === file.id ? 'selected' : ''}`} onMouseEnter={() => data.setHover({ kind: 'file', id: file.id })} onMouseLeave={() => data.setHover(null)} onFocus={() => data.setHover({ kind: 'file', id: file.id })} onBlur={() => data.setHover(null)} onClick={() => data.select({ kind: 'file', id: file.id })}>
          <span className="category-dot" style={{ background: category(file).color }} />{labels.get(file.id) ?? file.id}
        </button>)}
      </div>
      {folder.files.slice(rowStart, rowStart + visibleRows + (rowOffset ? 1 : 0)).map((file, index) => <Endpoint key={file.id} id={file.id} top={Math.max(57, Math.min(55 + visibleRows * rowHeight, 56 + index * rowHeight + rowHeight / 2 - rowOffset))} />)}
      {overflow && <div className="folder-overflow">{folder.files.length - visibleRows} more · scroll to view<Endpoint id="overflow" top={56 + visibleRows * rowHeight + 14} /></div>}
    </>}
  </div>;
}
const nodeTypes = { folder: FolderPanel };
function Canvas({ analysisId, attempt, ai, explanations, classifiedCount, files, edges, repositoryName, coverage, metadata }: CanvasProps) {
  const graph = useMemo(() => foldGraph(files, edges), [files, edges]);
  const [activeCategory, setCategory] = useState<string | null>(null);
  const categoryFiles = useMemo(() => activeCategory ? new Set(files.filter(file => category(file).id === activeCategory).map(file => file.id)) : null, [files, activeCategory]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [explanationStates, setExplanationStates] = useState<Map<string, PaneExplanation>>(new Map());
  const requests = useRef(new Set<string>());
  const explanationMap = useMemo(() => {
    const hydrated = new Map<string, PaneExplanation>(explanations.map(item => [`${item.target.kind}:${item.target.id}`, { key: item.key, body: item.body }]));
    for (const [target, state] of explanationStates) {
      const saved = hydrated.get(target);
      if (!saved || !state.key || state.key === saved.key) hydrated.set(target, state);
    }
    return hydrated;
  }, [explanations, explanationStates]);
  const explanation = selection ? explanationMap.get(`${selection.kind}:${selection.id}`) : undefined;
  const explain = useCallback(() => {
    if (!selection) return;
    const target = { ...selection };
    const key = `${target.kind}:${target.id}`;
    if (requests.current.has(key)) return;
    requests.current.add(key);
    setExplanationStates(previous => new Map(previous).set(key, { ...explanationMap.get(key), loading: true, error: undefined }));
    startTransition(async () => {
      try {
        const result = await explainSelectedTarget(analysisId, target);
        setExplanationStates(previous => new Map(previous).set(key, result.status === 'ok' ? { body: result.body, key: result.key, result, loading: false } : { ...previous.get(key), loading: false, error: result.message.includes('CARTOGRAPH_') ? 'Choose an exact explanation model before continuing.' : result.message }));
      } catch { setExplanationStates(previous => new Map(previous).set(key, { ...previous.get(key), loading: false, error: 'The explanation request could not complete. Try again.' })); }
      finally { requests.current.delete(key); }
    });
  }, [selection, explanationMap, analysisId]);
  const classificationRun = useRef<{ cancelled: boolean } | null>(null);
  const context = JSON.stringify([analysisId, attempt, ai.classificationModel]);
  const classificationContext = useRef<string | null>(null);
  const [classificationPending, setClassificationPending] = useState<string | null>(null);
  const classifying = classificationPending === context;
  const [classificationMessage, setClassificationMessage] = useState('');
  const unidentifiedFiles = JSON.stringify(files.filter(file => file.annotations.role === 'generic' || !file.annotations.role).map(file => file.id).sort());
  const classificationEnabled = Boolean(ai.classificationModel && ai.connectionStatus?.authorized && ai.connectionStatus.sharing && unidentifiedFiles !== '[]');
  const classify = () => {
    if (classificationRun.current || !classificationEnabled) return;
    const run = { cancelled: false };
    classificationRun.current = run;
    setClassificationPending(context);
    startTransition(async () => {
        let count = classifiedCount;
        let changed = false;
        setClassificationMessage('Assigning roles to unidentified files…');
        try {
          for (;;) {
            const result = await classifyAnalysisBatch(analysisId);
            const next = Object.keys(result.roles).length;
            changed ||= next > count;
            if (run.cancelled || classificationContext.current !== context) break;
            if (result.status !== 'ok') { setClassificationMessage(result.message ?? 'Role classification could not complete.'); break; }
            setClassificationMessage(result.remaining ? `${result.remaining} unidentified files remaining.` : 'File roles updated.');
            if (!result.remaining) break;
            if (next <= count || result.processed === 0) { setClassificationMessage('Role classification made no progress. Click Classify files to try again.'); break; }
            count = next;
          }
        } catch { if (!run.cancelled && classificationContext.current === context) setClassificationMessage('Role classification could not complete. Click Classify files to try again.'); }
        finally {
          const ownsPendingState = classificationRun.current === run;
          if (ownsPendingState) classificationRun.current = null;
          if (classificationContext.current === context) {
            if (ownsPendingState) {
              setClassificationPending(null);
              if (run.cancelled) setClassificationMessage('Classification stopped. Click Classify files to continue when available.');
            }
            if (changed) router.refresh();
          }
        }
    });
  };
  useEffect(() => {
    classificationContext.current = context;
    return () => {
      classificationContext.current = null;
      if (classificationRun.current) classificationRun.current.cancelled = true;
      classificationRun.current = null;
    };
  }, [context]);
  useEffect(() => () => { if (classificationRun.current) classificationRun.current.cancelled = true; }, [analysisId, attempt, ai.classificationModel, ai.connectionStatus?.authorized, ai.connectionStatus?.sharing, unidentifiedFiles]);
  const [hover, setHover] = useState<Selection>(null);
  const [reveal, setReveal] = useState<{ id: string; revision: number } | null>(null);
  const index = useMemo(() => detailIndex(files, edges), [files, edges]);
  const findings = useMemo(() => insights(index), [index]);
  const [starts, setStarts] = useState<Map<string, number>>(new Map());
  const flow = useReactFlow<PanelNode>();
  const viewportReady = useStore(state => !!state.panZoom && state.width > 0 && state.height > 0);
  const measuredSizes = useStore(state => [...state.nodeLookup.values()].map(node => `${node.id}:${node.measured?.width}:${node.measured?.height}`).join('|'));
  const pendingFit = useRef(true);
  const initialFit = useRef(true);
  const openingZoom = useRef(1);
  const toggle = useCallback((id: string) => {
    pendingFit.current = false;
    openingZoom.current = flow.getZoom();
    setStarts(previous => { const next = new Map(previous); next.delete(id); return next; });
    setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else { next.add(id); pendingFit.current = true; } return next; });
  }, [flow]);
  const scroll = useCallback((id: string, start: number) => setStarts(previous => {
    if (previous.get(id) === start) return previous;
    const next = new Map(previous); next.set(id, start); return next;
  }), []);
  const selectFile = useCallback((id: string) => {
    const owner = graph.owner.get(id)!;
    const folder = graph.folders.find(item => item.id === owner)!;
    const offset = folder.files.findIndex(file => file.id === id) * rowHeight;
    const start = Math.min(offset, Math.max(0, (folder.files.length - visibleRows) * rowHeight));
    if (!expanded.has(owner)) {
      openingZoom.current = flow.getZoom();
      pendingFit.current = true;
      setExpanded(previous => new Set(previous).add(owner));
    }
    scroll(owner, start);
    setSelection({ kind: 'file', id });
    setReveal(previous => ({ id, revision: (previous?.revision ?? 0) + 1 }));
  }, [graph, expanded, flow, scroll]);
  const select = useCallback((next: Selection) => {
    if (next?.kind === 'file') selectFile(next.id);
    else setSelection(next);
  }, [selectFile]);
  const scope = useMemo(() => selectionScope(graph, selection), [graph, selection]);
  const labels = useMemo(() => uniqueLabels([...graph.folders.map(folder => folder.id), ...graph.folders.filter(folder => expanded.has(folder.id)).flatMap(folder => { const start = Math.floor((starts.get(folder.id) ?? 0) / rowHeight); return folder.files.slice(start, start + visibleRows + ((starts.get(folder.id) ?? 0) % rowHeight ? 1 : 0)).map(file => file.id); })]), [graph, expanded, starts]);
  const positions = useMemo(() => layoutGraph(graph, expanded), [graph, expanded]);
  const nodes: PanelNode[] = useMemo(() => positions.map(position => {
    const folder = graph.folders.find(item => item.id === position.id)!;
    return { ...position, style: { width: position.width, height: position.height, pointerEvents: 'all' }, className: 'nopan', type: 'folder', zIndex: 2, data: { categoryFiles, matches: folder.files.filter(file => !categoryFiles || categoryFiles.has(file.id)).length, folder, expanded: expanded.has(folder.id), dimmed: !!selection && !scope.folders.has(folder.id) || !!categoryFiles && !folder.files.some(file => categoryFiles.has(file.id)), highlightedFiles: scope.files, selection, hover, reveal, setHover, labels, start: starts.get(folder.id) ?? 0, toggle, select, scroll }, draggable: false, selectable: false };
  }), [positions, graph, expanded, selection, hover, reveal, scope, starts, toggle, select, scroll, labels, categoryFiles]);
  const canvasEdges = useMemo<FlowEdge[]>(() => graph.edges.flatMap<FlowEdge>((edge, index) => {
    const from = graph.owner.get(edge.from)!;
    const to = graph.owner.get(edge.to)!;
    if (from === to && !expanded.has(from)) return [];
    const source = graph.folders.find(folder => folder.id === from)!;
    const target = graph.folders.find(folder => folder.id === to)!;
    const outgoing = selection?.kind === 'file' ? edge.from === selection.id : selection?.kind === 'folder' && from === selection.id;
    return [{ id: String(index), source: from, target: to, zIndex: 0, sourceHandle: endpointHandle(source, edge.from, expanded.has(from), Math.floor((starts.get(from) ?? 0) / rowHeight), (starts.get(from) ?? 0) % rowHeight > 0), targetHandle: endpointHandle(target, edge.to, expanded.has(to), Math.floor((starts.get(to) ?? 0) / rowHeight), (starts.get(to) ?? 0) % rowHeight > 0), selectable: false, style: { stroke: selection && scope.edges.has(index) ? outgoing ? 'var(--active)' : 'var(--success)' : 'var(--muted)', opacity: categoryFiles && (!categoryFiles.has(edge.from) || !categoryFiles.has(edge.to)) ? 0.04 : selection && !scope.edges.has(index) ? 0.06 : selection && scope.edges.has(index) ? 1 : 0.22, strokeWidth: selection && scope.edges.has(index) ? 1.25 : 0.75, vectorEffect: 'non-scaling-stroke' } }];
  }), [graph, expanded, starts, selection, scope, categoryFiles]);
  useEffect(() => {
    const clear = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelection(null); };
    window.addEventListener('keydown', clear);
    return () => window.removeEventListener('keydown', clear);
  }, []);
  useEffect(() => {
    if (!viewportReady || !pendingFit.current) return;
    if (positions.some(position => {
      const node = flow.getInternalNode(position.id);
      return node?.measured?.width !== position.width || node?.measured?.height !== position.height || node.position.x !== position.position.x || node.position.y !== position.position.y;
    })) return;
    const frame = requestAnimationFrame(() => {
      const element = document.querySelector('.graph-map');
      if (!element) return;
      const bounds = getNodesBounds(flow.getNodes());
      const viewport = canvasViewport(bounds, element.clientWidth, element.clientHeight, Math.min(openingZoom.current, flow.getZoom(), 1), initialFit.current);
      void flow.setViewport(viewport, { duration: 0 });
      pendingFit.current = false;
      initialFit.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [viewportReady, measuredSizes, positions, flow, nodes]);
  return <><Rail metadata={metadata} repositoryName={repositoryName} files={files} edgeCount={edges.length} graph={graph} index={index} findings={findings} coverage={coverage} activeCategory={activeCategory} setCategory={setCategory} selectFile={selectFile} /><section className="graph-map" aria-label="Repository dependency map"><p className="graph-caption">Click a folder to open it. Select a file to trace its imports. Esc clears selection.{classificationMessage && <span className="classification-status" role="status">{classificationMessage}</span>}</p><ReactFlow zIndexMode="manual" elevateEdgesOnSelect={false} elevateNodesOnSelect={false} nodes={nodes} edges={canvasEdges} nodeTypes={nodeTypes} minZoom={0.05} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} onPaneClick={() => setSelection(null)} proOptions={{ hideAttribution: false }}>
    <Panel position="top-right"><div className="map-actions"><button className="clear-selection" title="Assign semantic roles to unidentified files using your connected ChatGPT plan." disabled={classifying || !classificationEnabled} onClick={classify}>{classifying ? 'Classifying…' : 'Classify files'}</button><button className="clear-selection" disabled={!selection} onClick={() => setSelection(null)}>Clear selection</button></div></Panel>
    <Background color="var(--border)" gap={20} size={1} /><Controls showInteractive={false} fitViewOptions={{ maxZoom: 1 }} />
  </ReactFlow></section><DetailPane analysisId={analysisId} explanation={explanation} explanationEnabled={Boolean(ai.explanationModel)} explain={explain} metadata={metadata} categoryFiles={categoryFiles} repositoryName={repositoryName} edgeCount={edges.length} index={index} graph={graph} selection={selection} hover={hover} selectFile={selectFile} setHover={setHover} /></>;
}
export function GraphCanvas(props: CanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
