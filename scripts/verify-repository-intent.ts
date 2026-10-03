import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

interface IntentFixture {
  values: Map<string, string>;
  options: Record<string, unknown>;
  userId: string | null;
  orgId: string | null;
  fail: boolean;
  claims: string[];
  gate: Promise<void>;
}
declare global { var cartographIntentFixture: IntentFixture; }
const fixture: IntentFixture = globalThis.cartographIntentFixture = { values: new Map(), options: {}, userId: null, orgId: null, fail: false, claims: [], gate: Promise.resolve() };
const modules: Record<string, string> = {
  'next/headers': 'export const headers=async()=>new Headers({"x-forwarded-proto":"https"}); export const cookies=async()=>({getAll:()=>[...globalThis.cartographIntentFixture.values].map(([name,value])=>({name,value})),get:name=>({value:globalThis.cartographIntentFixture.values.get(name)}),set:(name,value,options)=>{globalThis.cartographIntentFixture.values.set(name,value);globalThis.cartographIntentFixture.options=options;},delete:name=>globalThis.cartographIntentFixture.values.delete(name)});',
  'next/navigation': 'export const redirect=path=>{throw new Error("REDIRECT "+path)};',
  '@clerk/nextjs/server': 'export const auth=async()=>({userId:globalThis.cartographIntentFixture.userId,orgId:globalThis.cartographIntentFixture.orgId});',
  '@/lib/pipeline/run': 'export const submitRepository=async url=>{if(globalThis.cartographIntentFixture.fail)throw new Error("claim failed");await globalThis.cartographIntentFixture.gate;globalThis.cartographIntentFixture.claims.push(url);return "analysis-fixture";};',
};
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  const source = modules[specifier];
  if (source && context.parentURL?.endsWith('/app/actions.ts')) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
  if (specifier === '@/lib/repository-intent') return { url: new URL('../lib/repository-intent.ts', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + '.ts', context);
  return nextResolve(specifier, context);
} });
const form = (name: string, value: string) => { const result = new FormData(); result.set(name, value); return result; };
try {
  const { canonicalRepository, readRepositoryIntent, repositoryIntentCookie, repositoryIntentLifetime } = await import('../lib/repository-intent.ts');
  assert.equal(canonicalRepository('https://github.com/Owner/Repo.git'), 'https://github.com/owner/repo');
  assert.throws(() => canonicalRepository('https://evil.example/owner/repo'));
  const { beginRepository, resumeRepository } = await import('../app/actions.ts');
  assert.ok((await beginRepository(null, form('repository', 'https://github.com/o/r?redirect=https://evil.example')))?.error);
  assert.equal(fixture.values.size, 0);
  await assert.rejects(beginRepository(null, form('repository', 'https://github.com/Owner/Repo.git')), /REDIRECT \/\?intent=[a-f0-9]{64}$/);
  const [cookieName, raw] = [...fixture.values][0];
  const encoded: unknown = JSON.parse(raw);
  assert.ok(encoded && typeof encoded === 'object' && 'nonce' in encoded && typeof encoded.nonce === 'string');
  const nonce = encoded.nonce;
  const intent = readRepositoryIntent(raw, nonce)!;
  assert.equal(intent.repository, 'https://github.com/owner/repo');
  assert.deepEqual(fixture.options, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 900, secure: true });
  assert.equal(readRepositoryIntent(raw, '0'.repeat(64)), null);
  assert.equal(readRepositoryIntent(raw, nonce, intent.expiresAt), null);
  assert.equal(readRepositoryIntent(JSON.stringify({ ...intent, expiresAt: Date.now() + repositoryIntentLifetime * 2 }), nonce), null);
  assert.equal(readRepositoryIntent(JSON.stringify({ ...intent, repository: 'https://evil.example/owner/repo' }), nonce), null);
  assert.equal(readRepositoryIntent(JSON.stringify({ ...intent, organization: 'injected-org' }), nonce), null);
  const resume = form('intent', nonce);
  await assert.rejects(resumeRepository(null, resume), new RegExp(`REDIRECT /sign-in\\?intent=${nonce}`));
  assert.equal(fixture.claims.length, 0);
  assert.equal(fixture.values.get(cookieName), raw);
  fixture.userId = 'user-fixture';
  await assert.rejects(resumeRepository(null, resume), new RegExp(`REDIRECT /\\?intent=${nonce}`));
  assert.equal(fixture.claims.length, 0);
  fixture.orgId = 'org-fixture'; fixture.fail = true;
  assert.deepEqual(await resumeRepository(null, resume), { error: 'claim failed' });
  assert.equal(fixture.values.get(cookieName), raw);
  fixture.fail = false;
  await assert.rejects(beginRepository(null, form('repository', 'https://github.com/another/repo')), /REDIRECT/);
  assert.ok((await resumeRepository(null, resume))?.error);
  assert.equal(fixture.claims.length, 0);
  fixture.values.set(cookieName, raw);
  await assert.rejects(resumeRepository(null, resume), /REDIRECT \/analyses\/analysis-fixture$/);
  assert.deepEqual(fixture.claims, ['https://github.com/owner/repo']);
  assert.equal(fixture.values.has(cookieName), false);
  assert.ok((await resumeRepository(null, resume))?.error);
  assert.equal(fixture.claims.length, 1);
  let release!: () => void;
  fixture.values.set(cookieName, raw);
  fixture.gate = new Promise<void>(resolve => { release = resolve; });
  const overlapping = resumeRepository(null, resume);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(beginRepository(null, form('repository', 'https://github.com/newer/repo')), /REDIRECT/);
  const [newName, newRaw] = [...fixture.values][0];
  assert.notEqual(newName, cookieName);
  release();
  await assert.rejects(overlapping, /REDIRECT/);
  assert.equal(fixture.values.get(newName), newRaw);
  const newerNonce = newName.slice('cartograph-repository-intent-'.length);
  assert.equal(repositoryIntentCookie(newerNonce), newName);
  assert.equal(readRepositoryIntent(newRaw, newerNonce)?.repository, 'https://github.com/newer/repo');
  await assert.rejects(resumeRepository(null, form('intent', newerNonce)), /REDIRECT/);
  assert.equal(fixture.claims.at(-1), 'https://github.com/newer/repo');
  console.log('Actual intent actions preserve canonical repository across auth/team gates, isolate tabs, retain failed claims, and consume successful POSTs once.');
} finally { hooks.deregister(); }
