import dagre, { type GraphLabel } from '@dagrejs/dagre';
import type { FolderGraph } from './model.ts';

export const rowHeight = 26;
export const visibleRows = 12;
export function dimensions(folder: FolderGraph['folders'][number], expanded: boolean) {
  const labelWidth = folder.label.length * 7 + 46;
  return {
    width: expanded ? Math.max(260, Math.min(440, Math.max(labelWidth, ...folder.files.map(file => file.id.length * 6 + 40)))) : Math.max(110, labelWidth),
    height: expanded ? 56 + Math.min(visibleRows, folder.files.length) * rowHeight + (folder.files.length > visibleRows ? 28 : 0) : 44 + Math.min(110, folder.fanIn * 2),
  };
}
function stronglyConnected(graph: InstanceType<typeof dagre.graphlib.Graph>): string[][] {
  // Dagre 3.1.1 declares tarjan as "tarjam". Check the untyped export at this boundary.
  const algorithms: unknown = dagre.graphlib.alg;
  if (!algorithms || typeof algorithms !== 'object' || !('tarjan' in algorithms) || typeof algorithms.tarjan !== 'function') throw new Error('Dagre does not expose tarjan.');
  const result: unknown = algorithms.tarjan(graph);
  if (!Array.isArray(result)) throw new Error('Dagre returned invalid components.');
  return result.map(component => {
    if (!Array.isArray(component)) throw new Error('Dagre returned an invalid component.');
    return Array.from(component, id => {
      if (typeof id !== 'string') throw new Error('Dagre returned an invalid folder ID.');
      return id;
    });
  });
}

type PositionedFolder = { id: string; position: { x: number; y: number }; width: number; height: number };
type Island = { id: string; nodes: PositionedFolder[]; width: number; height: number };
const gap = 28;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function folderTopology(graph: FolderGraph) {
  const connections = new dagre.graphlib.Graph();
  for (const folder of [...graph.folders].sort((a, b) => compare(a.id, b.id))) connections.setNode(folder.id);
  const edges = [...new Set(graph.edges.map(edge => `${graph.owner.get(edge.from)}\0${graph.owner.get(edge.to)}`))].sort();
  for (const edge of edges) {
    const [from, to] = edge.split('\0');
    if (from !== to) connections.setEdge(from, to);
  }
  const components = stronglyConnected(connections).map(ids => ids.sort(compare)).sort((a, b) => compare(a[0], b[0]));
  const owner = new Map(components.flatMap(ids => ids.map(id => [id, ids[0]] as const)));
  const islands = dagre.graphlib.alg.components(connections).map(ids => ids.sort(compare)).sort((a, b) => compare(a[0], b[0]));
  return { components, owner, islands, edges };
}

function componentPanel(ids: string[], folders: Map<string, FolderGraph['folders'][number]>, columns: number, expanded: ReadonlySet<string>): Island {
  const nodes: PositionedFolder[] = [];
  let width = 0;
  let y = 0;
  for (let offset = 0; offset < ids.length; offset += columns) {
    let x = 0;
    let height = 0;
    for (const id of ids.slice(offset, offset + columns)) {
      const size = dimensions(folders.get(id)!, expanded.has(id));
      nodes.push({ id, position: { x, y }, ...size });
      x += size.width + gap;
      height = Math.max(height, size.height);
    }
    width = Math.max(width, x - gap);
    y += height + gap;
  }
  return { id: ids[0], nodes, width, height: y - gap };
}

function layeredIslands(graph: FolderGraph, topology: ReturnType<typeof folderTopology>, columns: number, expanded: ReadonlySet<string>): Island[] {
  const folders = new Map(graph.folders.map(folder => [folder.id, folder]));
  const panels = new Map(topology.components.map(ids => [ids[0], componentPanel(ids, folders, columns, expanded)]));
  return topology.islands.map(ids => {
    const layout = new dagre.graphlib.Graph<GraphLabel, { width: number; height: number; x: number; y: number }>();
    layout.setGraph({ rankdir: 'LR', ranksep: gap, nodesep: gap });
    layout.setDefaultEdgeLabel(() => ({}));
    const componentIds = [...new Set(ids.map(id => topology.owner.get(id)!))].sort(compare);
    for (const id of componentIds) {
      const panel = panels.get(id)!;
      layout.setNode(id, { width: panel.width, height: panel.height, x: 0, y: 0 });
    }
    for (const edge of topology.edges) {
      const [source, target] = edge.split('\0');
      const from = topology.owner.get(source)!;
      const to = topology.owner.get(target)!;
      if (from !== to && layout.hasNode(from) && layout.hasNode(to)) layout.setEdge(from, to);
    }
    dagre.layout(layout);
    const left = Math.min(...componentIds.map(id => layout.node(id).x - layout.node(id).width / 2));
    const top = Math.min(...componentIds.map(id => layout.node(id).y - layout.node(id).height / 2));
    const nodes = componentIds.flatMap(id => {
      const point = layout.node(id);
      return panels.get(id)!.nodes.map(node => ({ ...node, position: { x: point.x - point.width / 2 - left + node.position.x, y: point.y - point.height / 2 - top + node.position.y } }));
    });
    return { id: ids[0], nodes, width: Math.max(...nodes.map(node => node.position.x + node.width)), height: Math.max(...nodes.map(node => node.position.y + node.height)) };
  });
}

function packIslands(islands: Island[], targetWidth: number) {
  const ordered = [...islands].sort((a, b) => b.width * b.height - a.width * a.height || compare(a.id, b.id));
  const widthLimit = Math.max(targetWidth, ...ordered.map(island => island.width));
  const placed: Array<Island & { x: number; y: number }> = [];
  for (const island of ordered) {
    const xs = [0, ...placed.map(item => item.x + item.width + gap)].sort((a, b) => a - b);
    const ys = [0, ...placed.map(item => item.y + item.height + gap)].sort((a, b) => a - b);
    let position: { x: number; y: number } | undefined;
    for (const y of ys) {
      for (const x of xs) {
        if (x + island.width > widthLimit) continue;
        if (placed.every(item => x + island.width + gap <= item.x || item.x + item.width + gap <= x || y + island.height + gap <= item.y || item.y + item.height + gap <= y)) {
          position = { x, y };
          break;
        }
      }
      if (position) break;
    }
    if (!position) throw new Error('Cannot place a disconnected graph island.');
    placed.push({ ...island, ...position });
  }
  const nodes = placed.flatMap(island => island.nodes.map(node => ({ ...node, position: { x: island.x + node.position.x, y: island.y + node.position.y } }))).sort((a, b) => compare(a.id, b.id));
  return { nodes, width: Math.max(0, ...nodes.map(node => node.position.x + node.width)), height: Math.max(0, ...nodes.map(node => node.position.y + node.height)) };
}

export function layoutGraph(graph: FolderGraph, expanded: ReadonlySet<string>) {
  const topology = folderTopology(graph);
  let chosen = { columns: 2, targetWidth: 700, score: Infinity };
  for (const columns of [2, 3, 4]) {
    const islands = layeredIslands(graph, topology, columns, new Set());
    for (const targetWidth of [700, 800, 900]) {
      const packed = packIslands(islands, targetWidth);
      const score = Math.max(packed.width / 876, packed.height / 720);
      if (score < chosen.score) chosen = { columns, targetWidth, score };
    }
  }
  return packIslands(layeredIslands(graph, topology, chosen.columns, expanded), chosen.targetWidth).nodes;
}

export function endpointHandle(folder: FolderGraph['folders'][number], file: string, expanded: boolean, start: number, partiallyVisible = false) {
  if (!expanded) return 'folder';
  const index = folder.files.findIndex(member => member.id === file);
  return index >= start && index < start + visibleRows + (partiallyVisible ? 1 : 0) ? file : 'overflow';
}
