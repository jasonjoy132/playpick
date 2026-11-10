// 자주 읽고 가끔 바뀌는 DB 값(승인된 제보 등)을 잠깐 기억
//  - 서버리스에서는 인스턴스가 여러 개라 다른 인스턴스에서 바뀐 것을 ttl 안에 다시 읽음
//  - 같은 인스턴스에서 바꾸면 clear() 로 바로 다시 읽음. 동시에 여러 번 불려도 한 번만 읽음
export function cached(load, { ttl = 30_000, now = () => Date.now() } = {}) {
  let hold = null; // { at, p }
  const get = () => {
    if (!hold || now() - hold.at > ttl) {
      const p = load().catch((e) => {
        if (hold?.p === p) hold = null; // 실패는 기억하지 않음
        throw e;
      });
      hold = { at: now(), p };
    }
    return hold.p;
  };
  get.clear = () => {
    hold = null;
  };
  return get;
}
