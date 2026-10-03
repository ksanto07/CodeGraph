import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { Node, Project, SymbolFlags, SyntaxKind, ts } from 'ts-morph';
import { projectGraph, summarize } from './graph.ts';
import { noFrameworkAdapter } from './types.ts';
import type { FrameworkAdapter, ConfigDiagnostic, ExcludedDirectory, FileNode, ImportCoverage, ImportKind, ImportOutcome, ParseResult, SkippedFile } from './types.ts';

const supported = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const pruned = new Set(['.git', '.hg', '.svn', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo']);
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const normalize = (value: string) => value.split(path.sep).join('/');
const inside = (root: string, target: string) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const diagnosticText = (diagnostic: ts.Diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
const bindingDeclaration = (node: Node) => Node.isVariableDeclaration(node) || Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isClassDeclaration(node) || Node.isClassExpression(node) || Node.isEnumDeclaration(node) || Node.isModuleDeclaration(node) || Node.isImportEqualsDeclaration(node) || Node.isNamespaceImport(node) || Node.isParameterDeclaration(node) || Node.isImportSpecifier(node) || Node.isImportClause(node) || Node.isBindingElement(node);

export interface ParserLimits { sourceFiles?: number; imports?: number; }

export async function parseRepository(input: string, adapter: FrameworkAdapter = noFrameworkAdapter, limits: ParserLimits = {}): Promise<ParseResult> {
  for (const limit of Object.values(limits)) if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error('Parser limits must be non-negative safe integers.');
  let selectedSources = 0;
  const root = await realpath(path.resolve(input));
  if (!(await stat(root)).isDirectory()) throw new Error(`Not a directory: ${input}`);
  const paths: string[] = [];
  const skipped: SkippedFile[] = [];
  const excludedDirectories: ExcludedDirectory[] = [];
  const configDiagnostics: ConfigDiagnostic[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalize(path.relative(root, absolute));
      if (entry.isSymbolicLink()) { skipped.push({ path: relative, reason: 'symlink', detail: 'Symbolic links are not followed.' }); continue; }
      if (entry.isDirectory()) {
        if (pruned.has(entry.name)) excludedDirectories.push({ path: relative, reason: 'generated, dependency, or version-control directory' });
        else await walk(absolute);
      } else if (entry.isFile()) {
        if (supported.has(path.extname(relative).toLowerCase()) && ++selectedSources > (limits.sourceFiles ?? Infinity)) throw new Error(`Repository exceeds source file limit (${limits.sourceFiles}).`);
        paths.push(absolute);
      }
    }
  }
  await walk(root);
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true } });
  const files: FileNode[] = [];
  const sources = new Map<string, ReturnType<Project['createSourceFile']>>();
  for (const absolute of paths) {
    const id = normalize(path.relative(root, absolute));
    if (!supported.has(path.extname(id).toLowerCase())) { skipped.push({ path: id, reason: 'unsupported-extension', detail: 'Only TypeScript and JavaScript source files are parsed.' }); continue; }
    try {
      const bytes = await readFile(absolute);
      if (bytes.includes(0)) { skipped.push({ path: id, reason: 'binary', detail: 'Source contains a NUL byte.' }); continue; }
      const source = project.createSourceFile(absolute, bytes.toString('utf8'));
      files.push({ id, folder: path.posix.dirname(id), lines: source.getFullText() === '' ? 0 : source.getFullText().split(/\r\n|\r|\n/).length, sha256: createHash('sha256').update(bytes).digest('hex'), moduleKind: ts.isExternalModule(source.compilerNode) ? 'module' : 'script', fanIn: 0, fanOut: 0, annotations: {} });
      sources.set(absolute, source);
    } catch (error) { skipped.push({ path: id, reason: 'unreadable', detail: error instanceof Error ? error.message : String(error) }); }
  }
  const program = project.getProgram().compilerObject;
  for (const [absolute, source] of sources) {
    const diagnostics = program.getSyntacticDiagnostics(source.compilerNode);
    if (!diagnostics.length) continue;
    const id = normalize(path.relative(root, absolute));
    skipped.push({ path: id, reason: 'parse-error', detail: diagnostics.map(diagnosticText).join('; ') });
    sources.delete(absolute);
    files.splice(files.findIndex(file => file.id === id), 1);
  }
  const nodes = new Set(files.map(file => file.id));
  const optionsCache = new Map<string, ts.CompilerOptions>();
  function optionsFor(absolute: string): ts.CompilerOptions {
    let directory = path.dirname(absolute);
    while (true) {
      const cached = optionsCache.get(directory);
      if (cached) return cached;
      const config = ['tsconfig.json', 'jsconfig.json'].map(name => path.join(directory, name)).find(file => ts.sys.fileExists(file));
      if (config) {
        const loaded = ts.readConfigFile(config, ts.sys.readFile);
        if (loaded.error) throw new Error(`Cannot read ${config}: ${diagnosticText(loaded.error)}`);
        const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, directory, undefined, config);
        for (const error of parsed.errors) configDiagnostics.push({ path: normalize(path.relative(root, config)), code: error.code, message: diagnosticText(error) });
        optionsCache.set(directory, parsed.options);
        return parsed.options;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    return { allowJs: true, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 };
  }
  const coverage: ImportCoverage[] = [];
  function checkImportLimit(): void {
    if (coverage.length >= (limits.imports ?? Infinity)) throw new Error(`Repository exceeds import limit (${limits.imports}).`);
  }
  for (const [absolute, source] of sources) {
    const sourceId = normalize(path.relative(root, absolute));
    const options = optionsFor(absolute);
    source.compilerNode.impliedNodeFormat = ts.getImpliedNodeFormatForFile(absolute, undefined, ts.sys, options);
    async function resolve(specifier: string, literal: ts.StringLiteralLike, kind: ImportKind): Promise<ImportOutcome> {
      if (builtins.has(specifier)) return { kind: 'outside', target: specifier, reason: 'Node built-in module' };
      try {
        const mode = kind === 'require' ? ts.ModuleKind.CommonJS : ts.getModeForUsageLocation(source.compilerNode, literal, options);
        const resolution = ts.resolveModuleName(specifier, absolute, options, ts.sys, undefined, undefined, mode).resolvedModule;
        const exactTarget = specifier.startsWith('.') || path.isAbsolute(specifier) ? path.resolve(path.dirname(absolute), specifier) : undefined;
        const excludedTarget = exactTarget && !supported.has(path.extname(exactTarget).toLowerCase()) && ts.sys.fileExists(exactTarget) ? exactTarget : undefined;
        const resolvedFilename = resolution?.resolvedFileName ?? excludedTarget;
        if (!resolvedFilename) {
          const alias = Object.keys(options.paths ?? {}).some(pattern => {
            const wildcard = pattern.indexOf('*');
            return wildcard === -1 ? pattern === specifier : specifier.startsWith(pattern.slice(0, wildcard)) && specifier.endsWith(pattern.slice(wildcard + 1));
          });
          return { kind: 'unresolved', reason: specifier.startsWith('.') || path.isAbsolute(specifier) || alias ? 'missing-file' : 'missing-package', detail: `TypeScript could not resolve ${specifier} from ${sourceId}.${alias ? ' The specifier matches a configured path alias.' : ''}` };
        }
        const target = await realpath(resolvedFilename);
        if (target.split(path.sep).includes('node_modules')) return { kind: 'outside', target: normalize(target), reason: 'Dependency file in node_modules' };
        if (!inside(root, target)) return { kind: 'outside', target: normalize(target), reason: 'Resolved file is outside the repository' };
        const id = normalize(path.relative(root, target));
        if (nodes.has(id)) return { kind: 'resolved', target: id };
        const skip = skipped.find(item => item.path === id);
        const exclusion = excludedDirectories.find(item => id.startsWith(`${item.path}/`));
        return { kind: 'excluded', target: id, reason: skip ? `${skip.reason}: ${skip.detail}` : exclusion?.reason ?? 'Resolved file was not selected by the structural scan' };
      } catch (error) { return { kind: 'unresolved', reason: 'resolver-error', detail: error instanceof Error ? error.message : String(error) }; }
    }
    async function add(kind: ImportKind, literal: ReturnType<typeof source.getImportDeclarations>[number]['compilerNode']['moduleSpecifier']): Promise<void> {
      checkImportLimit();
      const location = source.getLineAndColumnAtPos(literal.getStart(source.compilerNode));
      const specifier = ts.isStringLiteralLike(literal) ? literal.text : literal.getText(source.compilerNode);
      coverage.push({ source: sourceId, kind, specifier, ...location, outcome: ts.isStringLiteralLike(literal) ? await resolve(specifier, literal, kind) : { kind: 'unresolved', reason: 'non-literal', detail: `${kind === 'require' ? 'Require' : 'Dynamic import'} argument is not a string literal.` } });
    }
    for (const declaration of source.getDescendantsOfKind(SyntaxKind.ImportDeclaration)) await add('import', declaration.compilerNode.moduleSpecifier);
    for (const declaration of source.getDescendantsOfKind(SyntaxKind.ExportDeclaration)) if (declaration.compilerNode.moduleSpecifier) await add('re-export', declaration.compilerNode.moduleSpecifier);
    for (const declaration of source.getDescendantsOfKind(SyntaxKind.ImportType)) {
      const argument = declaration.compilerNode.argument;
      if (ts.isLiteralTypeNode(argument)) await add('import', argument.literal);
    }
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      const commonjs = Node.isIdentifier(expression) && expression.getText() === 'require' && !expression.getSymbol()?.getDeclarations().some(declaration => bindingDeclaration(declaration) && declaration.getSourceFile() === source && !source.isDeclarationFile());
      if (expression.getKind() !== SyntaxKind.ImportKeyword && !commonjs) continue;
      const kind = commonjs ? 'require' : 'dynamic-import';
      const argument = call.getArguments()[0];
      if (argument && Node.isExpression(argument)) await add(kind, argument.compilerNode);
      else {
        checkImportLimit();
        coverage.push({ source: sourceId, kind, specifier: '', ...source.getLineAndColumnAtPos(call.getStart()), outcome: { kind: 'unresolved', reason: 'non-literal', detail: `${commonjs ? 'Require' : 'Dynamic import'} has no argument.` } });
      }
    }
    const exportNames = new Set([...source.getExportedDeclarations()].filter(([, declarations]) => declarations.some(declaration => (!Node.isPropertyAccessExpression(declaration) && !Node.isElementAccessExpression(declaration)) || declaration.getFirstAncestorByKind(SyntaxKind.ExportAssignment))).map(([name]) => name));
    const commonjsNames = new Set<string>();
    let exportsAttached = true;
    let uncertainExports = false;
    function staticProperty(node: Node): string | undefined {
      if (Node.isPropertyAccessExpression(node)) return node.getName();
      if (Node.isElementAccessExpression(node)) {
        const name = node.getArgumentExpression();
        if (name && (Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name))) return name.getLiteralValue();
      }
    }
    function globalIdentifier(node: Node, name: string): boolean {
      return Node.isIdentifier(node) && node.getText() === name && !node.getSymbolsInScope(SymbolFlags.Value | SymbolFlags.Alias).some(symbol => symbol.getName() === name && symbol.getDeclarations().some(declaration => bindingDeclaration(declaration) && declaration.getSourceFile() === source && !source.isDeclarationFile()));
    }
    function moduleExports(node: Node): boolean {
      return (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) && staticProperty(node) === 'exports' && globalIdentifier(node.getExpression(), 'module');
    }
    for (const expression of source.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
      const left = expression.getLeft();
      const owner = Node.isPropertyAccessExpression(left) || Node.isElementAccessExpression(left) ? left.getExpression() : undefined;
      const replacesModule = moduleExports(left);
      const replacesAlias = globalIdentifier(left, 'exports');
      const writesModule = owner && moduleExports(owner);
      const writesAlias = owner && globalIdentifier(owner, 'exports');
      if (!replacesModule && !replacesAlias && !writesModule && !writesAlias) continue;
      const statement = expression.getParent();
      if (!Node.isExpressionStatement(statement) || statement.getParent() !== source) {
        uncertainExports = true;
        continue;
      }
      if (replacesAlias) { exportsAttached = moduleExports(expression.getRight()); continue; }
      if (replacesModule) {
        commonjsNames.clear();
        exportsAttached = false;
        const right = expression.getRight();
        if (Node.isObjectLiteralExpression(right)) for (const property of right.getProperties()) {
          if (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property) || Node.isMethodDeclaration(property)) {
            const name = property.getNameNode();
            if (Node.isIdentifier(name)) commonjsNames.add(name.getText());
            else if (Node.isStringLiteral(name) || Node.isNumericLiteral(name)) commonjsNames.add(String(name.getLiteralValue()));
          }
        }
        else commonjsNames.add('default');
      } else if (writesModule || (writesAlias && exportsAttached)) {
        const name = staticProperty(left);
        if (name !== undefined) commonjsNames.add(name);
      }
    }
    if (!uncertainExports) for (const name of commonjsNames) exportNames.add(name);
    const file = files.find(file => file.id === sourceId)!;
    file.exportNames = [...exportNames].sort();
    if (exportNames.size) file.moduleKind = 'module';
  }
  coverage.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line || a.column - b.column);
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  files.sort((a, b) => a.id.localeCompare(b.id));
  excludedDirectories.sort((a, b) => a.path.localeCompare(b.path));
  configDiagnostics.sort((a, b) => a.path.localeCompare(b.path) || a.code - b.code || a.message.localeCompare(b.message));
  const graph = projectGraph(files, coverage);
  graph.files = graph.files.map(file => ({ ...file, annotations: adapter.annotate(file) }));
  return { schemaVersion: 1, root: normalize(root), ...graph, coverage, skipped, excludedDirectories, configDiagnostics, summary: summarize(graph.files, skipped, coverage) };
}
