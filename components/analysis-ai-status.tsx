'use client';

import { useActionState } from 'react';
import { connectChatGPT, disconnectChatGPT } from '@/app/(workspace)/analyses/ai-actions';
import type { AIAvailability } from '@/lib/ai/service';

export function AnalysisAIStatus({ ai }: { ai: AIAvailability }) {
  const [connection, connect, connecting] = useActionState(connectChatGPT, { error: null });
  const [disconnection, disconnect, disconnecting] = useActionState(disconnectChatGPT, { error: null });
  const status = ai.connectionStatus;
  const owned = status?.authorized;
  const available = owned && status?.status === 'connected' && status.sharing;
  const identity = owned ? status.identity?.email ?? status.identity?.name : undefined;
  const error = connection.error ?? disconnection.error;
  return <section className="analysis-ai-status" aria-label="AI connection">
    <p>{available ? `ChatGPT connected${identity ? ` as ${identity}` : ''}` : status?.status === 'reauth_required' && owned ? 'ChatGPT needs to reconnect.' : status?.status === 'connected' && !owned ? 'This ChatGPT connection belongs to another application user.' : 'ChatGPT is not connected.'}</p>
    {status && (!owned && status.status !== 'disconnected' ? null : <form action={connect}><button disabled={connecting || disconnecting}>{connecting ? 'Complete sign-in in your browser…' : available ? 'Reconnect ChatGPT' : 'Sign in with ChatGPT'}</button></form>)}
    {owned && <form action={disconnect}><button disabled={connecting || disconnecting}>{disconnecting ? 'Disconnecting…' : 'Disconnect ChatGPT'}</button></form>}
    {owned && <a href={status.usageURL} target="_blank" rel="noreferrer">ChatGPT plan usage</a>}
    <p className="ai-status-note">{available ? 'Calls use this account’s ChatGPT allowance.' : status ? 'Sign-in opens your system browser. Grant plan usage to explain this map.' : 'Open Cartograph locally to connect ChatGPT.'}</p>
    <p className="ai-status-note">{ai.explanationModel ? `Explanation model ${ai.explanationModel}.` : 'Explanation model not selected.'} {ai.classificationModel ? `Role model ${ai.classificationModel}.` : 'Role model not selected.'} {ai.tracing ? 'AI tracing enabled.' : 'AI tracing unavailable. Calls can still work.'}</p>
    {ai.messages.filter(message => !message.includes('CARTOGRAPH_') && !message.startsWith('AI tracing') && !message.includes('loopback')).map(message => <p key={message} className="ai-status-error">{message}</p>)}
    {error && <p className="ai-status-error" role="alert">{error}</p>}
  </section>;
}
