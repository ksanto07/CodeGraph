# Parse a local repository

Run the parser with Node.js 24 and the project's installed dependencies.

```sh
pnpm parse-repo /absolute/path/to/repository --out /tmp/repository.graph.json
```

The command prints file counts, exact folder counts, edge counts, and coverage outcomes. It lists every skipped file and excluded directory. It prints up to 20 unresolved examples and every re-export that did not resolve inside the graph. Configuration diagnostics appear with their file path and TypeScript diagnostic code.

Read saved data through `readParseResult` from `lib/parser/result-file.ts`. The reader checks schema version 1, field types, normalized paths, graph endpoints, coverage, distinct-neighbor degrees, and summary totals. Invalid data throws an error. `writeParseResult` applies the same validation before writing.

The parser keeps whole directories of TypeScript and JavaScript sources. Each file receives its exact containing directory, a SHA-256 hash of its bytes, a line count, and its module or script classification. The fallback adapter returns an empty annotations map for each node. The adapter hook can attach string annotations without changing edges. An empty file has zero lines. A trailing newline creates a final empty line.

The scan excludes directories named `.git`, `.hg`, `.svn`, `node_modules`, `.next`, `dist`, `build`, `coverage`, and `.turbo`. Their descendants are outside the files-found count. Symlinks are reported as skipped and never followed. Other regular files either become graph nodes or appear with a skip reason.

Each source uses its nearest ancestor `tsconfig.json` or `jsconfig.json`, including inherited compiler options. Configuration include and exclude lists do not restrict structural selection. Invalid configuration syntax fails the command. TypeScript option diagnostics remain visible in the result. Files without a configuration use Node-style resolution.

Static imports, imports in type expressions and ambient declarations, re-exports, and literal dynamic imports create edges only when TypeScript resolves their targets to graph nodes. No-substitution template literals count as literal imports. Nonliteral dynamic imports remain unresolved coverage. Node built-ins and resolved dependency files in `node_modules` are outside the graph. Exact relative paths to existing unsupported files, such as CSS, are excluded. Missing packages remain unresolved. `require()` is outside this phase.

Node may print `MODULE_TYPELESS_PACKAGE_JSON` when it detects the scripts' module syntax. The warning does not stop the command.

Run the deterministic fixture check before handoff.

```sh
pnpm verify-parser
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

The fixture checks structural selection, nested aliases, conditional package exports, ambient imports, repeated imports, distinct-neighbor degrees, outside and excluded targets, hash and line values, skipped sources, a target rename, and validated JSON round-trip. It needs no test runner, browser, network, database, or web server.
