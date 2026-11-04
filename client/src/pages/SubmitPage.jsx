// 게임 제보 (로그인한 회원). 관리자가 승인하면 게임으로 추가됩니다.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Link } from '../lib/router.jsx';
import { toCoverDataUrl } from '../lib/image.js';
import { ChipGroup } from '../components/FinderModal.jsx';
import { Loading } from '../components/Status.jsx';

const EMPTY = { title: '', originalTitle: '', platforms: [], genres: [], playersMin: '', playersMax: '', storeUrl: '', publisher: '', releaseYear: '', summary: '' };

export function SubmitPage({ options }) {
  const { user, ready } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [image, setImage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [similar, setSimilar] = useState([]);
  const fileRef = useRef(null);

  // 이미 있는 게임인지 미리 보여 주기 (이름 입력 후 0.6초 뒤 검색)
  useEffect(() => {
    const q = form.title.trim();
    if (q.length < 2) return setSimilar([]);
    const t = setTimeout(() => {
      api.search(q).then((r) => setSimilar(r.games.slice(0, 5))).catch(() => setSimilar([]));
    }, 600);
    return () => clearTimeout(t);
  }, [form.title]);

  if (!ready) return <Loading />;
  if (!user) {
    return (
      <div className="state">
        <h1>로그인이 필요해요</h1>
        <p className="muted">게임 제보는 로그인한 회원만 할 수 있어요.</p>
        <Link to={`/login?next=${encodeURIComponent('/submit')}`} className="btn btn-gold">
          로그인
        </Link>
      </div>
    );
  }
  if (done) {
    return (
      <div className="state" data-testid="submit-done">
        <h1>제보해 주셔서 고마워요!</h1>
        <p className="muted">
          ‘{done.title}’ 제보를 받았어요. 관리자가 확인한 뒤 승인하면 플레이픽에 추가돼요.
          <br />
          결과는 마이페이지 ‘내 제보’에서 볼 수 있어요.
        </p>
        <div className="form-actions">
          <Link to="/mypage/submissions" className="btn btn-primary">
            내 제보 보기
          </Link>
          <button type="button" className="btn btn-ghost" onClick={() => { setDone(null); setForm(EMPTY); setImage(null); }}>
            다른 게임 제보하기
          </button>
        </div>
      </div>
    );
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (k) => (v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      setImage(await toCoverDataUrl(file));
    } catch (err) {
      setError(err.message);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.submitGame({ ...form, image: image || undefined });
      setDone(r.item);
      window.scrollTo?.(0, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="submit-page">
      <section className="page-head">
        <h1>게임 제보</h1>
        <p className="muted">플레이픽에 없는 게임을 알려 주세요. 관리자가 확인한 뒤 승인하면 추가돼요. <b>*</b> 는 필수예요.</p>
      </section>
      <form className="submit-form panel" onSubmit={submit} aria-label="게임 제보" data-testid="submit-form">
        <div className="form-field">
          <label htmlFor="s-title">게임 이름 *</label>
          <input id="s-title" value={form.title} onChange={set('title')} maxLength={80} required placeholder="예: 로스트아크" />
        </div>
        {similar.length > 0 && (
          <div className="similar" role="status" data-testid="similar">
            <p className="small">이미 있는 게임일 수 있어요. 먼저 확인해 주세요.</p>
            <ul>
              {similar.map((g) => (
                <li key={g.id}>
                  <Link to={`/games/${encodeURIComponent(g.id)}`}>{g.title}</Link>
                  {g.originalTitle && <span className="muted small"> {g.originalTitle}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="form-field">
          <label htmlFor="s-orig">영문(원제) 이름</label>
          <input id="s-orig" value={form.originalTitle} onChange={set('originalTitle')} maxLength={80} placeholder="예: Lost Ark" />
        </div>
        <ChipGroup legend="플랫폼 *" hint="여러 개 선택 가능" name="s-platforms" type="checkbox" options={options.platforms} isChecked={(v) => form.platforms.includes(v)} onToggle={toggle('platforms')} />
        <ChipGroup legend="장르 *" hint="여러 개 선택 가능" name="s-genres" type="checkbox" options={options.genres} isChecked={(v) => form.genres.includes(v)} onToggle={toggle('genres')} />
        <fieldset className="field">
          <legend>
            추천 인원 <span className="field-hint">친구들과 한 팀으로 같이 하는 인원</span>
          </legend>
          <div className="range-inputs">
            <input type="number" min="1" max="100" inputMode="numeric" value={form.playersMin} onChange={set('playersMin')} aria-label="최소 인원" placeholder="최소" />
            <span>~</span>
            <input type="number" min="1" max="100" inputMode="numeric" value={form.playersMax} onChange={set('playersMax')} aria-label="최대 인원" placeholder="최대" />
            <span>명</span>
          </div>
        </fieldset>
        <div className="form-field">
          <label htmlFor="s-store">구매처 링크</label>
          <input id="s-store" type="url" value={form.storeUrl} onChange={set('storeUrl')} placeholder="https://store.steampowered.com/app/…" />
          <p className="field-note">Steam·App Store·Google Play·닌텐도·PlayStation·Xbox·Epic 등 공식 스토어 주소만 넣을 수 있어요.</p>
        </div>
        <div className="form-row">
          <div className="form-field">
            <label htmlFor="s-pub">개발·유통사</label>
            <input id="s-pub" value={form.publisher} onChange={set('publisher')} maxLength={60} />
          </div>
          <div className="form-field">
            <label htmlFor="s-year">출시 연도</label>
            <input id="s-year" type="number" min="1970" max="2100" inputMode="numeric" value={form.releaseYear} onChange={set('releaseYear')} placeholder="예: 2019" />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="s-summary">소개</label>
          <textarea id="s-summary" value={form.summary} onChange={set('summary')} maxLength={1000} rows={5} placeholder="어떤 게임인지 간단히 알려 주세요." />
          <p className="field-note">{form.summary.length} / 1000</p>
        </div>
        <div className="form-field">
          <span className="label">표지 이미지</span>
          <div className="cover-pick">
            {image ? <img src={image} alt="선택한 표지 미리보기" className="cover-preview" /> : <div className="cover-preview cover-empty"><span className="cover-empty-note">이미지 없음</span></div>}
            <div className="avatar-actions">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pick} hidden data-testid="cover-input" />
              <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                이미지 선택
              </button>
              {image && (
                <button type="button" className="btn btn-ghost" onClick={() => setImage(null)}>
                  빼기
                </button>
              )}
              <p className="field-note">직접 찍었거나 공식 이미지처럼 써도 되는 이미지만 올려 주세요.</p>
            </div>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-gold btn-lg" disabled={busy} data-testid="submit-game">
            {busy ? '보내는 중…' : '제보하기'}
          </button>
        </div>
      </form>
    </div>
  );
}
