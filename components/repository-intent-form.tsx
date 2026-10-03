'use client';

import { useActionState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { beginRepository, resumeRepository } from '@/app/actions';

export function RepositoryIntentForm() {
  const [state, action, pending] = useActionState(beginRepository, null);
  return <form action={action} className="repository-form">
    <label htmlFor="public-repository">Public GitHub repository</label>
    <div><input id="public-repository" name="repository" type="url" maxLength={2048} required placeholder="https://github.com/owner/repository" /><button type="submit" disabled={pending}>{pending ? 'Continuing…' : 'Analyze repository'}</button></div>
    {state?.error && <p role="alert" className="pipeline-error">{state.error}</p>}
  </form>;
}

export function ResumeRepository({ nonce, repository }: { nonce: string; repository: string }) {
  const [state, action, pending] = useActionState(resumeRepository, null);
  const form = useRef<HTMLFormElement>(null);
  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; form.current?.requestSubmit(); } }, []);
  return <main className="auth-page"><section className="repository-continuation">
    <h1>{state?.error ? 'Analysis could not start' : 'Starting your analysis'}</h1>
    <p><code>{repository}</code></p>
    <form ref={form} action={action}>
      <input type="hidden" name="intent" value={nonce} />
      <button type="submit" disabled={pending}>{pending ? 'Starting…' : state?.error ? 'Try again' : 'Analyze repository'}</button>
    </form>
    {state?.error && <p role="alert" className="pipeline-error">{state.error}</p>}
    <Link href="/">Back to workspace</Link>
  </section></main>;
}
