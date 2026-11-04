import { useState } from 'react';
import { Link, navigate, useLocation } from '../lib/router.jsx';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { LoginPanel } from '../components/LoginPanel.jsx';

const safeNext = (search) => {
  const n = new URLSearchParams(search).get('next') || '/';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/';
};

function Field({ label, hint, error, ...props }) {
  const id = `f-${props.name}`;
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={Boolean(error)} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint && (
        <p id={`${id}-hint`} className="field-note">
          {hint}
        </p>
      )}
    </div>
  );
}

function Shell({ title, desc, children, footer }) {
  return (
    <div className="auth-page">
      <section className="auth-card">
        <h1>{title}</h1>
        {desc && <p className="muted">{desc}</p>}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </section>
    </div>
  );
}

export function LoginPage() {
  const { user } = useAuth();
  const { search } = useLocation();
  const next = safeNext(search);
  if (user) {
    return (
      <Shell title="이미 로그인했어요" footer={<Link to={next}>계속하기 →</Link>}>
        <p>{user.nickname}님으로 로그인되어 있습니다.</p>
      </Shell>
    );
  }
  return (
    <div className="auth-page">
      <LoginPanel next={next} />
    </div>
  );
}

export function SignupPage() {
  const { signup } = useAuth();
  const [f, setF] = useState({ loginId: '', password: '', password2: '', nickname: '', email: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.password2) return setError('비밀번호 확인이 일치하지 않습니다.');
    setBusy(true);
    setError(null);
    try {
      await signup({ loginId: f.loginId.trim(), password: f.password, nickname: f.nickname.trim(), email: f.email.trim() });
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="회원가입" desc="가입하면 게임을 찜하고 별점·리뷰를 남길 수 있어요." footer={<>이미 계정이 있나요? <Link to="/login">로그인</Link></>}>
      <form className="auth-form" onSubmit={submit} noValidate data-testid="signup-form">
        <Field label="아이디" name="loginId" value={f.loginId} onChange={set('loginId')} autoComplete="username" maxLength={20} hint="영문 소문자·숫자·밑줄(_) 4~20자" />
        <Field label="비밀번호" name="password" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" maxLength={64} hint="영문과 숫자를 포함해 8자 이상" />
        <Field label="비밀번호 확인" name="password2" type="password" value={f.password2} onChange={set('password2')} autoComplete="new-password" maxLength={64} />
        <Field label="닉네임" name="nickname" value={f.nickname} onChange={set('nickname')} maxLength={12} hint="리뷰에 표시돼요. 한글·영문·숫자 2~12자" />
        <Field label="이메일" name="email" type="email" value={f.email} onChange={set('email')} autoComplete="email" maxLength={254} hint="아이디·비밀번호 찾기에 사용돼요" />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="form-note muted" data-testid="signup-consent">
          가입하면 <Link to="/terms">이용약관</Link>과 <Link to="/privacy">개인정보처리방침</Link>에 동의하는 것으로 봅니다.
        </p>
        <button type="submit" className="btn btn-gold btn-block btn-lg" disabled={busy}>
          {busy ? '가입 중…' : '가입하기'}
        </button>
      </form>
    </Shell>
  );
}

function MailRequestForm({ fields, onSubmit, doneText, submitLabel }) {
  const [values, setValues] = useState(Object.fromEntries(fields.map((x) => [x.name, ''])));
  const [state, setState] = useState({ busy: false, error: null, done: false });
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: null, done: false });
    try {
      await onSubmit(values);
      setState({ busy: false, error: null, done: true });
    } catch (err) {
      setState({ busy: false, error: err.message, done: false });
    }
  };
  if (state.done) {
    return (
      <p className="form-success" role="status" data-testid="mail-done">
        {doneText}
      </p>
    );
  }
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {fields.map((x) => (
        <Field key={x.name} {...x} value={values[x.name]} onChange={(e) => setValues((v) => ({ ...v, [x.name]: e.target.value }))} />
      ))}
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-gold btn-block" disabled={state.busy}>
        {state.busy ? '보내는 중…' : submitLabel}
      </button>
    </form>
  );
}

export function FindIdPage() {
  return (
    <Shell title="아이디 찾기" desc="가입할 때 입력한 이메일로 아이디를 보내 드려요." footer={<><Link to="/login">로그인</Link> · <Link to="/find-password">비밀번호 찾기</Link></>}>
      <MailRequestForm
        fields={[{ label: '이메일', name: 'email', type: 'email', autoComplete: 'email', maxLength: 254 }]}
        onSubmit={(v) => api.findId({ email: v.email.trim() })}
        submitLabel="아이디 받기"
        doneText="입력한 이메일로 가입된 계정이 있으면 아이디를 보냈어요. 메일함(스팸함 포함)을 확인해 주세요."
      />
    </Shell>
  );
}

export function FindPasswordPage() {
  return (
    <Shell title="비밀번호 찾기" desc="아이디와 가입 이메일이 맞으면 비밀번호 재설정 링크를 보내 드려요." footer={<><Link to="/login">로그인</Link> · <Link to="/find-id">아이디 찾기</Link></>}>
      <MailRequestForm
        fields={[
          { label: '아이디', name: 'loginId', autoComplete: 'username', maxLength: 20 },
          { label: '이메일', name: 'email', type: 'email', autoComplete: 'email', maxLength: 254 },
        ]}
        onSubmit={(v) => api.resetRequest({ loginId: v.loginId.trim(), email: v.email.trim() })}
        submitLabel="재설정 링크 받기"
        doneText="아이디와 이메일이 맞으면 재설정 링크를 보냈어요. 링크는 30분 동안 한 번만 쓸 수 있어요."
      />
    </Shell>
  );
}

export function ResetPasswordPage() {
  const { search } = useLocation();
  const token = new URLSearchParams(search).get('token') || '';
  const [pw, setPw] = useState({ a: '', b: '' });
  const [state, setState] = useState({ busy: false, error: null, done: false });
  const submit = async (e) => {
    e.preventDefault();
    if (pw.a !== pw.b) return setState({ busy: false, error: '비밀번호 확인이 일치하지 않습니다.', done: false });
    setState({ busy: true, error: null, done: false });
    try {
      await api.resetPassword({ token, password: pw.a });
      setState({ busy: false, error: null, done: true });
    } catch (err) {
      setState({ busy: false, error: err.message, done: false });
    }
  };
  if (!token) return <Shell title="잘못된 링크예요" desc="메일에 있는 링크로 다시 들어와 주세요." footer={<Link to="/find-password">비밀번호 찾기</Link>} />;
  if (state.done) return <Shell title="비밀번호를 바꿨어요" desc="새 비밀번호로 로그인해 주세요. 다른 기기에서는 로그아웃되었어요." footer={<Link to="/login">로그인하기 →</Link>} />;
  return (
    <Shell title="새 비밀번호 설정">
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="새 비밀번호" name="new-password" type="password" value={pw.a} onChange={(e) => setPw((x) => ({ ...x, a: e.target.value }))} autoComplete="new-password" maxLength={64} hint="영문과 숫자를 포함해 8자 이상" />
        <Field label="새 비밀번호 확인" name="new-password2" type="password" value={pw.b} onChange={(e) => setPw((x) => ({ ...x, b: e.target.value }))} autoComplete="new-password" maxLength={64} />
        {state.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        <button type="submit" className="btn btn-gold btn-block" disabled={state.busy}>
          비밀번호 변경
        </button>
      </form>
    </Shell>
  );
}
