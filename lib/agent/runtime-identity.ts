import { randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export function appOrigin(): string {
  const url = new URL(process.env.CARTOGRAPH_APP_ORIGIN ?? 'http://127.0.0.1:3000');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('The agent requires a fixed loopback app origin.');
  return url.origin;
}

export class RuntimeIdentity {
  readonly #kid = randomBytes(16).toString('hex');
  readonly #keys = generateKeyPair('ES256');

  async jwks() {
    const { publicKey } = await this.#keys;
    return { keys: [{ ...await exportJWK(publicKey), kid: this.#kid, alg: 'ES256', use: 'sig' }] };
  }

  async issue(principal: string, thread: string, expires: number): Promise<string> {
    const { privateKey } = await this.#keys;
    return new SignJWT({ cartograph_thread: thread }).setProtectedHeader({ alg: 'ES256', kid: this.#kid, typ: 'JWT' })
      .setIssuer(appOrigin()).setAudience('cartograph-runtime').setSubject(principal)
      .setIssuedAt().setExpirationTime(Math.floor(expires / 1000)).sign(privateKey);
  }
}
