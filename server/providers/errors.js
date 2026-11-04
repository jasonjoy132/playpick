export class DataSourceError extends Error {
  /**
   * @param {string} code UPSTREAM_ERROR(<error> 응답) | UPSTREAM_HTTP | UPSTREAM_TIMEOUT | UPSTREAM_INVALID | UPSTREAM_NETWORK | NOT_IMPLEMENTED
   * @param {string} message 사용자에게 보여줄 수 있는 메시지(키·URL 등 민감 정보 포함 금지)
   */
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * fetch 실패 원인을 짧게 (원인 파악용. 주소·키는 넣지 않음)
 *  예: '20초 안에 응답 없음', 'ENOTFOUND(주소를 찾지 못함)', 'ECONNRESET(연결 끊김)'
 */
export function netReason(e, timeoutMs) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `${Math.round(timeoutMs / 1000)}초 안에 응답 없음`;
  const code = e?.cause?.code || e?.code;
  const known = {
    ENOTFOUND: '주소를 찾지 못함(DNS)',
    ECONNRESET: '연결 끊김',
    ECONNREFUSED: '연결 거부',
    ETIMEDOUT: '연결 시간 초과',
    UND_ERR_CONNECT_TIMEOUT: '연결 시간 초과',
    UND_ERR_SOCKET: '연결 끊김',
    CERT_HAS_EXPIRED: '인증서 오류',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: '인증서 확인 실패(보안 프로그램·프록시?)',
    SELF_SIGNED_CERT_IN_CHAIN: '인증서 확인 실패(보안 프로그램·프록시?)',
  };
  if (code) return `${code}${known[code] ? `: ${known[code]}` : ''}`;
  return String(e?.cause?.message || e?.message || '알 수 없는 오류').slice(0, 120);
}
