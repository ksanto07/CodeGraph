import type { FileNode } from '../parser/types.ts';
import type { DetailIndex } from './details.ts';

export type WalkDirection = 'incoming' | 'outgoing';
export interface WalkResult { levels: { depth: number; files: FileNode[] }[]; furtherCount: number }
export interface ImportCycle { files: FileNode[]; witness: FileNode[] }
export interface Insights { unimported: FileNode[]; cycles: ImportCycle[]; highFanIn: FileNode[]; fanInThreshold: number; longFiles: FileNode[] }
export const longFileThreshold = 500;
export const insightSentences = {
  unimported: 'No parsed file imports this file.',
  cycle: 'These files form an import cycle.',
  highFanIn: 'Many parsed files import this file.',
  longFile: 'This file contains more than 500 lines.',
} as const;

export function walk(index: DetailIndex, origin: string, direction: WalkDirection, depthLimit = 2): WalkResult {
  if (!index.files.has(origin)) throw new Error('Walk origin is not a parsed file.');
  if (!Number.isInteger(depthLimit) || depthLimit < 0) throw new Error('Walk depth must be a nonnegative integer.');
  const distance = new Map([[origin, 0]]);
  const queue = [origin];
  const levels = Array.from({ length: depthLimit }, (_, i) => ({ depth: i + 1, files: [] as FileNode[] }));
  let furtherCount = 0;
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const { file } of index[direction].get(id)!) {
      if (distance.has(file.id)) continue;
      const depth = distance.get(id)! + 1;
      distance.set(file.id, depth);
      queue.push(file.id);
      if (depth <= depthLimit) levels[depth - 1].files.push(file);
      else furtherCount++;
    }
  }
  for (const level of levels) level.files.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { levels, furtherCount };
}

function cycles(index: DetailIndex): ImportCycle[] {
  const visited = new Set<string>();
  const finished: string[] = [];
  for (const origin of index.files.keys()) {
    if (visited.has(origin)) continue;
    visited.add(origin);
    const stack = [{ id: origin, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const neighbors = index.outgoing.get(frame.id)!;
      if (frame.next === neighbors.length) { finished.push(frame.id); stack.pop(); continue; }
      const id = neighbors[frame.next++].file.id;
      if (!visited.has(id)) { visited.add(id); stack.push({ id, next: 0 }); }
    }
  }
  visited.clear();
  const result: ImportCycle[] = [];
  for (let i = finished.length - 1; i >= 0; i--) {
    const origin = finished[i];
    if (visited.has(origin)) continue;
    const members: string[] = [];
    const stack = [origin];
    visited.add(origin);
    while (stack.length) {
      const id = stack.pop()!;
      members.push(id);
      for (const neighbor of index.incoming.get(id)!) if (!visited.has(neighbor.file.id)) { visited.add(neighbor.file.id); stack.push(neighbor.file.id); }
    }
    members.sort();
    const first = members[0];
    if (members.length === 1 && !index.outgoing.get(first)!.some(row => row.file.id === first)) continue;
    const inside = new Set(members);
    const next = index.outgoing.get(first)!.find(row => inside.has(row.file.id))!.file.id;
    const parents = new Map<string, string | null>([[next, null]]);
    const queue = [next];
    for (let head = 0; head < queue.length && !parents.has(first); head++) {
      for (const row of index.outgoing.get(queue[head])!) {
        if (!inside.has(row.file.id) || parents.has(row.file.id)) continue;
        parents.set(row.file.id, queue[head]); queue.push(row.file.id);
      }
    }
    const path: string[] = [];
    let cursor: string | null = first;
    while (cursor !== null) { path.push(cursor); cursor = parents.get(cursor)!; }
    path.reverse();
    result.push({ files: members.map(id => index.files.get(id)!), witness: [index.files.get(first)!, ...path.map(id => index.files.get(id)!)] });
  }
  return result.sort((a, b) => a.files[0].id < b.files[0].id ? -1 : 1);
}

export function insights(index: DetailIndex): Insights {
  const files = [...index.files.values()];
  const degrees = files.map(file => index.incoming.get(file.id)!.length);
  const mean = degrees.reduce((sum, count) => sum + count, 0) / (files.length || 1);
  const variance = degrees.reduce((sum, count) => sum + (count - mean) ** 2, 0) / (files.length || 1);
  const fanInThreshold = Math.max(10, Math.ceil(mean + 2 * Math.sqrt(variance)));
  return {
    unimported: files.filter(file => !index.incoming.get(file.id)!.length && !file.annotations.entryPoint),
    cycles: cycles(index),
    highFanIn: files.filter(file => index.incoming.get(file.id)!.length >= fanInThreshold),
    fanInThreshold,
    longFiles: files.filter(file => file.lines > longFileThreshold),
  };
}
