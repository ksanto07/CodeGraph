# Check the canvas preview

Run `pnpm dev`, then open `/preview`. The preview uses the checked-in parser result and needs no login, database, or external service request.

1. Click a folder. Check that its header shows the file count and external fan-in and fan-out.
2. Select a file row. Check that its incoming edges are green and outgoing edges are amber, with unrelated files and edges dimmed.
3. Clear the selection with the button, Escape, or a click on empty canvas. Check that all folders and edges regain their normal emphasis.
4. Scroll a panel with more than twelve files. Check that hidden connections use the count row and visible connections follow their file rows.
5. Click the header again to close the panel.
6. Open several folders. Check that the view fits the graph after each panel opens and never zooms in.
7. Check that the category rail, canvas, and empty details column stay in place.

Run `pnpm verify-canvas` for the terminal checks. The fixture has 255 parsed files, 89 source folders, and 491 distinct resolved edges. Folding produces 24 nodes at threshold 5, with 2 to 29 files per node and 10.625 files per node on average. Every file occurs once and every edge has existing endpoints. The collapsed layout measures 786 by 596 canvas units and fits the 876 by 720 desktop canvas at zoom 0.997. The requested browser interactions were verified in the production preview at a 798 by 925 browser viewport: folder expansion, file selection with both edge colors, scrolling the 29-file hooks folder, zoom in and out, dragging empty space to pan, and clearing selection by clicking empty space. Scrolling moved the folder to its lower rows without changing the map transform. Initial fitting and expansion refitting were also verified after fixing panel pointer events and checking measured dimensions directly.

Types, lint, and the canvas checks pass. `pnpm build --webpack` passes. The default Turbopack build encountered an operating-system restriction while binding its worker process port in the agent environment. A production HTTP check returned 200 for `/preview` with Clerk and Supabase settings empty. Browser interaction checks were run separately at the user’s explicit request.

To regenerate the fixture, clone the public [xyflow repository](https://github.com/xyflow/xyflow), check out commit `3d35b57317576b0916c0bfeaaedd573aaacc2839`, and run the existing parser against its `packages` directory.

```sh
pnpm parse-repo /absolute/path/to/xyflow/packages --out lib/canvas/fixture.json
pnpm verify-canvas
```

Keep the parser JSON unchanged. The typed server wrapper validates its contract before rendering the preview. The repository source is MIT licensed. The fixture contains file paths, hashes, line counts, and parser metadata, without source text.

The parser finds 334 candidate files and skips 79. Import coverage records 492 resolved occurrences, 399 unresolved occurrences, 40 excluded occurrences, and 1 outside occurrence. The result retains 3 configuration diagnostics and all reasons for skipped and unresolved imports. Package workspace imports remain unresolved when dependencies are absent in the source checkout. The canvas derives no edge from those imports.

The layout condenses import cycles before Dagre places dependency layers from left to right. Folders in a dependency cycle remain separate nodes inside a compact layout box. Disconnected islands can share unused canvas space because no parser edge crosses between them. These boxes are layout calculations, not extra canvas nodes.

Panels keep an opaque background when selection dims their labels, so edges stay behind them. Selected incoming edges are green and outgoing edges are amber. The verification script checks component direction and panel separation with all folders closed, one open, and all open.
