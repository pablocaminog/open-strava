/**
 * Minimal OAuth1.0a (RFC 5849) HMAC-SHA1 client for Cloudflare Workers.
 * Garmin Connect Developer / Health API still use OAuth1.0a.
 *
 * Supports 3-legged flow: request_token, access_token, and signed
 * resource calls. Signs against a (consumerSecret, tokenSecret) pair.
 */

const ENC = (s: string) =>
  encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');

export interface OAuth1Creds {
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
}

export interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

export async function signOAuth1(
  creds: OAuth1Creds,
  method: string,
  url: string,
  extraOAuthParams: Record<string, string> = {},
  bodyParams: Record<string, string> = {},
): Promise<SignedRequest> {
  const u = new URL(url);
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...extraOAuthParams,
  };
  if (creds.token) oauthParams.oauth_token = creds.token;

  const allParams: Record<string, string> = { ...oauthParams, ...bodyParams };
  u.searchParams.forEach((v, k) => {
    allParams[k] = v;
  });

  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${ENC(k)}=${ENC(allParams[k]!)}`)
    .join('&');

  const baseString = [method.toUpperCase(), ENC(baseUrl), ENC(paramString)].join('&');
  const signingKey = `${ENC(creds.consumerSecret)}&${ENC(creds.tokenSecret ?? '')}`;

  const signature = await hmacSha1(signingKey, baseString);
  oauthParams.oauth_signature = signature;

  const authHeader =
    'OAuth ' +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${ENC(k)}="${ENC(oauthParams[k]!)}"`)
      .join(', ');

  return { url, method: method.toUpperCase(), headers: { Authorization: authHeader } };
}

async function hmacSha1(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function parseFormBody(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) {
      out[decodeURIComponent(pair)] = '';
    } else {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return out;
}
