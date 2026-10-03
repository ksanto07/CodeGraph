import 'server-only';
import { headers } from 'next/headers';
import { LocalChatGPTError } from './local-auth';

const managedHosts = ['VERCEL', 'NETLIFY', 'RENDER', 'RAILWAY_ENVIRONMENT', 'FLY_APP_NAME', 'CF_PAGES', 'K_SERVICE', 'AWS_LAMBDA_FUNCTION_NAME'];

export async function requireLocalAIRequest(mode: 'read' | 'mutation'): Promise<void> {
  if (process.env.CARTOGRAPH_LOCAL_AI !== '1' || managedHosts.some(name => Boolean(process.env[name]))) {
    throw new LocalChatGPTError('local_only', 'Local ChatGPT usage requires the loopback-only local app launcher.');
  }
  const incoming = await headers();
  const host = incoming.get('host');
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(host)) {
    throw new LocalChatGPTError('local_only', 'Local ChatGPT usage requires a loopback request host.');
  }
  const origin = incoming.get('origin');
  if ((mode === 'mutation' || origin !== null) && origin !== `http://${host}`) {
    throw new LocalChatGPTError('invalid_origin', 'Local ChatGPT usage requires a matching loopback origin.');
  }
  if (incoming.get('sec-fetch-site') === 'cross-site') {
    throw new LocalChatGPTError('invalid_origin', 'Cross-site requests cannot use local ChatGPT usage.');
  }
}
