// 플레이픽 로고: 'P' 안에 재생(▶) 표시
export function LogoMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id="pp-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2d58a" />
          <stop offset="1" stopColor="#c99a3b" />
        </linearGradient>
      </defs>
      <path d="M7 4h11a9 9 0 0 1 0 18h-5v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4z" fill="url(#pp-gold)" />
      <path d="M14 9.2v7.6c0 .6.6.9 1.1.6l5.8-3.8a.7.7 0 0 0 0-1.2l-5.8-3.8c-.5-.3-1.1 0-1.1.6z" fill="#fff" />
    </svg>
  );
}

export function Logo({ size = 30 }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-text">
        Play<span className="logo-pick">Pick</span>
      </span>
    </span>
  );
}
