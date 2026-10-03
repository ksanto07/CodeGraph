import type { FrameworkMetadata, FrameworkRoute } from './taxonomy';
import type { FileNode } from '../parser/types';

export function readFrameworkMetadata(value: unknown, files: readonly FileNode[]): FrameworkMetadata {
  if (value === undefined) return { framework: 'none', routes: [] };
  if (!value || typeof value !== 'object' || !('framework' in value) || !('routes' in value) || !Array.isArray(value.routes)) throw new Error('Invalid framework metadata.');
  const framework = value.framework;
  if (framework !== 'none' && framework !== 'nextjs' && framework !== 'nestjs' && framework !== 'react' && framework !== 'express') throw new Error('Unknown repository framework.');
  const ids = new Set(files.map(file => file.id));
  const routes = value.routes.map((route: unknown): FrameworkRoute => {
    if (!route || typeof route !== 'object' || !('file' in route) || typeof route.file !== 'string' || !ids.has(route.file) ||
      !('path' in route) || typeof route.path !== 'string' || !route.path.startsWith('/') || !('method' in route) || typeof route.method !== 'string') throw new Error('Invalid stored route.');
    return { file: route.file, path: route.path, method: route.method };
  });
  return { framework, routes };
}
