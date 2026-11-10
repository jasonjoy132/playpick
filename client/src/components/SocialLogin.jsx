// 다른 계정으로 로그인 버튼 (Google · Discord)
//  - 서버에 키가 있는 제공자만 보임(/api/auth/providers)
//  - 버튼은 서버 주소로 '페이지 이동'(제공자 화면 → 서버 → 원래 화면)
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useLocation } from '../lib/router.jsx';

export const PROVIDER_LABEL = { google: 'Google', discord: 'Discord' };

let providersOnce = null; // 한 번만 받아 두고 같이 씀
const loadProviders = () => (providersOnce ??= api.providers().then((r) => r.providers).catch(() => ((providersOnce = null), [])));

export function GoogleMark({ size = 18 }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function DiscordMark({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.1.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
      />
    </svg>
  );
}
export const ProviderMark = ({ provider, size }) => (provider === 'google' ? <GoogleMark size={size} /> : <DiscordMark size={size} />);

/** 서버가 돌려보낸 오류 코드 → 안내 문구 */
export function oauthErrorText(code, provider) {
  const p = PROVIDER_LABEL[provider] ?? '다른';
  return (
    {
      OAUTH_DENIED: `${p} 로그인을 취소했어요.`,
      OAUTH_STATE: '로그인 확인 시간이 지났어요. 다시 시도해 주세요.',
      OAUTH_EMAIL_UNVERIFIED: `${p} 계정에 인증된 이메일이 없어요. ${p}에서 이메일을 인증한 뒤 다시 시도하거나, 아이디로 가입해 주세요.`,
      OAUTH_TAKEN: `이 ${p} 계정은 이미 다른 회원과 연결되어 있어요.`,
      OAUTH_DISABLED: `지금은 ${p} 계정으로 로그인할 수 없어요.`,
      RATE_LIMIT: '시도가 너무 많아요. 잠시 후 다시 시도해 주세요.',
    }[code] ?? `${p} 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.`
  );
}

export const oauthStartUrl = (provider, { next, mode } = {}) => {
  const qs = new URLSearchParams({ ...(next ? { next } : {}), ...(mode ? { mode } : {}) }).toString();
  return `/api/auth/oauth/${provider}/start${qs ? `?${qs}` : ''}`;
};

/** 'Google로 계속하기' · 'Discord로 계속하기' (키가 없으면 아무것도 안 보임) */
export function SocialButtons({ next, divider = '또는', below = null, className = '' }) {
  const { pathname, search } = useLocation();
  const { data: providers } = useAsync(loadProviders, []);
  if (!providers?.length) return null;
  // 돌아갈 화면: 지정한 곳, 없으면 지금 화면(로그인·가입 화면이면 홈)
  const here = /^\/(login|signup)/.test(pathname) ? '/' : `${pathname}${search || ''}`;
  const to = next || here;
  return (
    <div className={`social-login ${className}`} data-testid="social-login">
      {divider && (
        <p className="social-divider">
          <span>{divider}</span>
        </p>
      )}
      {providers.map((p) => (
        <a key={p} href={oauthStartUrl(p, { next: to })} className={`social-btn social-${p}`} data-testid={`social-${p}`}>
          <ProviderMark provider={p} />
          <span>{PROVIDER_LABEL[p]}로 계속하기</span>
        </a>
      ))}
      {below && (
        <p className="social-divider">
          <span>{below}</span>
        </p>
      )}
    </div>
  );
}

export { loadProviders };
