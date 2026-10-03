import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const sharingScope = 'chatgpt.tokens.use.direct';
const requestedScopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const chatGPTUsageURL = 'https://chatgpt.com/settings/usage';
const random = () => randomBytes(32).toString('base64url');
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export class LocalChatGPTError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'LocalChatGPTError'; this.code = code; }
}
function fail(code: string, message: string): never { throw new LocalChatGPTError(code, message); }
function owner(value: string): string {
  if (!/^user_[A-Za-z0-9_-]{1,200}$/.test(value)) fail('invalid_owner', 'Provide the exact Clerk user ID, beginning with user_.');
  return value;
}
interface Identity { subject: string; name?: string; email?: string }
interface Credentials { accessToken: string; refreshToken?: string; expiresAt: number; earliestRefreshAt?: number }
interface Rotation { credentials: Credentials; scopes: string[]; idToken?: string; receivedAt: number }
interface Connection extends Identity {
  ownerUserId: string;
  status: 'connected' | 'reauth_required';
  scopes: string[];
  credentials?: Credentials;
  pendingRefresh?: Rotation;
}
interface SavedState {
  version: 1;
  hostId: string;
  registration?: { clientId: string; subject?: string };
  connection?: Connection;
}
export interface LocalChatGPTStatus {
  status: 'disconnected' | 'connected' | 'reauth_required';
  sharing: boolean;
  authorized: boolean;
  identity?: { name?: string; email?: string };
  usageURL: string;
}
export interface LocalChatGPTModel { slug: string; displayName: string }
interface Discovery { authorization: string; token: string; jwks: string; revocation?: string }
interface LocalChatGPTOptions {
  directory?: string;
  transport?: typeof fetch;
  openBrowser?: (url: string) => Promise<void>;
}

function credentials(value: unknown): Credentials {
  if (!record(value) || !text(value.accessToken) || typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) ||
      (value.refreshToken !== undefined && !text(value.refreshToken)) ||
      (value.earliestRefreshAt !== undefined && (typeof value.earliestRefreshAt !== 'number' || !Number.isFinite(value.earliestRefreshAt)))) {
    fail('invalid_storage', 'The local credential record is invalid. Preserve it and reconnect.');
  }
  return { accessToken: value.accessToken, expiresAt: value.expiresAt,
    ...(text(value.refreshToken) ? { refreshToken: value.refreshToken } : {}),
    ...(typeof value.earliestRefreshAt === 'number' ? { earliestRefreshAt: value.earliestRefreshAt } : {}) };
}
function scopes(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((scope): scope is string => text(scope))) fail('invalid_storage', 'The saved permissions are invalid.');
  return value;
}
function savedState(value: unknown): SavedState {
  if (!record(value) || value.version !== 1 || !text(value.hostId) || !/^urn:uuid:[0-9a-f-]{36}$/.test(value.hostId)) fail('invalid_storage', 'The local connection file is invalid.');
  const saved: SavedState = { version: 1, hostId: value.hostId };
  if (value.registration !== undefined) {
    const registration = value.registration;
    if (!record(registration) || !text(registration.clientId) || !/^[A-Za-z0-9_-]{1,200}$/.test(registration.clientId) || registration.clientId === 'dynamic_agent_client' ||
        (registration.subject !== undefined && !text(registration.subject))) fail('invalid_storage', 'The saved ChatGPT registration is invalid.');
    saved.registration = { clientId: registration.clientId, ...(text(registration.subject) ? { subject: registration.subject } : {}) };
  }
  if (value.connection !== undefined) {
    const connection = value.connection;
    if (!saved.registration || !record(connection) || !text(connection.ownerUserId) || !text(connection.subject) ||
        connection.subject !== saved.registration.subject || !['connected', 'reauth_required'].includes(String(connection.status)) ||
        (connection.name !== undefined && typeof connection.name !== 'string') || (connection.email !== undefined && typeof connection.email !== 'string')) {
      fail('invalid_storage', 'The saved ChatGPT account is invalid.');
    }
    saved.connection = { ownerUserId: owner(connection.ownerUserId), subject: connection.subject,
      status: connection.status === 'connected' ? 'connected' : 'reauth_required', scopes: scopes(connection.scopes),
      ...(typeof connection.name === 'string' ? { name: connection.name } : {}), ...(typeof connection.email === 'string' ? { email: connection.email } : {}),
      ...(connection.credentials !== undefined ? { credentials: credentials(connection.credentials) } : {}) };
    if (connection.pendingRefresh !== undefined) {
      const pending = connection.pendingRefresh;
      if (!record(pending) || typeof pending.receivedAt !== 'number' || !Number.isFinite(pending.receivedAt) ||
          (pending.idToken !== undefined && !text(pending.idToken))) fail('invalid_storage', 'The saved refresh checkpoint is invalid.');
      saved.connection.pendingRefresh = { credentials: credentials(pending.credentials), scopes: scopes(pending.scopes), receivedAt: pending.receivedAt,
        ...(text(pending.idToken) ? { idToken: pending.idToken } : {}) };
    }
  }
  return saved;
}
function status(saved: SavedState, userId?: string): LocalChatGPTStatus {
  const connection = saved.connection;
  const authorized = Boolean(connection && userId === connection.ownerUserId);
  return { status: connection?.status ?? 'disconnected', sharing: Boolean(connection?.status === 'connected' && connection.credentials && connection.scopes.includes(sharingScope)),
    authorized, usageURL: chatGPTUsageURL,
    ...(connection && authorized ? { identity: { name: connection.name, email: connection.email } } : {}) };
}
function errorCode(error: unknown): string | undefined { return record(error) && typeof error.code === 'string' ? error.code : undefined; }

async function browser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [url], { stdio: 'ignore', shell: false });
    child.once('error', () => reject(new LocalChatGPTError('browser_unavailable', 'The system browser could not be opened.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new LocalChatGPTError('browser_unavailable', 'The system browser could not be opened.')));
  });
}

/** Local runtime only. HTTP callers must enforce loopback and authenticate Clerk before calling these methods. */
export function createLocalChatGPT(options: LocalChatGPTOptions = {}) {
  const directory = options.directory ?? join(homedir(), '.config', 'cartograph');
  if (!isAbsolute(directory)) fail('invalid_config', 'The credential directory must be absolute.');
  const filename = join(directory, 'chatgpt.json');
  const lockname = join(directory, 'chatgpt.lock');
  const transport = options.transport ?? fetch;
  let providerPromise: Promise<Discovery> | undefined;

  async function request(url: string | URL, init?: RequestInit): Promise<Response> {
    try { return await transport(url, { ...init, redirect: 'error', signal: init?.signal ?? AbortSignal.timeout(30_000) }); }
    catch { return fail('network_unavailable', 'ChatGPT could not be reached. Try again.'); }
  }
  async function json(response: Response): Promise<Record<string, unknown>> {
    let value: unknown;
    try { value = await response.json(); } catch { return fail('invalid_response', 'ChatGPT returned an invalid response.'); }
    if (!record(value)) fail('invalid_response', 'ChatGPT returned an invalid response.');
    if (!response.ok) {
      const code = typeof value.error === 'string' ? value.error : record(value.error) && typeof value.error.code === 'string' ? value.error.code : '';
      if (code === 'invalid_grant') fail('reauth_required', 'The ChatGPT grant expired or was revoked. Connect again.');
      if (response.status === 429) fail('usage_limited', 'ChatGPT plan usage is limited. Check usage or try later.');
      fail('authorization_failed', 'ChatGPT did not authorize this operation.');
    }
    return value;
  }
  async function provider(): Promise<Discovery> {
    providerPromise ??= (async () => {
      const data = await json(await request(`${issuer}/.well-known/openid-configuration`));
      const endpoint = (key: string): string => {
        const value = data[key];
        if (!text(value)) fail('invalid_provider', 'ChatGPT sign-in configuration is invalid.');
        let url: URL;
        try { url = new URL(value); } catch { return fail('invalid_provider', 'ChatGPT sign-in configuration is invalid.'); }
        if (url.origin !== issuer || url.username || url.password) fail('invalid_provider', 'ChatGPT sign-in configuration is invalid.');
        return url.toString();
      };
      if (data.issuer !== issuer) fail('invalid_provider', 'ChatGPT sign-in issuer is invalid.');
      return { authorization: endpoint('authorization_endpoint'), token: endpoint('token_endpoint'), jwks: endpoint('jwks_uri'),
        ...(data.revocation_endpoint !== undefined ? { revocation: endpoint('revocation_endpoint') } : {}) };
    })().catch((error: unknown) => { providerPromise = undefined; throw error; });
    return providerPromise;
  }
  async function verifyIdentity(idToken: string, clientId: string, nonce?: string, receivedAt?: number): Promise<Identity> {
    const config = await provider();
    const keys = createRemoteJWKSet(new URL(config.jwks), {
      [customFetch]: async (url, init) => {
        const response = await request(url, init);
        if (response.status !== 200) fail('network_unavailable', 'ChatGPT identity verification is temporarily unavailable.');
        let data: unknown;
        try { data = await response.json(); } catch { return fail('network_unavailable', 'ChatGPT signing keys could not be retrieved.'); }
        if (!record(data) || !Array.isArray(data.keys)) fail('network_unavailable', 'ChatGPT signing keys could not be retrieved.');
        return Response.json(data);
      }, timeoutDuration: 15_000,
    });
    try {
      const { payload } = await jwtVerify(idToken, async (header, token) => {
        try { return await keys(header, token); }
        catch { return fail('network_unavailable', 'ChatGPT identity verification is temporarily unavailable.'); }
      }, { issuer, audience: clientId, algorithms: ['RS256'],
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat'], clockTolerance: 5,
        ...(receivedAt !== undefined ? { currentDate: new Date(receivedAt) } : {}) });
      if (!text(payload.sub) || (nonce !== undefined && payload.nonce !== nonce) ||
          (payload.azp !== undefined && payload.azp !== clientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) {
        fail('invalid_identity', 'The ChatGPT identity does not match this sign-in.');
      }
      return { subject: payload.sub, ...(typeof payload.name === 'string' ? { name: payload.name } : {}), ...(typeof payload.email === 'string' ? { email: payload.email } : {}) };
    } catch (error) {
      if (error instanceof LocalChatGPTError) throw error;
      if (errorCode(error) === 'ERR_JWKS_TIMEOUT') fail('network_unavailable', 'ChatGPT identity verification is temporarily unavailable.');
      return fail('invalid_identity', 'The ChatGPT identity could not be verified. Connect again.');
    }
  }
  async function ensureDirectory() {
    if (process.platform === 'win32' || !process.getuid) fail('unsupported_platform', 'Local ChatGPT storage currently requires macOS or Linux owner-only permissions.');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
      fail('unsafe_storage', 'The Cartograph credential directory must be owned by you with permissions 0700.');
    }
  }
  async function read(): Promise<SavedState> {
    let file;
    try { file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (errorCode(error) === 'ENOENT') return { version: 1, hostId: `urn:uuid:${randomUUID()}` }; throw error; }
    try {
      const info = await file.stat();
      if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 1024 * 1024) fail('unsafe_storage', 'The credential file must be owned by you with permissions 0600.');
      let value: unknown;
      try { value = JSON.parse(await file.readFile('utf8')); } catch { return fail('invalid_storage', 'The credential file could not be read. Preserve it and reconnect.'); }
      return savedState(value);
    } finally { await file.close(); }
  }
  async function write(saved: SavedState) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(saved)); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, filename);
      const folder = await open(directory, 'r'); try { await folder.sync(); } finally { await folder.close(); }
    }
    finally { await unlink(temporary).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; }); }
  }
  async function locked<T>(operation: (saved: SavedState) => Promise<T>): Promise<T> {
    await ensureDirectory();
    const deadline = Date.now() + 10_000;
    let lock;
    for (;;) {
      try { lock = await open(lockname, 'wx', 0o600); break; }
      catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
        if (Date.now() >= deadline) fail('connection_busy', 'Another connection operation is running. If it crashed, stop Cartograph before removing chatgpt.lock.');
        await delay(50);
      }
    }
    try { await lock.writeFile(String(process.pid)); return await operation(await read()); }
    finally { await lock.close(); await unlink(lockname); }
  }
  async function tokenRequest(body: URLSearchParams) {
    return json(await request((await provider()).token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }));
  }
  function tokenFields(data: Record<string, unknown>, refresh = false): { scopes: string[]; credentials?: Credentials } {
    if (typeof data.scope !== 'string') fail('invalid_response', 'ChatGPT did not confirm the granted permissions.');
    const granted = data.scope.split(/\s+/).filter(Boolean);
    if (!text(data.access_token)) {
      if (refresh || granted.includes(sharingScope) || granted.includes('offline_access')) fail('invalid_response', 'ChatGPT did not provide credentials for the granted permissions.');
      return { scopes: granted };
    }
    if (typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' || typeof data.expires_in !== 'number' ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0 || !Number.isFinite(Date.now() + data.expires_in * 1000) ||
        ((refresh || granted.includes('offline_access')) && !text(data.refresh_token))) fail('invalid_response', 'ChatGPT returned incomplete credentials.');
    const earliest = typeof data.earliest_refresh_at === 'number' ? data.earliest_refresh_at * 1000 :
      typeof data.earliest_refresh_at === 'string' ? Date.parse(data.earliest_refresh_at) : undefined;
    if (earliest !== undefined && !Number.isFinite(earliest)) fail('invalid_response', 'ChatGPT returned an invalid refresh schedule.');
    return { scopes: granted, credentials: { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000,
      ...(text(data.refresh_token) ? { refreshToken: data.refresh_token } : {}), ...(earliest !== undefined ? { earliestRefreshAt: earliest } : {}) } };
  }
  async function credential(userId: string): Promise<string> {
    owner(userId);
    return locked(async saved => {
      const connection = saved.connection;
      if (!connection || connection.status !== 'connected' || !connection.credentials) fail('sign_in_required', 'Connect a ChatGPT account first.');
      if (connection.ownerUserId !== userId) fail('owner_mismatch', 'This local ChatGPT connection belongs to a different application user.');
      if (!connection.scopes.includes(sharingScope)) fail('sharing_not_enabled', 'ChatGPT plan usage was not authorized. Connect again and grant plan usage.');
      if (connection.pendingRefresh || connection.credentials.expiresAt <= Date.now() + 60_000) {
        if (!connection.pendingRefresh && (connection.credentials.earliestRefreshAt ?? 0) > Date.now()) {
          if (connection.credentials.expiresAt <= Date.now()) fail('refresh_not_ready', 'The ChatGPT token cannot refresh yet. Try shortly.');
          return connection.credentials.accessToken;
        }
        try {
          let rotation = connection.pendingRefresh;
          if (!rotation) {
            if (!connection.credentials.refreshToken || !saved.registration) fail('reauth_required', 'The ChatGPT connection expired. Connect again.');
            const data = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', client_id: saved.registration.clientId,
              refresh_token: connection.credentials.refreshToken, resource }));
            const fields = tokenFields({ ...data, scope: data.scope ?? connection.scopes.join(' ') }, true);
            if (!fields.credentials || (data.id_token !== undefined && !text(data.id_token))) fail('invalid_response', 'ChatGPT returned an invalid refreshed identity.');
            rotation = { credentials: fields.credentials, scopes: fields.scopes, receivedAt: Date.now(), ...(text(data.id_token) ? { idToken: data.id_token } : {}) };
            // Checkpoint the successor before JWKS retrieval so a consumed refresh token is never retried.
            connection.pendingRefresh = rotation;
            await write(saved);
          }
          if (rotation.idToken) {
            const identity = await verifyIdentity(rotation.idToken, saved.registration!.clientId, undefined, rotation.receivedAt);
            if (identity.subject !== connection.subject) fail('account_mismatch', 'The refreshed ChatGPT account changed. Connect again.');
            connection.name = identity.name; connection.email = identity.email;
          }
          connection.credentials = rotation.credentials; connection.scopes = rotation.scopes;
          delete connection.pendingRefresh;
          await write(saved);
        } catch (error) {
          if (error instanceof LocalChatGPTError && ['reauth_required', 'invalid_identity', 'account_mismatch'].includes(error.code)) {
            connection.status = 'reauth_required'; delete connection.credentials; delete connection.pendingRefresh; await write(saved);
          }
          throw error;
        }
      }
      if (!connection.scopes.includes(sharingScope)) fail('sharing_not_enabled', 'ChatGPT plan usage is no longer authorized.');
      if (!connection.credentials || connection.credentials.expiresAt <= Date.now()) fail('refresh_not_ready', 'The ChatGPT connection needs another refresh. Try shortly.');
      return connection.credentials.accessToken;
    });
  }
  return {
    getStatus(userId?: string): Promise<LocalChatGPTStatus> { return locked(async saved => status(saved, userId)); },
    accessTokenCredential: credential,
    async listModels(userId: string): Promise<LocalChatGPTModel[]> {
      const token = await credential(userId);
      const data = await json(await request(`${resource}/models`, { headers: { authorization: `Bearer ${token}` } }));
      if (!Array.isArray(data.models)) fail('invalid_catalog', 'ChatGPT returned an invalid model catalog.');
      return data.models.filter(value => record(value) && value.visibility === 'list').map(value => {
        if (!record(value) || !text(value.slug) || !text(value.display_name)) fail('invalid_catalog', 'ChatGPT returned an invalid model entry.');
        return { slug: value.slug, displayName: value.display_name };
      });
    },
    async disconnect(userId: string): Promise<void> {
      owner(userId);
      await locked(async saved => {
        if (!saved.connection) return;
        if (saved.connection.ownerUserId !== userId) fail('owner_mismatch', 'This connection belongs to a different application user.');
        const token = saved.connection.pendingRefresh?.credentials.refreshToken ?? saved.connection.credentials?.refreshToken;
        delete saved.connection;
        await write(saved);
        if (token && saved.registration) {
          try {
            const endpoint = (await provider()).revocation;
            if (!endpoint) fail('revocation_failed', 'Remote revocation is unavailable.');
            const response = await request(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: saved.registration.clientId }) });
            if (!response.ok) fail('revocation_failed', 'Remote revocation failed.');
            await response.body?.cancel();
          } catch { fail('revocation_failed', 'Local credentials were removed. Remote revocation could not be confirmed; disconnect Cartograph in ChatGPT settings.'); }
        }
      });
    },
    async connect(userId: string): Promise<LocalChatGPTStatus> {
      owner(userId);
      return locked(async saved => {
        if (saved.connection && saved.connection.ownerUserId !== userId) fail('owner_mismatch', 'Disconnect the current owner before binding another application user.');
        await write(saved);
        const config = await provider();
        const state = random(), nonce = random(), verifier = random();
        let complete!: (value: { code: string; clientId: string }) => void;
        let reject!: (error: LocalChatGPTError) => void;
        const callback = new Promise<{ code: string; clientId: string }>((resolve, failure) => { complete = resolve; reject = failure; });
        void callback.catch(() => undefined);
        let port = 0;
        let settled = false;
        const server = createServer((request, response) => {
          response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
          const cleanupScript = 'history.replaceState(null,"","/auth/complete");';
          response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'sha256-${createHash('sha256').update(cleanupScript).digest('base64')}'; frame-ancestors 'none'; base-uri 'none'`);
          let url: URL;
          try { url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`); } catch { response.writeHead(400).end('Invalid callback.'); return; }
          if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${port}` || url.origin !== `http://127.0.0.1:${port}` || url.pathname !== '/auth/callback' || settled) { response.writeHead(404).end(); return; }
          const returned = Buffer.from(url.searchParams.get('state') ?? ''); const expected = Buffer.from(state);
          if (url.searchParams.getAll('state').length !== 1 || returned.length !== expected.length || !timingSafeEqual(returned, expected)) { response.writeHead(400).end('Invalid sign-in state.'); return; }
          settled = true;
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Cartograph</title><p>Return to Cartograph. Your connection is being checked.</p><script>${cleanupScript}</script></html>`);
          if (url.searchParams.has('error')) { reject(new LocalChatGPTError('access_denied', 'ChatGPT sign-in was not authorized.')); return; }
          const code = url.searchParams.get('code'); const returnedClientId = url.searchParams.get('client_id'); const clientId = returnedClientId ?? saved.registration?.clientId;
          if (!code || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('client_id').length > 1 || !clientId ||
              !/^[A-Za-z0-9_-]{1,200}$/.test(clientId) || clientId === 'dynamic_agent_client' ||
              (saved.registration && returnedClientId !== null && returnedClientId !== saved.registration.clientId)) {
            reject(new LocalChatGPTError('registration_incomplete', 'ChatGPT returned a missing or mismatched issued client ID.')); return;
          }
          complete({ code, clientId });
        });
        server.requestTimeout = 15_000; server.headersTimeout = 10_000;
        await new Promise<void>((resolve, failure) => {
          server.once('error', failure);
          server.listen(0, '127.0.0.1', () => { server.removeListener('error', failure); const address = server.address(); if (address && typeof address !== 'string') port = address.port; resolve(); });
        });
        server.on('error', () => reject(new LocalChatGPTError('callback_failed', 'The local ChatGPT callback listener stopped. Run connect again.')));
        const timeout = setTimeout(() => reject(new LocalChatGPTError('sign_in_timeout', 'ChatGPT sign-in timed out. Run connect again.')), 10 * 60_000);
        const onInterrupt = () => reject(new LocalChatGPTError('cancelled', 'ChatGPT sign-in was cancelled.'));
        process.once('SIGINT', onInterrupt);
        try {
          const redirect = `http://127.0.0.1:${port}/auth/callback`;
          const authorization = new URL(config.authorization);
          authorization.search = new URLSearchParams({ client_id: saved.registration?.clientId ?? 'dynamic_agent_client',
            response_type: 'code', redirect_uri: redirect, scope: requestedScopes, resource, ext_agent_host_id: saved.hostId,
            state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            ...(!saved.registration ? { agent_name_hint: 'Cartograph' } : {}) }).toString();
          await (options.openBrowser ?? browser)(authorization.toString());
          const result = await callback;
          saved.registration ??= { clientId: result.clientId };
          await write(saved);
          const data = await tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', client_id: result.clientId,
            code: result.code, code_verifier: verifier, redirect_uri: redirect, resource }));
          if (!text(data.id_token)) fail('invalid_identity', 'ChatGPT did not return a verifiable identity.');
          const identity = await verifyIdentity(data.id_token, result.clientId, nonce);
          if (saved.registration.subject && saved.registration.subject !== identity.subject) fail('account_mismatch', 'This registration belongs to a different ChatGPT account.');
          const fields = tokenFields(data);
          saved.registration.subject = identity.subject;
          saved.connection = { ownerUserId: userId, status: 'connected', ...identity, ...fields };
          await write(saved);
          return status(saved, userId);
        } finally {
          clearTimeout(timeout); process.removeListener('SIGINT', onInterrupt); server.closeAllConnections(); server.close();
        }
      });
    },
  };
}

const local = createLocalChatGPT();
export const getLocalChatGPTStatus = local.getStatus;
export const accessTokenCredential = local.accessTokenCredential;
export const listLocalChatGPTModels = local.listModels;
export const connectLocalChatGPT = local.connect;
export const disconnectLocalChatGPT = local.disconnect;
