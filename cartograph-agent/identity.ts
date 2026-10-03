import { defineIdentity } from 'managed-deepagents';
import { appOrigin } from './transport.ts';
export const identity = defineIdentity({ auth: { id: 'cartograph', issuer: appOrigin(), audience: 'cartograph-runtime', algorithms: ['ES256'], jwks: `${appOrigin()}/api/agent/jwks`, claims: { user: 'sub' } } });
