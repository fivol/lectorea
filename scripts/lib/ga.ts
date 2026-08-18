import fs from 'node:fs';
import path from 'node:path';
import { createSign } from 'node:crypto';
import { paths } from './config.js';

/**
 * Talking to Google Analytics as the service account in `keys/`.
 *
 * A JWT signed with the account's private key, exchanged for an access token —
 * which is the whole of what `google-auth-library` does for this use, and that
 * package pulls in a dependency tree the size of the frontend's. Thirty lines
 * against thirty megabytes, in a repository whose only other Google client is
 * a `fetch` against the YouTube API for the same reason.
 *
 * The key file is **never** committed: `keys/` is in `.gitignore` and the whole
 * of what it grants is administrative access to the analytics property. Nothing
 * here prints it, and the deploy does not need it — the frontend is given a
 * measurement id, which is public by construction.
 */

export type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

/** Where the key lives, unless `GA4_KEY_FILE` says otherwise. */
export function keyFile(): string {
  return process.env.GA4_KEY_FILE ?? path.join(paths.root, 'keys/ga4-admin.json');
}

export function readServiceAccount(): ServiceAccount {
  const file = keyFile();
  if (!fs.existsSync(file)) {
    throw new Error(
      `нет ключа сервис-аккаунта: ${file}\n` +
        'Google Cloud → IAM → Service accounts → Keys → Add key (JSON), см. docs/analytics.md'
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ServiceAccount;
}

const base64url = (value: string | object): string =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** An access token for one scope, good for an hour — longer than any run here. */
export async function accessToken(scope: string): Promise<string> {
  const key = readServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({
    iss: key.client_email,
    scope,
    aud: key.token_uri,
    exp: now + 3600,
    iat: now,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');

  const response = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`не удалось получить токен: ${body.error_description ?? response.status}`);
  }
  return body.access_token;
}

export type Admin = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  body?: unknown
) => Promise<Record<string, unknown>>;

/**
 * A caller for the Analytics Admin API, holding one token.
 *
 * `v1beta` is the stable surface and covers accounts, properties, streams and
 * the custom dimensions and metrics. A few property-wide settings — data
 * retention, Google signals — exist only under `v1alpha`, so the path is passed
 * whole rather than assumed, and a caller that wants one of those says so.
 */
export async function adminApi(): Promise<Admin> {
  const token = await accessToken('https://www.googleapis.com/auth/analytics.edit');
  return async (method, url, body) => {
    const response = await fetch(`https://analyticsadmin.googleapis.com/${url}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      const error = parsed.error as { message?: string } | undefined;
      throw new Error(`${method} ${url}: ${error?.message ?? response.status}`);
    }
    return parsed;
  };
}
