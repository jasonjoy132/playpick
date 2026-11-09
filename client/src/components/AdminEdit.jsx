// 관리자 '고쳐서 승인': 회원이 낸 값이 채워진 칸에서 틀린 것만 고침. 바뀐 칸은 강조 + 아래에 미리보기
// EditedList: 관리자가 고친 내용(원래 값 → 반영 값) — 관리자 카드·회원 '내 제보'에서 같이 씀
import { useState } from 'react';
import { ChipGroup } from './FinderModal.jsx';

const str = (v) => (v == null ? '' : String(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 관리자가 고친 칸 목록 (원래 → 반영) */
export function EditedList({ edited, title = '관리자가 고친 내용' }) {
  if (!edited?.length) return null;
  return (
    <div className="edited" data-testid="edited">
      <p className="edited-title">{title}</p>
      <ul>
        {edited.map((c) => (
          <li key={c.field}>
            <span className="edited-label">{c.label}</span> <del>{c.from}</del> <span aria-hidden="true">→</span> <ins>{c.to}</ins>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Actions({ busy, changed, submitLabel, onCancel, onSubmit, testid }) {
  return (
    <div className="form-actions">
      <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
        취소
      </button>
      <button type="button" className="btn btn-primary" disabled={busy || !changed} onClick={onSubmit} data-testid={testid}>
        {changed ? submitLabel : '바뀐 내용이 없어요'}
      </button>
    </div>
  );
}

function Field({ id, label, changed, children, note }) {
  return (
    <div className={`form-field${changed ? ' is-changed' : ''}`}>
      <label htmlFor={id}>
        {label}
        {changed && <span className="changed-tag">수정</span>}
      </label>
      {children}
      {note && <p className="field-note">{note}</p>}
    </div>
  );
}

/** 게임 제보 고치기 */
export function SubmissionEditForm({ item, options, busy, submitLabel, onSubmit, onCancel }) {
  const init = {
    title: str(item.title),
    originalTitle: str(item.originalTitle),
    publisher: str(item.publisher),
    releaseYear: str(item.releaseYear),
    platforms: item.platforms ?? [],
    genres: item.genres ?? [],
    playersMin: str(item.playersMin),
    playersMax: str(item.playersMax),
    storeUrl: str(item.storeUrl),
    summary: str(item.summary),
  };
  const [f, setF] = useState(init);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (k) => (v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const diff = (k) => !same(f[k], init[k]);
  const keys = Object.keys(init);
  const changedKeys = keys.filter(diff);
  const playersChanged = diff('playersMin') || diff('playersMax');
  const pre = `edit-${item.id}`;
  return (
    <div className="admin-edit" data-testid="edit-form">
      <p className="admin-edit-head">틀린 칸만 고쳐 주세요. 고친 내용은 제보한 회원에게 알림으로 알려 줘요.</p>
      <Field id={`${pre}-title`} label="게임 이름" changed={diff('title')}>
        <input id={`${pre}-title`} value={f.title} onChange={set('title')} maxLength={80} />
      </Field>
      <div className="form-row">
        <Field id={`${pre}-orig`} label="영문(원제) 이름" changed={diff('originalTitle')}>
          <input id={`${pre}-orig`} value={f.originalTitle} onChange={set('originalTitle')} maxLength={80} />
        </Field>
        <Field id={`${pre}-year`} label="출시 연도" changed={diff('releaseYear')}>
          <input id={`${pre}-year`} type="number" inputMode="numeric" value={f.releaseYear} onChange={set('releaseYear')} />
        </Field>
      </div>
      <Field id={`${pre}-pub`} label="개발·유통사" changed={diff('publisher')}>
        <input id={`${pre}-pub`} value={f.publisher} onChange={set('publisher')} maxLength={60} />
      </Field>
      <div className={diff('platforms') ? 'is-changed' : ''}>
        <ChipGroup legend="플랫폼" hint={diff('platforms') ? '수정' : ''} name={`${pre}-pf`} type="checkbox" options={options.platforms} isChecked={(v) => f.platforms.includes(v)} onToggle={toggle('platforms')} />
      </div>
      <div className={diff('genres') ? 'is-changed' : ''}>
        <ChipGroup legend="장르" hint={diff('genres') ? '수정' : ''} name={`${pre}-gn`} type="checkbox" options={options.genres} isChecked={(v) => f.genres.includes(v)} onToggle={toggle('genres')} />
      </div>
      <fieldset className={`field${playersChanged ? ' is-changed' : ''}`}>
        <legend>
          추천 인원 {playersChanged && <span className="changed-tag">수정</span>}
        </legend>
        <div className="range-inputs">
          <input type="number" min="1" max="100" inputMode="numeric" value={f.playersMin} onChange={set('playersMin')} aria-label="고칠 최소 인원" placeholder="최소" />
          <span>~</span>
          <input type="number" min="1" max="100" inputMode="numeric" value={f.playersMax} onChange={set('playersMax')} aria-label="고칠 최대 인원" placeholder="최대" />
          <span>명</span>
        </div>
      </fieldset>
      <Field id={`${pre}-store`} label="구매처 링크" changed={diff('storeUrl')} note="공식 스토어 주소만 돼요. 비우면 구매처 없음.">
        <input id={`${pre}-store`} type="url" value={f.storeUrl} onChange={set('storeUrl')} />
      </Field>
      <Field id={`${pre}-sum`} label="소개" changed={diff('summary')}>
        <textarea id={`${pre}-sum`} rows={3} maxLength={1000} value={f.summary} onChange={set('summary')} />
      </Field>
      <p className="admin-edit-count" role="status">
        {changedKeys.length ? `바뀐 칸 ${new Set(changedKeys.map((k) => (k.startsWith('players') ? 'players' : k))).size}개` : '아직 바뀐 칸이 없어요'}
      </p>
      <Actions
        busy={busy}
        changed={changedKeys.length > 0}
        submitLabel={submitLabel}
        onCancel={onCancel}
        testid="confirm-edit"
        onSubmit={() => {
          const edits = {};
          for (const k of changedKeys) edits[k] = f[k];
          if (playersChanged) Object.assign(edits, { playersMin: f.playersMin, playersMax: f.playersMax });
          onSubmit(edits);
        }}
      />
    </div>
  );
}

/** 정보 수정 제보 고치기 (비운 칸은 반영하지 않음) */
export function FixEditForm({ item, busy, submitLabel, onSubmit, onCancel }) {
  const fx = item.fix || {};
  const init = { playersMin: str(fx.players?.min), playersMax: str(fx.players?.max), hours: str(fx.hours), storeUrl: str(fx.storeUrl) };
  const [f, setF] = useState(init);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const diff = (k) => f[k] !== init[k];
  const playersChanged = diff('playersMin') || diff('playersMax');
  const changed = Object.keys(init).some(diff);
  const pre = `fix-${item.id}`;
  return (
    <div className="admin-edit" data-testid="edit-form">
      <p className="admin-edit-head">틀린 값만 고쳐 주세요. 칸을 비우면 그 항목은 반영하지 않아요.</p>
      <fieldset className={`field${playersChanged ? ' is-changed' : ''}`}>
        <legend>
          추천 인원 {playersChanged && <span className="changed-tag">수정</span>}
        </legend>
        <div className="range-inputs">
          <input type="number" min="1" max="100" inputMode="numeric" value={f.playersMin} onChange={set('playersMin')} aria-label="고칠 최소 인원" placeholder="최소" />
          <span>~</span>
          <input type="number" min="1" max="100" inputMode="numeric" value={f.playersMax} onChange={set('playersMax')} aria-label="고칠 최대 인원" placeholder="최대" />
          <span>명</span>
        </div>
      </fieldset>
      <div className="form-row">
        <Field id={`${pre}-hours`} label="플레이 시간(시간)" changed={diff('hours')}>
          <input id={`${pre}-hours`} type="number" min="1" max="1000" inputMode="numeric" value={f.hours} onChange={set('hours')} />
        </Field>
        <span />
      </div>
      <Field id={`${pre}-store`} label="구매처 링크" changed={diff('storeUrl')} note="공식 스토어 주소만 돼요.">
        <input id={`${pre}-store`} type="url" value={f.storeUrl} onChange={set('storeUrl')} />
      </Field>
      <Actions busy={busy} changed={changed} submitLabel={submitLabel} onCancel={onCancel} testid="confirm-edit" onSubmit={() => onSubmit({ ...f })} />
    </div>
  );
}
