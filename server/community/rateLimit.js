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
