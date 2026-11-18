// 화면(HTML) 보안 정책 — vercel.json 의 headers 와 같은 값이어야 함(test/csp.test.js 가 확인)
// script-src: 우리 파일(/app.js)과 client/index.html 의 다크 모드 인라인 스크립트(해시)만 실행 → XSS가 생겨도 남의 스크립트는 못 돎
// 인라인 스크립트를 고치면 해시도 바꿔야 함: test/csp.test.js 가 실패하며 새 해시를 알려 줌
export const THEME_SCRIPT_HASH = "'sha256-B7d3PEEr8qyyT/7Msfv3ZRPjMC76V4BIZGjVtBrgFPk='";
export const PAGE_CSP = `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; script-src 'self' ${THEME_SCRIPT_HASH}`;
