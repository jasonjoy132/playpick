import { useEffect, useRef, useState } from 'react';
import { navigate } from '../lib/router.jsx';
import { criteriaToSearch, hasAnyCriteria } from '../lib/criteria.js';
import { useFinder } from '../lib/finder.jsx';

const EMPTY = { players: null, platforms: [], genres: [] };

export function ChipGroup({ legend, hint, name, type, options, isChecked, onToggle }) {
  return (
    <fieldset className="field">
      <legend>
        {legend} <span className="field-hint">{hint}</span>
      </legend>
      <div className="chips">
        {options.map((o) => (
          <label key={String(o.value)} className="chip">
            <input type={type} name={name} value={o.value} checked={isChecked(o.value)} onChange={() => onToggle(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** 조건 설정(인원·플랫폼·장르) 창 */
export function FinderModal({ options }) {
  const { open, initial, closeFinder } = useFinder();
  const [criteria, setCriteria] = useState(EMPTY);
  const dialogRef = useRef(null);
  const lastFocus = useRef(null);
  // 닫을 때 180ms 동안 사라지는 움직임을 보여 준 뒤 지움
  const [leaving, setLeaving] = useState(false);
  const wasOpen = useRef(open);
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) {
      setLeaving(false);
      return undefined;
    }
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;
    setLeaving(true);
    const t = setTimeout(() => setLeaving(false), 180);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    setCriteria(initial ?? EMPTY);
    lastFocus.current = document.activeElement;
    document.body.classList.add('no-scroll');
    const t = setTimeout(() => dialogRef.current?.querySelector('input')?.focus(), 0);
    const onKey = (e) => {
      if (e.key === 'Escape') closeFinder();
      if (e.key === 'Tab' && dialogRef.current) {
        // 창 안에서만 포커스 이동
        const f = [...dialogRef.current.querySelectorAll('input, button:not([disabled])')];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      lastFocus.current?.focus?.();
    };
  }, [open, initial, closeFinder]);

  if ((!open && !leaving) || !options) return null;
  const ready = hasAnyCriteria(criteria);
  const toggleIn = (key) => (v) =>
    setCriteria((c) => ({ ...c, [key]: c[key].includes(v) ? c[key].filter((x) => x !== v) : [...c[key], v] }));
  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    closeFinder();
    navigate(`/results?${criteriaToSearch(criteria)}`);
  };

  return (
    <div className="modal-backdrop" data-state={open ? 'open' : 'closing'} onMouseDown={(e) => e.target === e.currentTarget && closeFinder()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="finder-title" ref={dialogRef} data-testid="finder">
        <header className="modal-head">
          <div>
            <h2 id="finder-title">나만의 게임 찾기</h2>
            <p className="muted">함께할 인원·플랫폼·장르를 고르면 조건에 맞는 게임을 추천해 드려요.</p>
          </div>
          <button type="button" className="icon-btn" onClick={closeFinder} aria-label="닫기">
            ✕
          </button>
        </header>
        <form className="criteria-form" onSubmit={submit} aria-label="추천 조건 설정">
          <ChipGroup
            legend="함께할 인원"
            hint="하나 선택"
            name="players"
            type="radio"
            options={[{ value: 'any', label: '상관없음' }, ...options.players]}
            isChecked={(v) => (v === 'any' ? criteria.players == null : criteria.players === v)}
            onToggle={(v) => setCriteria((c) => ({ ...c, players: v === 'any' ? null : v }))}
          />
          <ChipGroup legend="플랫폼" hint="여러 개 선택 가능" name="platforms" type="checkbox" options={options.platforms} isChecked={(v) => criteria.platforms.includes(v)} onToggle={toggleIn('platforms')} />
          <ChipGroup legend="선호 장르" hint="여러 개 선택 가능" name="genres" type="checkbox" options={options.genres} isChecked={(v) => criteria.genres.includes(v)} onToggle={toggleIn('genres')} />
          <div className="form-footer">
            <p className="form-help" aria-live="polite">
              {ready ? '선택한 조건으로 게임을 찾아볼게요.' : '인원·플랫폼·장르 중 최소 한 가지를 선택해 주세요.'}
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setCriteria(EMPTY)}>
                초기화
              </button>
              <button type="submit" className="btn btn-primary btn-lg" disabled={!ready}>
                추천 게임 찾기
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
