import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export interface DelegationScope {
  analysis: string;
  organization: string;
  user: string;
  attempt: string;
  commit: string;
  thread: string;
}
interface Delegation<T> { scope: Readonly<DelegationScope>; expires: number; value: T }
const audience = 'cartograph-graph-tools';
const lifetime = 300_000;
const capacity = 64;

export class DelegationRegistry<T> {
  readonly #key = randomBytes(32);
  readonly #entries = new Map<string, Delegation<T>>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) { this.#now = now; }

  #expire() {
    const now = this.#now();
    for (const [id, entry] of this.#entries) if (entry.expires <= now) this.#entries.delete(id);
  }

  async issue(scope: DelegationScope, value: T): Promise<{ token: string; revoke: () => void }> {
    this.#expire();
    if (this.#entries.size >= capacity) throw new Error('All repository question slots are occupied.');
    if (Object.values(scope).some(value => !value || value.length > 256)) throw new Error('Invalid question scope.');
    const id = randomBytes(32).toString('hex');
    const entry = { scope: Object.freeze({ ...scope }), value, expires: this.#now() + lifetime };
    this.#entries.set(id, entry);
    try {
      const token = await new SignJWT({ resource: scope.analysis, organization: scope.organization, thread: scope.thread })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setJti(id).setAudience(audience)
        .setIssuedAt(Math.floor(this.#now() / 1000)).setExpirationTime(Math.floor(entry.expires / 1000)).sign(this.#key);
      return { token, revoke: () => { this.#entries.delete(id); } };
    } catch (error) { this.#entries.delete(id); throw error; }
  }

  async resolve(token: string): Promise<{ scope: Readonly<DelegationScope>; value: T }> {
    this.#expire();
    const { payload } = await jwtVerify(token, this.#key, {
      audience, algorithms: ['HS256'], typ: 'JWT', currentDate: new Date(this.#now()),
    });
    const entry = typeof payload.jti === 'string' ? this.#entries.get(payload.jti) : undefined;
    if (!entry || entry.expires <= this.#now() || payload.resource !== entry.scope.analysis ||
      payload.organization !== entry.scope.organization || payload.thread !== entry.scope.thread ||
      payload.exp !== Math.floor(entry.expires / 1000)) throw new Error('This repository question is no longer authorized.');
    return { scope: entry.scope, value: entry.value };
  }

  revokeAnalysis(analysis: string) {
    for (const [id, entry] of this.#entries) if (entry.scope.analysis === analysis) this.#entries.delete(id);
  }
}
