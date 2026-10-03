import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createLocalChatGPT, LocalChatGPTError } from '../lib/ai/local-auth.ts';

const owner = 'user_synthetic_owner';
const issuer = 'https://auth.openai.com';
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const matches = (code: string) => (error: unknown) => error instanceof LocalChatGPTError && error.code === code;
const filename = (directory: string) => join(directory, 'chatgpt.json');
async function expire(directory: string) {
  const saved = JSON.parse(await readFile(filename(directory), 'utf8'));
  saved.connection.credentials.expiresAt = 0;
  await writeFile(filename(directory), JSON.stringify(saved), { mode: 0o600 });
}

async function worker(directory: string) {
  const transport: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer,
      authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    if (url.endsWith('/token')) {
      await appendFile(join(directory, 'refresh-count'), 'refresh\n');
      return Response.json({ access_token: 'synthetic-worker-successor', refresh_token: 'synthetic-worker-refresh', expires_in: 3600, token_type: 'Bearer' });
    }
    throw new Error('Unexpected synthetic request.');
  };
  assert.equal(await createLocalChatGPT({ directory, transport }).accessTokenCredential(owner), 'synthetic-worker-successor');
}

async function verify() {
  const root = await mkdtemp(join(tmpdir(), 'cartograph-auth-verify-'));
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const wrongKey = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'synthetic', alg: 'RS256', use: 'sig' };
  try {
    let authorization: URL;
    let identityMode = 'valid';
    let callbackMode = 'valid';
    let granted = scopes;
    let subject = 'synthetic-chatgpt-subject';
    let refreshCalls = 0;
    let keysUnavailable: false | 'network' | 'http' = false;
    let tokenInvalid = false;
    let authorizationCalls = 0;
    const hostIds = new Set<string>();
    const issuedClient = 'oaiapp_synthetic';
    async function identity(nonce?: string) {
      return new SignJWT({ nonce: identityMode === 'nonce' ? 'wrong-nonce' : nonce, email: 'synthetic@example.invalid', name: 'Synthetic Account' })
        .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
        .setIssuer(identityMode === 'issuer' ? 'https://invalid.example' : issuer)
        .setAudience(identityMode === 'audience' ? 'wrong-client' : issuedClient)
        .setSubject(subject).setIssuedAt().setExpirationTime(identityMode === 'expired' ? Math.floor(Date.now() / 1000) - 60 : '1h')
        .sign(identityMode === 'signature' ? wrongKey.privateKey : privateKey);
    }
    const transport: typeof fetch = async (input, init) => {
      const url = String(input);
      assert.equal(init?.redirect, 'error', 'OAuth transports refuse redirects.');
      if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer,
        authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, revocation_endpoint: `${issuer}/revoke` });
      if (url.endsWith('/jwks')) {
        if (keysUnavailable === 'network') throw new Error('Synthetic key service outage.');
        if (keysUnavailable === 'http') return Response.json({ error: 'unavailable' }, { status: 503 });
        return Response.json({ keys: [jwk] });
      }
      if (url.endsWith('/token')) {
        const body = init?.body;
        assert(body instanceof URLSearchParams);
        assert.equal(body.get('client_id'), issuedClient);
        assert.equal(body.get('resource'), 'https://api.openai.com/v1');
        const refresh = body.get('grant_type') === 'refresh_token';
        if (refresh) {
          refreshCalls++;
          assert(body.get('refresh_token')?.startsWith('synthetic-'));
          if (tokenInvalid) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        } else {
          authorizationCalls++;
          assert.equal(body.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
          assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), authorization.searchParams.get('code_challenge'));
        }
        return Response.json({ access_token: `synthetic-access-${refreshCalls}`, refresh_token: `synthetic-refresh-${refreshCalls}`,
          expires_in: 3600, token_type: 'Bearer', scope: granted, id_token: await identity(refresh ? undefined : authorization.searchParams.get('nonce')!) });
      }
      if (url.endsWith('/revoke')) return new Response(null, { status: 200 });
      if (url === 'https://api.openai.com/v1/models') return Response.json({ models: [
        { visibility: 'list', slug: 'exact-synthetic-model-2026-09-28', display_name: 'Synthetic model' },
        { visibility: 'hidden', slug: 'hidden', display_name: 'Hidden' },
      ] });
      throw new Error('Unexpected synthetic URL.');
    };
    const directory = join(root, 'account');
    const openBrowser = async (url: string) => {
      authorization = new URL(url);
      assert.equal(authorization.searchParams.get('scope'), scopes);
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
      assert(authorization.searchParams.get('nonce'));
      hostIds.add(authorization.searchParams.get('ext_agent_host_id')!);
      const dynamic = authorization.searchParams.get('client_id') === 'dynamic_agent_client';
      assert.equal(authorization.searchParams.get('agent_name_hint'), dynamic ? 'Cartograph' : null);
      const callback = new URL(authorization.searchParams.get('redirect_uri')!);
      assert.equal(callback.hostname, '127.0.0.1'); assert.equal(callback.pathname, '/auth/callback');
      callback.search = new URLSearchParams({ state: 'invalid-state', code: 'synthetic-code', client_id: issuedClient }).toString();
      assert.equal((await fetch(callback)).status, 400, 'Invalid state does not consume the listener.');
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      if (callbackMode === 'missing') callback.searchParams.delete('client_id');
      if (callbackMode === 'mismatch') callback.searchParams.set('client_id', 'oaiapp_wrong');
      if (callbackMode === 'denied') callback.searchParams.set('error', 'access_denied');
      assert.equal((await fetch(callback)).status, 200, 'Listener is already bound before browser opening.');
    };
    const auth = createLocalChatGPT({ directory, transport, openBrowser });
    callbackMode = 'missing';
    await assert.rejects(auth.connect(owner), matches('registration_incomplete'));
    assert.equal(authorizationCalls, 0);
    callbackMode = 'denied';
    await assert.rejects(auth.connect(owner), matches('access_denied'));
    assert.equal(authorizationCalls, 0);
    callbackMode = 'valid';
    const connected = await auth.connect(owner);
    assert.equal(connected.sharing, true); assert.equal(connected.authorized, true);
    assert.equal(connected.identity?.email, 'synthetic@example.invalid');
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(filename(directory))).mode & 0o777, 0o600);
    assert.equal(hostIds.size, 1, 'The installation host ID persists across failed and successful sign-ins.');
    const safe = JSON.stringify(await auth.getStatus(owner));
    assert(!safe.includes('synthetic-access') && !safe.includes('synthetic-refresh'), 'Status never contains credentials.');
    assert.equal((await auth.getStatus('user_other')).identity, undefined);
    await assert.rejects(auth.accessTokenCredential('user_other'), matches('owner_mismatch'));
    callbackMode = 'mismatch';
    await assert.rejects(auth.connect(owner), matches('registration_incomplete'));
    callbackMode = 'missing';
    await auth.connect(owner);
    callbackMode = 'valid';
    for (const invalid of ['nonce', 'issuer', 'audience', 'expired', 'signature']) {
      identityMode = invalid;
      await assert.rejects(auth.connect(owner), matches('invalid_identity'));
      assert.equal((await auth.getStatus(owner)).sharing, true, 'Invalid identity preserves the active connection.');
    }
    identityMode = 'valid'; subject = 'different-subject';
    await assert.rejects(auth.connect(owner), matches('account_mismatch'));
    subject = 'synthetic-chatgpt-subject';
    assert.deepEqual(await auth.listModels(owner), [{ slug: 'exact-synthetic-model-2026-09-28', displayName: 'Synthetic model' }]);
    await expire(directory);
    const second = createLocalChatGPT({ directory, transport, openBrowser });
    const concurrent = await Promise.all([auth.accessTokenCredential(owner), second.accessTokenCredential(owner)]);
    assert.equal(concurrent[0], concurrent[1]); assert.equal(refreshCalls, 1, 'Concurrent instances refresh a rotating token once.');
    await expire(directory); keysUnavailable = 'network';
    await assert.rejects(auth.accessTokenCredential(owner), matches('network_unavailable'));
    assert((JSON.parse(await readFile(filename(directory), 'utf8'))).connection.pendingRefresh, 'Received rotation is saved before identity verification.');
    keysUnavailable = false;
    await auth.accessTokenCredential(owner);
    assert.equal(refreshCalls, 2, 'Identity recovery never resends the consumed refresh token.');
    await expire(directory); keysUnavailable = 'http';
    await assert.rejects(auth.accessTokenCredential(owner), matches('network_unavailable'));
    assert.equal((await auth.getStatus(owner)).status, 'connected', 'A JWKS HTTP outage does not revoke the saved connection.');
    keysUnavailable = false;
    await auth.accessTokenCredential(owner);
    assert.equal(refreshCalls, 3, 'A JWKS HTTP failure also resumes the persisted successor.');
    await expire(directory); subject = 'different-subject';
    await assert.rejects(auth.accessTokenCredential(owner), matches('account_mismatch'));
    assert.equal((await auth.getStatus(owner)).status, 'reauth_required');
    subject = 'synthetic-chatgpt-subject';
    await auth.connect(owner); await expire(directory); tokenInvalid = true;
    await assert.rejects(auth.accessTokenCredential(owner), matches('reauth_required'));
    assert.equal((await auth.getStatus(owner)).sharing, false);
    tokenInvalid = false;
    await auth.connect(owner);
    granted = 'openid profile email';
    await auth.connect(owner);
    assert.equal((await auth.getStatus(owner)).sharing, false);
    await assert.rejects(auth.accessTokenCredential(owner), matches('sharing_not_enabled'));
    granted = scopes;
    await auth.connect(owner); await expire(directory);
    const runWorker = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/verify-local-auth.ts', '--refresh-worker', directory], { cwd: process.cwd(), stdio: 'pipe' });
      let errorOutput = '';
      child.stderr.on('data', value => { errorOutput += String(value); });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Synthetic worker failed: ${errorOutput}`)));
    });
    await Promise.all([runWorker(), runWorker()]);
    assert.equal(await readFile(join(directory, 'refresh-count'), 'utf8'), 'refresh\n', 'Independent Node processes rotate credentials once.');
    await chmod(filename(directory), 0o644);
    await assert.rejects(auth.getStatus(owner), matches('unsafe_storage'));
    await chmod(filename(directory), 0o600);
    await assert.rejects(auth.disconnect('user_other'), matches('owner_mismatch'));
    await auth.disconnect(owner);
    assert.equal((await auth.getStatus(owner)).status, 'disconnected');
    const disconnected = await readFile(filename(directory), 'utf8');
    assert(!disconnected.includes('synthetic-worker-successor') && !disconnected.includes('synthetic-worker-refresh'));
    assert(disconnected.includes(issuedClient), 'Disconnect retains the issued registration.');
    console.log('Local ChatGPT auth verified. Callback, signed identity, owner, scope, model catalog, refresh recovery, process lock, permissions, and disconnect checks passed with synthetic credentials.');
  } finally { await rm(root, { recursive: true, force: true }); }
}

if (process.argv[2] === '--refresh-worker') await worker(process.argv[3]);
else await verify();
