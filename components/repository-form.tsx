'use client';

import { useActionState } from 'react';
import { analyzeRepository } from '@/app/(workspace)/analyses/actions';

export function RepositoryForm({ defaultValue = '' }: { defaultValue?: string }) {
  const [state, action, pending] = useActionState(analyzeRepository, null);
  return <form action={action} className="repository-form">
    <label htmlFor="repository">Public GitHub repository</label>
    <div><input id="repository" name="repository" type="url" required placeholder="https://github.com/owner/repository" defaultValue={defaultValue} /><button type="submit" disabled={pending}>{pending ? 'Starting…' : 'Analyze repository'}</button></div>
    {state?.error && <p role="alert" className="pipeline-error">{state.error}</p>}
  </form>;
}
