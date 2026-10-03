import Link from 'next/link';
import { RepositoryIntentForm } from './repository-intent-form';
import './landing.css';

function GraphDrawing({ trace = false }: { trace?: boolean }) {
  const marker = trace ? 'landing-trace-arrow' : 'landing-graph-arrow';
  const groups = [
    { x: 22, y: 76, rows: 4 }, { x: 190, y: 26, rows: 3 },
    { x: 190, y: 228, rows: 4 }, { x: 358, y: 106, rows: 5 },
  ];
  return <svg className={`landing-drawing ${trace ? 'landing-trace-drawing' : ''}`} viewBox="0 0 500 410" aria-hidden="true" focusable="false">
    <defs><marker id={marker} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="none" stroke="var(--muted)" strokeWidth="1" /></marker></defs>
    <g fill="none" stroke="var(--muted)" strokeWidth="1" opacity=".55" markerEnd={`url(#${marker})`}>
      <path d="M138 118 C165 118 164 72 190 72" /><path d="M138 164 C167 164 158 274 190 274" />
      <path d="M306 72 C340 72 325 152 358 152" /><path d="M306 274 C335 274 330 198 358 198" />
      <path d="M248 165 L248 228" /><path d="M358 244 C322 244 328 320 306 320" />
    </g>
    {trace && <g fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M138 118 C165 118 164 72 190 72" /><path d="M306 72 C340 72 325 152 358 152" /></g>}
    {groups.map((group, index) => <g key={index}>
      <rect x={group.x} y={group.y} width="116" height={46 + group.rows * 24} rx="4" fill="var(--panel)" stroke={trace && index < 2 ? 'var(--accent)' : 'var(--border)'} />
      <path d={`M${group.x} ${group.y + 32} H${group.x + 116}`} stroke="var(--border)" />
      <path d={`M${group.x + 13} ${group.y + 15} h7 l3 3 h10 v8 h-20 z`} fill="none" stroke="var(--muted)" />
      {Array.from({ length: group.rows }, (_, row) => <g key={row}>
        <rect x={group.x + 13} y={group.y + 43 + row * 24} width="5" height="5" rx="1" fill={index === 1 ? 'var(--accent)' : 'var(--muted)'} />
        <path d={`M${group.x + 26} ${group.y + 46 + row * 24} h${38 + ((index + row) % 3) * 12}`} stroke="var(--border)" strokeWidth="3" strokeLinecap="round" />
      </g>)}
    </g>)}
  </svg>;
}

function ParseDrawing() {
  return <svg className="landing-drawing landing-parse-drawing" viewBox="0 0 500 350" aria-hidden="true" focusable="false">
    <g fill="var(--panel)" stroke="var(--border)">
      <rect x="20" y="93" width="112" height="164" rx="4" /><path d="M104 93 v28 h28" fill="var(--background)" />
      <rect x="207" y="122" width="84" height="112" rx="4" />
      <rect x="367" y="73" width="111" height="68" rx="4" /><rect x="367" y="175" width="111" height="68" rx="4" />
    </g>
    <g stroke="var(--border)" strokeWidth="3" strokeLinecap="round">
      <path d="M36 139 h56 M36 157 h72 M36 175 h43 M36 193 h62 M36 211 h48 M36 229 h67" />
      <path d="M381 91 h62 M381 108 h80 M381 125 h43 M381 193 h79 M381 210 h49 M381 227 h69" />
    </g>
    <g fill="none" stroke="var(--muted)" strokeWidth="1"><path d="M132 175 H207 M291 175 H326 V107 H367 M326 175 V209 H367" /><path d="M199 171 l8 4 l-8 4 M359 103 l8 4 l-8 4 M359 205 l8 4 l-8 4" /></g>
    <g fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M226 159 l-9 9 l9 9 M272 159 l9 9 l-9 9 M253 151 l-8 36" /></g>
    <g fill="var(--muted)"><circle cx="231" cy="210" r="2" /><circle cx="249" cy="210" r="2" /><circle cx="267" cy="210" r="2" /></g>
  </svg>;
}

export function LandingPage() {
  return <main className="landing-page">
    <div className="landing-column">
      <section className="landing-hero landing-split" aria-labelledby="landing-title">
        <div className="landing-copy">
          <h1 id="landing-title">See how your code connects.</h1>
          <p className="landing-lead">Map the imports in a public TypeScript or JavaScript repository. Explore the files and follow their dependencies.</p>
          <RepositoryIntentForm />
          <p className="landing-form-note">Start with a public GitHub repository. Sign in to save the analysis to your team.</p>
        </div>
        <GraphDrawing />
      </section>
      <section className="landing-section landing-split" aria-labelledby="landing-explore">
        <div className="landing-copy">
          <h2 id="landing-explore">Follow a file through the repository.</h2>
          <p>Open a folder, select a file, and see what it imports and which files import it. Trace its dependency chain or explore the dependents in its import blast radius.</p>
          <p>Connect your local ChatGPT account separately to explain a selection or ask questions. In Ask, each answer looks up the parsed graph, with its tool calls visible as it works.</p>
        </div>
        <GraphDrawing trace />
      </section>
      <section className="landing-section landing-split" aria-labelledby="landing-process">
        <div className="landing-copy">
          <h2 id="landing-process">From source files to a map.</h2>
          <dl className="landing-process-list">
            <div><dt>Fetch the current commit</dt><dd>The analysis records the commit it read from the public repository.</dd></div>
            <div><dt>Parse the imports</dt><dd>Source files establish the connections. An unresolved import stays unresolved.</dd></div>
            <div><dt>Explore the structure</dt><dd>Follow observed dependencies, inspect roles and routes, and see what was skipped.</dd></div>
          </dl>
        </div>
        <ParseDrawing />
      </section>
      <section className="landing-section" aria-labelledby="landing-frameworks">
        <h2 id="landing-frameworks">The framework gives the map context.</h2>
        <p className="landing-wide-copy">Cartograph recognizes framework structure in TypeScript and JavaScript repositories. Roles and recoverable routes sit alongside the import graph.</p>
        <ul className="landing-frameworks" aria-label="Supported frameworks"><li>Next.js</li><li>NestJS</li><li>React</li><li>Express</li></ul>
        <p className="landing-wide-copy landing-secondary">Routes appear when their method and full pattern can be recovered exactly. Coverage makes unresolved imports and skipped files visible.</p>
      </section>
      <section className="landing-section landing-limits" aria-labelledby="landing-limits">
        <h2 id="landing-limits">The boundaries stay visible.</h2>
        <p className="landing-wide-copy">Cartograph explains observed structure. It does not grade your code, invent connections, or execute repository code.</p>
        <ul className="landing-limit-list"><li>Import dependents show a structural blast radius. They do not predict runtime failures.</li><li>Skipped files and unresolved imports remain part of the coverage report.</li><li>The graph cannot answer everything. Source behavior and code quality are outside its evidence.</li></ul>
      </section>
      <footer className="landing-footer"><p>Cartograph · A dependency map of your codebase.</p><Link href="/sign-in" prefetch={false}>Sign in</Link></footer>
    </div>
  </main>;
}
