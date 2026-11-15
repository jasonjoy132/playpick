// 간단한 메모리 기반 호출 제한 (무차별 대입 방지)
export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return {
    /** @returns {boolean} 허용 여부 */
    hit(key) {
      const t = now();
      const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
      arr.push(t);
      hits.set(key, arr);
      if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
      return arr.length <= limit;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

/**
 * DB 기반 호출 제한 — 서버리스(Vercel)는 인스턴스가 여러 개이고 자주 새로 켜져서 메모리 기록이 나뉘거나 사라짐.
 * 로그인·메일·가입처럼 무차별 대입을 막아야 하는 곳에 씀. 한 번에(batch) 오래된 기록 지우기 → 기록 → 세기
 */
export function createDbRateLimiter(db, { name, limit, windowMs, now = () => Date.now() }) {
  let lastPurge = 0;
  return {
    async hit(key) {
      const t = now();
      const k = `${name}|${key}`;
      const list = [
        ['DELETE FROM rate_hits WHERE key = ? AND at <= ?', [k, t - windowMs]],
        ['INSERT INTO rate_hits (key, at) VALUES (?, ?)', [k, t]],
        ['SELECT COUNT(*) AS n FROM rate_hits WHERE key = ?', [k]],
      ];
      // 가끔 모든 키의 하루 지난 기록 정리
      if (t - lastPurge > 3600e3) {
        lastPurge = t;
        list.unshift(['DELETE FROM rate_hits WHERE at <= ?', [t - 86400e3]]);
      }
      const res = await db.batch(list);
      return Number(res.at(-1).rows[0].n) <= limit;
    },
    async reset(key) {
      await db.prepare('DELETE FROM rate_hits WHERE key = ?').run(`${name}|${key}`);
    },
  };
}
