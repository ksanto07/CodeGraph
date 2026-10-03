import assert from 'node:assert/strict';
import { DelegationRegistry, type DelegationScope } from '../lib/agent/delegation-registry.ts';

async function main() {
  let now = Date.now();
  const registry = new DelegationRegistry<object>(() => now);
  const scope: DelegationScope = {
    analysis: 'analysis-A', organization: 'workspace-A', user: 'user-A',
    attempt: 'attempt-A', commit: 'a'.repeat(40), thread: 'thread-A',
  };
  const client = {};
  const grant = await registry.issue(scope, client);
  scope.analysis = 'analysis-B';
  const resolved = await registry.resolve(grant.token);
  assert.equal(resolved.scope.analysis, 'analysis-A');
  assert.equal(resolved.value, client);
  assert.ok(Object.isFrozen(resolved.scope));
  const [header, body, signature] = grant.token.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  claims.resource = 'analysis-B';
  await assert.rejects(registry.resolve([header, Buffer.from(JSON.stringify(claims)).toString('base64url'), signature].join('.')));
  await assert.rejects(new DelegationRegistry<object>().resolve(grant.token));
  grant.revoke();
  await assert.rejects(registry.resolve(grant.token));
  const current = await registry.issue(scope, client);
  registry.revokeAnalysis('analysis-B');
  await assert.rejects(registry.resolve(current.token));
  const pending = await Promise.all(Array.from({ length: 64 }, () => registry.issue(scope, client)));
  await assert.rejects(registry.issue(scope, client), /slots are occupied/);
  assert.equal((await registry.resolve(pending[0].token)).value, client);
  now += 300_000;
  await assert.rejects(registry.resolve(pending[0].token));
  const replacement = await registry.issue(scope, client);
  assert.equal((await registry.resolve(replacement.token)).scope.thread, 'thread-A');
  console.log('Scoped grants preserve captured clients, reject tampering/restarts/revocation/expiry, and enforce a 64-run bound without evicting active questions.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
