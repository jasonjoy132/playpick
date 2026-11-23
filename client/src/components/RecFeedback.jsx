// 추천 만족도(원페이저 성과 지표): "이 추천이 도움이 됐나요?" 한 줄. 같은 조건은 한 번만 물음(서버도 거름)
import { useState } from 'react';
import { track } from '../lib/track.js';

const KEY = 'pp_feedback';
function answered() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function RecFeedback({ qs }) {
  const [done, setDone] = useState(() => answered().includes(qs));
  const [justSent, setJustSent] = useState(false);
  if (done && !justSent) return null;
  const send = (value) => {
    track('feedback', { value, q: qs });
    try {
      localStorage.setItem(KEY, JSON.stringify([...answered().filter((x) => x !== qs), qs].slice(-50)));
    } catch {
      /* 저장 못 해도 이번 화면에선 닫힘 */
    }
    setDone(true);
    setJustSent(true);
  };
  return (
    <div className="rec-feedback" data-testid="rec-feedback" aria-live="polite">
      {justSent ? (
        <p className="muted">답해 주셔서 고마워요. 추천을 고치는 데 쓸게요.</p>
      ) : (
        <>
          <p>이 추천이 도움이 됐나요?</p>
          <div className="rec-feedback-btns">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => send('up')} data-testid="feedback-up">
              도움 됐어요
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => send('down')} data-testid="feedback-down">
              별로예요
            </button>
          </div>
        </>
      )}
    </div>
  );
}
