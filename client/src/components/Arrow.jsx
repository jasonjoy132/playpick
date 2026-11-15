/** 글자 대신 쓰는 화살표 (버튼·링크와 같은 선 모양). dir: 'left' | 'right' */
export function Arrow({ dir = 'right', size = 16, className = 'link-arrow' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'M19 12H5M11 6l-6 6 6 6' : 'M5 12h14M13 6l6 6-6 6'} />
    </svg>
  );
}
