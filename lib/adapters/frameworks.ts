import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Node, Project, SyntaxKind, type SourceFile } from 'ts-morph';
import type { ParseResult } from '../parser/types.ts';
import { nextEntryAdapter, runnerConfigAdapter } from './entry-points.ts';
import type { FrameworkId, FrameworkMetadata, FrameworkRoute } from './taxonomy.ts';

interface Manifest { folder: string; dependencies: Set<string> }
async function manifests(root: string): Promise<Manifest[]> {
  const found: Manifest[] = [];
  async function visit(folder: string): Promise<void> {
    const entries = await readdir(path.join(root, folder), { withFileTypes: true });
    if (entries.some(entry => entry.name === 'package.json')) {
      try {
        const value: unknown = JSON.parse(await readFile(path.join(root, folder, 'package.json'), 'utf8'));
        if (value && typeof value === 'object') {
          const dependencies = new Set<string>();
          for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
            const group: unknown = Reflect.get(value, field);
            if (group && typeof group === 'object') Object.keys(group).forEach(name => dependencies.add(name));
          }
          found.push({ folder, dependencies });
        }
      } catch { /* An invalid manifest cannot establish a framework. */ }
    }
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'dist', 'build', 'vendor'].includes(entry.name)) await visit(path.posix.join(folder, entry.name));
  }
  await visit('');
  return found;
}
function literal(node: Node | undefined): string | undefined {
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralText() : undefined;
}
function joinRoute(...parts: string[]): string { return '/' + parts.map(part => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/'); }
function nextPattern(segments: string[]): string | undefined {
  if (segments.some(segment => segment.startsWith('_') || segment.startsWith('@') || /^\(\./.test(segment))) return;
  return joinRoute(...segments.filter(segment => !/^\(.*\)$/.test(segment)));
}
function basePath(source: SourceFile | undefined): string | undefined {
  if (!source) return '';
  const assignments = source.getExportAssignments();
  let object: Node | undefined = assignments.find(item => !item.isExportEquals())?.getExpression();
  if (!object) {
    const writes = source.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter(expression => {
      const left = expression.getLeft();
      return Node.isPropertyAccessExpression(left) && left.getText() === 'module.exports';
    });
    if (writes.length !== 1) return;
    const write = writes[0];
    const left = write.getLeft();
    if (!Node.isPropertyAccessExpression(left)) return;
    const shadowed = source.getDescendantsOfKind(SyntaxKind.Identifier).some(identifier => {
      if (identifier.getText() !== 'module') return false;
      const parent = identifier.getParent();
      return ((Node.isVariableDeclaration(parent) || Node.isParameterDeclaration(parent) || Node.isFunctionDeclaration(parent) || Node.isClassDeclaration(parent) || Node.isBindingElement(parent)) && parent.getNameNode() === identifier) ||
        (Node.isImportClause(parent) && parent.getDefaultImport() === identifier) ||
        (Node.isImportSpecifier(parent) && (parent.getAliasNode() ?? parent.getNameNode()) === identifier);
    });
    const mutated = source.getDescendantsOfKind(SyntaxKind.BinaryExpression).some(expression => {
      const target = expression.getLeft().getText();
      return target.startsWith('module.exports.') || target.startsWith('module.exports[') || target.startsWith('exports.') || target.startsWith('exports[');
    });
    const otherAccess = source.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).some(access => access.getText() === 'module.exports' && access !== left);
    if (shadowed || mutated || otherAccess || write.getOperatorToken().getKind() !== SyntaxKind.EqualsToken || !Node.isExpressionStatement(write.getParent()) || write.getParent()?.getParent() !== source) return;
    object = write.getRight();
    if (!Node.isObjectLiteralExpression(object)) return;
  }
  if (object && Node.isIdentifier(object)) object = source.getVariableDeclaration(object.getText())?.getInitializer();
  if (!object || !Node.isObjectLiteralExpression(object)) return;
  if (object.getProperties().some(property => Node.isSpreadAssignment(property) || ('getNameNode' in property && Node.isComputedPropertyName(property.getNameNode())))) return;
  const property = object.getProperty('basePath');
  if (!property) return '';
  if (!Node.isPropertyAssignment(property)) return;
  const value = literal(property.getInitializer());
  return value === '' || value?.startsWith('/') ? value : undefined;
}
const verbs = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
export async function analyzeFramework(root: string, graph: ParseResult): Promise<{ graph: ParseResult; metadata: FrameworkMetadata }> {
  const packages = await manifests(root);
  const detection: [FrameworkId, string][] = [['nextjs', 'next'], ['nestjs', '@nestjs/core'], ['react', 'react'], ['express', 'express']];
  const framework = detection.find(([, dependency]) => packages.some(item => item.dependencies.has(dependency)))?.[0] ?? 'none';
  const packageFramework = new Map(packages.map(item => [item, detection.find(([, dependency]) => item.dependencies.has(dependency))?.[0] ?? 'none']));
  const owners = new Map(graph.files.map(file => [file.id, packages.filter(item => !item.folder || file.id.startsWith(item.folder + '/')).sort((a, b) => b.folder.length - a.folder.length)[0]]));
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sources = new Map<string, SourceFile>();
  for (const file of graph.files) sources.set(file.id, project.addSourceFileAtPath(path.join(root, file.id)));
  const configuredNestPackages = new Set(graph.files.filter(file => {
    const owner = owners.get(file.id);
    const text = sources.get(file.id)!.getFullText();
    return owner && packageFramework.get(owner) === 'nestjs' && (/\.(?:setGlobalPrefix|enableVersioning)\s*\(/.test(text) || text.includes('RouterModule.register'));
  }).map(file => owners.get(file.id)));
  const routes: FrameworkRoute[] = [];
  const files = graph.files.map(file => {
    const source = sources.get(file.id)!;
    const owner = owners.get(file.id);
    const framework = owner ? packageFramework.get(owner)! : 'none';
    const relative = owner?.folder ? file.id.slice(owner.folder.length + 1) : file.id;
    const annotated = (framework === 'nextjs' ? nextEntryAdapter : runnerConfigAdapter).annotate({ ...file, id: relative });
    let role = annotated.entryPoint === 'config' ? 'config' : 'generic';
    if (framework === 'nextjs') {
      const appMatch = /^(?:src\/)?app\/(?:(.*)\/)?(page|route)\.[jt]sx?$/.exec(relative);
      const pages = /^(?:src\/)?pages\/(.*)\.[jt]sx?$/.exec(relative);
      const configFile = graph.files.find(item => item.id.startsWith(owner?.folder ? owner.folder + '/' : '') && path.posix.dirname(item.id) === (owner?.folder || '.') && /^next\.config\.[cm]?[jt]s$/.test(path.posix.basename(item.id)));
      const prefix = basePath(configFile ? sources.get(configFile.id) : undefined);
      if (appMatch) {
        const pattern = nextPattern((appMatch[1] ?? '').split('/').filter(Boolean));
        if (pattern !== undefined) {
          role = appMatch[2] === 'page' ? 'page' : 'api';
          if (prefix !== undefined) {
            const methods = role === 'page' ? ['GET'] : [...source.getExportedDeclarations().keys()].filter(name => verbs.has(name));
            methods.forEach(method => routes.push({ file: file.id, method, path: joinRoute(prefix, pattern) }));
          }
        }
      } else if (pages && !/(?:^|\/)(?:_app|_document|_error)$/.test(pages[1])) {
        role = pages[1].startsWith('api/') ? 'api' : 'page';
        if (role === 'page' && prefix !== undefined) routes.push({ file: file.id, method: 'GET', path: joinRoute(prefix, pages[1].replace(/(?:^|\/)index$/, '')) });
      } else if (source.getStatements().some(statement => Node.isExpressionStatement(statement) && literal(statement.getExpression()) === 'use server')) role = 'action';
      else if (/(?:^|\/)hooks\//.test(relative) || /(?:^|\/)use[A-Z][^/]*\.[jt]sx?$/.test(relative)) role = 'hook';
      else if (/(?:^|\/)components\//.test(relative) || /\.[jt]sx$/.test(relative)) role = 'component';
    } else if (framework === 'nestjs') {
      role = /\.(controller|service|module|entity)\.[jt]s$/.exec(relative)?.[1] ?? role;
      if (role === 'controller' && !configuredNestPackages.has(owner)) {
        const imported = new Map<string, string>();
        source.getImportDeclarations().filter(item => item.getModuleSpecifierValue() === '@nestjs/common').forEach(item => item.getNamedImports().forEach(name => imported.set(name.getAliasNode()?.getText() ?? name.getName(), name.getName())));
        for (const controller of source.getClasses()) {
          const decorator = controller.getDecorators().find(item => imported.get(item.getName()) === 'Controller');
          if (!decorator) continue;
          const args = decorator.getArguments();
          const prefix = args.length === 0 ? '' : args.length === 1 ? literal(args[0]) : undefined;
          if (prefix === undefined) continue;
          for (const method of controller.getMethods()) for (const decorator of method.getDecorators()) {
            const verb = imported.get(decorator.getName())?.toUpperCase();
            if (!verb || !verbs.has(verb)) continue;
            const args = decorator.getArguments();
            const route = args.length === 0 ? '' : args.length === 1 ? literal(args[0]) : undefined;
            if (route !== undefined) routes.push({ file: file.id, method: verb, path: joinRoute(prefix, route) });
          }
        }
      }
    } else if (framework === 'react') {
      if (/(?:^|\/)hooks\//.test(relative) || /(?:^|\/)use[A-Z][^/]*\.[jt]sx?$/.test(relative)) role = 'hook';
      else if (/\.[jt]sx$/.test(relative) || /(?:^|\/)components\//.test(relative)) role = 'component';
    } else if (framework === 'express') {
      const directoryRoles = [
        ['controller', 'controllers', 'controller'], ['service', 'services', 'service'],
        ['route', 'routes', 'route'], ['middleware', 'middlewares', 'middleware'],
        ['model', 'models', 'model'], ['repository', 'repositories', 'repository'],
        ['util', 'utils', 'util'], ['config', 'configs', 'config'],
      ];
      const folders = relative.split('/').slice(0, -1);
      const match = directoryRoles.find(([singular, plural]) => folders.includes(singular) || folders.includes(plural));
      if (match) role = match[2];
    }
    return { ...file, annotations: { ...annotated, role } };
  });
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.file.localeCompare(b.file));
  return { graph: { ...graph, files }, metadata: { framework, routes } };
}
