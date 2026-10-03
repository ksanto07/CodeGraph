export type FrameworkId = 'none' | 'nextjs' | 'nestjs' | 'react' | 'express';
export interface RoleCategory { id: string; name: string; color: string }
export interface FrameworkRoute { file: string; method: string; path: string }
export interface FrameworkMetadata { framework: FrameworkId; routes: FrameworkRoute[] }
const categories = {
  page: { id: 'page', name: 'Page routes', color: '#60a5fa' },
  api: { id: 'api', name: 'API endpoints', color: '#34d399' },
  action: { id: 'action', name: 'Server actions', color: '#fbbf24' },
  controller: { id: 'controller', name: 'Controllers', color: '#60a5fa' },
  service: { id: 'service', name: 'Services', color: '#34d399' },
  module: { id: 'module', name: 'Modules', color: '#a78bfa' },
  entity: { id: 'entity', name: 'Entities', color: '#fbbf24' },
  component: { id: 'component', name: 'Components', color: '#a78bfa' },
  hook: { id: 'hook', name: 'Hooks', color: '#fbbf24' },
  config: { id: 'config', name: 'Configuration', color: '#94a3b8' },
  generic: { id: 'generic', name: 'Files', color: '#64748b' },
} satisfies Record<string, RoleCategory>;
const taxonomy: Record<FrameworkId, readonly RoleCategory[]> = {
  nextjs: [categories.page, categories.api, categories.action, categories.component, categories.hook, categories.config, categories.generic],
  nestjs: [categories.controller, categories.service, categories.module, categories.entity, categories.config, categories.generic],
  react: [categories.component, categories.hook, categories.config, categories.generic],
  express: [categories.generic],
  none: [categories.config, categories.generic],
};
export function frameworkCategories(framework: FrameworkId): readonly RoleCategory[] { return taxonomy[framework]; }
export function roleCategory(role: string | undefined): RoleCategory | undefined {
  return Object.values(categories).find(category => category.id === role);
}
