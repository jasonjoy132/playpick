// '더 보기' 자동 불러오기: 버튼이 화면 아래쪽에 가까워지면(스크롤을 끝까지 내리면) 저절로 눌림
//  - 버튼은 그대로 남겨 둠(키보드·자동이 멈췄을 때·오류가 났을 때 직접 누르기)
//  - 오류가 나면 자동으로 다시 부르지 않음(무한 재시도 방지)
//  - maxAuto: 자동으로 불러올 최대 횟수. 아래에 다른 섹션이 있는 목록은 몇 번만 자동으로 하고 그다음은 버튼으로
import { useEffect, useRef } from 'react';

export function AutoMore({ onMore, busy = false, error = null, maxAuto = Infinity, watch, testid, children }) {
  const ref = useRef(null);
  const count = useRef(0);
  const cb = useRef(onMore);
  cb.current = onMore;
  const auto = !busy && !error && count.current < maxAuto;

  useEffect(() => {
    if (!auto) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    let fired = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (fired || !entries.some((e) => e.isIntersecting)) return;
        fired = true; // 한 번 관찰에 한 번만 (불러온 뒤 다시 관찰)
        count.current++;
        cb.current();
      },
      { rootMargin: '0px 0px 300px 0px' }, // 버튼이 보이기 조금 전에 미리
    );
    io.observe(el);
    return () => io.disconnect();
    // watch: 목록 길이가 바뀌면 다시 관찰(불러온 뒤에도 버튼이 아직 보이면 이어서 불러옴)
  }, [auto, watch]);

  return (
    <div className="more" ref={ref}>
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={onMore} data-testid={testid}>
        {busy ? '불러오는 중…' : children}
      </button>
    </div>
  );
}
