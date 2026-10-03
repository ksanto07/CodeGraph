'use client';

import { useEffect, useRef, useState } from 'react';
import type { Selection } from '@/lib/canvas/model';
import { readChatEvents } from '@/lib/agent/chat-client';
import { ExplanationProse } from './explanation-prose';

interface Props { analysisId: string; active: boolean; selection: Selection; paths: readonly string[]; selectFile: (id: string) => void }
interface ToolActivity { name: string; status: 'running' | 'done' }
interface Turn { id: number; question: string; selection: Selection; body: string; tools: ToolActivity[]; status: 'running' | 'done' | 'stopped' | 'error'; error?: string }
const labels: Record<string, string> = { analysis_summary: 'Analysis summary', search_files: 'Search files', files_by_role: 'Files by role', neighbors: 'Direct neighbours', walk: 'Transitive walk', routes: 'Route table' };

export function ChatPane({ analysisId, active, selection, paths, selectFile }: Props) {
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const thread = useRef<string | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!active) request.current?.abort();
    return () => { request.current?.abort(); };
  }, [active, analysisId]);
  useEffect(() => { if (active && follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [turns, active]);
  const change = (id: number, update: (turn: Turn) => Turn) => setTurns(previous => previous.map(turn => turn.id === id ? update(turn) : turn));
  const ask = async (question: string) => {
    question = question.trim();
    if (!question || request.current || !active) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setDraft(''); follow.current = true;
    const id = ++sequence.current;
    const selected = selection ? { ...selection } : null;
    setTurns(previous => [...previous, { id, question, selection: selected, body: '', tools: [], status: 'running' }]);
    let done = false;
    let length = 0;
    try {
      const response = await fetch('/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis: analysisId, ...(thread.current ? { thread: thread.current } : {}), message: question, ...(selected ? { selection: selected } : {}) }), signal: controller.signal });
      if (!response.ok || !response.body) {
        const value: unknown = await response.json().catch(() => null);
        throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'The agent is unavailable. Start its local service, then retry.');
      }
      for await (const event of readChatEvents(response.body, controller.signal)) {
        if (request.current !== controller) return;
        if (event.type === 'thread') thread.current = event.thread;
        if (event.type === 'text') {
          length += event.text.length;
          if (length > 1_000_000) throw new Error('The answer is too large. Ask a narrower question.');
          change(id, turn => ({ ...turn, body: turn.body + event.text }));
        }
        if (event.type === 'tool') change(id, turn => {
          const tools = [...turn.tools];
          const pending = tools.findLastIndex(tool => tool.name === event.name && tool.status === 'running');
          if (event.status === 'done' && pending >= 0) tools[pending] = { name: event.name, status: 'done' };
          else tools.push({ name: event.name, status: event.status });
          return { ...turn, tools };
        });
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'done') { done = true; change(id, turn => ({ ...turn, status: 'done' })); }
      }
      if (!done) throw new Error('The connection ended before the answer finished. Retry or start a new conversation.');
    } catch (error) {
      if (request.current !== controller) return;
      change(id, turn => ({ ...turn, status: controller.signal.aborted ? 'stopped' : 'error',
        ...(controller.signal.aborted ? {} : { error: error instanceof Error ? error.message : 'The question could not complete. Retry or start a new conversation.' }) }));
    } finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  const reset = () => {
    request.current?.abort(); request.current = null; thread.current = undefined;
    setBusy(false); setTurns([]); setDraft(''); follow.current = true; composer.current?.focus();
  };
  return <section className="chat-pane" aria-label="Ask this repository" hidden={!active}>
    <div className="chat-toolbar"><h2>Ask the repository</h2><button onClick={reset} title="Start a new conversation">New conversation</button></div>
    <div className="chat-transcript" ref={transcript} onScroll={event => { const element = event.currentTarget; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48; }}>
      {!turns.length && <div className="chat-empty"><p>Ask about files, imports, roles, or routes.</p><p className="detail-empty">Each answer looks up the parsed graph. Select a file or folder to include it in your question.</p><button onClick={() => setDraft('Where is authentication handled?')}>Where is authentication handled?</button><button onClick={() => setDraft('Which files have the most dependents?')}>Which files have the most dependents?</button></div>}
      {turns.map(turn => <article className="chat-turn" key={turn.id} aria-label="Question and answer">
        <div className="chat-question"><p>{turn.question}</p>{turn.selection && <small title={turn.selection.id}>{turn.selection.id}</small>}</div>
        {turn.tools.length > 0 && <ol className="chat-tools" aria-label="Graph lookups">{turn.tools.map((tool, index) => <li key={index}><span className={`chat-tool-mark ${tool.status}`} aria-hidden="true">{tool.status === 'done' ? '✓' : '·'}</span><span>{labels[tool.name]}</span><small>{tool.status === 'done' ? 'Done' : turn.status === 'running' ? 'Looking up…' : 'Interrupted'}</small></li>)}</ol>}
        {turn.body && <ExplanationProse body={turn.body} paths={paths} selectFile={selectFile} />}
        {turn.status === 'running' && <p className="chat-progress" role="status">{turn.tools.length ? 'Reading graph results…' : 'Starting graph lookup…'}</p>}
        {turn.status === 'stopped' && <p className="chat-progress" role="status">Stopped. Ask again to continue.</p>}
        {turn.error && <div className="chat-error" role="alert"><p>{turn.error}</p><button disabled={busy} onClick={() => void ask(turn.question)}>Retry question</button><button onClick={reset}>New conversation</button></div>}
      </article>)}
    </div>
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); void ask(draft); }}>
      <p className="chat-selection">{selection ? <><span>Selected {selection.kind}</span><code title={selection.id}>{selection.id}</code></> : 'Whole repository'}</p>
      <label className="chat-input-label" htmlFor={`question-${analysisId}`}>Your question</label>
      <textarea id={`question-${analysisId}`} ref={composer} value={draft} maxLength={4000} rows={3} placeholder="Ask about this repository…" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(draft); } }} />
      <div className="chat-composer-actions"><small>Enter to ask · Shift + Enter for a new line</small>{busy ? <button type="button" onClick={() => request.current?.abort()}>Stop</button> : <button type="submit" disabled={!draft.trim()}>Ask</button>}</div>
    </form>
  </section>;
}
