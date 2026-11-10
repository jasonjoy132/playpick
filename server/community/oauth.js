// 다른 계정으로 로그인 (Google · Discord, OAuth 2.0 '인가 코드' 방식)
//  - 서버가 제공자 화면으로 보냈다가(start) 돌아온 코드(callback)를 서버에서 토큰으로 바꿔 프로필을 받음
//  - Client Secret 은 서버(.env)에만. 브라우저에는 제공자 이름만 알려 줌
//  - 위조 방지: start 때 만든 무작위 state 를 HttpOnly 쿠키에 두고, 돌아온 state 와 같을 때만 진행
import crypto from 'node:crypto';
import { DataSourceError } from '../providers/errors.js';

export const PROVIDERS = {
  google: {
    label: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    extra: { prompt: 'select_account' },
    profile: (j) => ({ subject: j.sub, email: j.email, verified: j.email_verified === true || j.email_verified === 'true', name: j.name || j.given_name }),
  },
  discord: {
    label: 'Discord',
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    userinfo: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    extra: { prompt: 'consent' },
    profile: (j) => ({ subject: j.id, email: j.email, verified: j.verified === true, name: j.global_name || j.username }),
  },
};
export const providerLabel = (p) => PROVIDERS[p]?.label ?? p;

const fail = (code, message, status = 400) => new DataSourceError(code, message, status);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString('utf8');
/** 돌아갈 화면 주소: 우리 사이트 안의 경로만 */
export const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n.slice(0, 300) : '/');

/**
 * @param {{ google?: {clientId, clientSecret}, discord?: {clientId, clientSecret} }} cfg
 * @param {{ baseUrl: string, fetchImpl?: typeof fetch, endpoints?: object }} opt  endpoints: 테스트에서 제공자 주소 바꾸기
 */
export function createOAuth(cfg = {}, { baseUrl, fetchImpl = globalThis.fetch, endpoints = {} } = {}) {
  const enabled = Object.keys(PROVIDERS).filter((p) => cfg[p]?.clientId && cfg[p]?.clientSecret);
  const ep = (p) => ({ ...PROVIDERS[p], ...(endpoints[p] ?? {}) });
  const redirectUri = (p) => `${baseUrl}/api/auth/oauth/${p}/callback`;

  return {
    enabled,
    has: (p) => enabled.includes(p),

    /** 제공자 로그인 화면 주소 + 쿠키에 둘 값 (mode: login | link) */
    start(p, { next, mode = 'login' } = {}) {
      if (!enabled.includes(p)) throw fail('OAUTH_DISABLED', '지금은 이 계정으로 로그인할 수 없어요.');
      const state = crypto.randomBytes(16).toString('base64url');
      const e = ep(p);
      const url = new URL(e.authorize);
      for (const [k, v] of Object.entries({ client_id: cfg[p].clientId, redirect_uri: redirectUri(p), response_type: 'code', scope: e.scope, state, ...e.extra })) url.searchParams.set(k, v);
      return { url: url.toString(), cookie: [p, state, mode === 'link' ? 'link' : 'login', b64(safeNext(next))].join('.') };
    },

    /** 쿠키 값 풀기 (모양이 틀리면 null) */
    readCookie(value) {
      const [p, state, mode, next] = String(value || '').split('.');
      if (!PROVIDERS[p] || !state || !mode) return null;
      let n = '/';
      try {
        n = safeNext(unb64(next));
      } catch {
        /* 기본값 */
      }
      return { provider: p, state, mode, next: n };
    },

    /** 돌아온 코드 → 토큰 → 프로필 { provider, subject, email, verified, name } */
    async finish(p, code) {
      if (!enabled.includes(p)) throw fail('OAUTH_DISABLED', '지금은 이 계정으로 로그인할 수 없어요.');
      if (!code) throw fail('OAUTH_FAILED', '로그인이 취소되었거나 실패했어요.');
      const e = ep(p);
      const body = new URLSearchParams({ client_id: cfg[p].clientId, client_secret: cfg[p].clientSecret, code: String(code), grant_type: 'authorization_code', redirect_uri: redirectUri(p) });
      let tok;
      try {
        const res = await fetchImpl(e.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
        tok = await res.json().catch(() => null);
        if (!res.ok || !tok?.access_token) {
          console.log(`[playpick:oauth] ${p} 토큰 교환 실패 HTTP ${res.status} ${String(tok?.error ?? '').slice(0, 80)}`);
          throw fail('OAUTH_FAILED', '로그인에 실패했어요. 다시 시도해 주세요.', 502);
        }
      } catch (err) {
        if (err instanceof DataSourceError) throw err;
        throw fail('OAUTH_FAILED', '로그인 서버에 연결하지 못했어요. 다시 시도해 주세요.', 502);
      }
      let info;
      try {
        const res = await fetchImpl(e.userinfo, { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
        info = res.ok ? await res.json().catch(() => null) : null;
      } catch {
        info = null;
      }
      const prof = info ? e.profile(info) : null;
      if (!prof?.subject) throw fail('OAUTH_FAILED', '계정 정보를 받지 못했어요. 다시 시도해 주세요.', 502);
      return { provider: p, subject: String(prof.subject), email: prof.email ? String(prof.email).trim().toLowerCase() : null, verified: Boolean(prof.verified && prof.email), name: prof.name ? String(prof.name) : '' };
    },
  };
}
