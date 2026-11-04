const STEPS = ['조건 설정', '게임 매칭', '추천 목록', '상세·구매처'];

export function Steps({ current }) {
  return (
    <ol className="steps" aria-label="이용 단계">
      {STEPS.map((s, i) => (
        <li key={s} className={i === current ? 'is-current' : i < current ? 'is-done' : ''} aria-current={i === current ? 'step' : undefined}>
          <span className="step-no">{i + 1}</span>
          <span className="step-label">{s}</span>
        </li>
      ))}
    </ol>
  );
}
