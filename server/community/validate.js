// 입력값 검증 (오류 메시지는 화면에 그대로 표시)
export const RULES = {
  loginId: { re: /^[a-z0-9_]{4,20}$/, msg: '아이디는 영문 소문자·숫자·밑줄(_) 4~20자로 입력해 주세요.' },
  nickname: { re: /^[가-힣a-zA-Z0-9_]{2,12}$/, msg: '닉네임은 한글·영문·숫자·밑줄 2~12자로 입력해 주세요.' },
  email: { re: /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/, msg: '올바른 이메일 주소를 입력해 주세요.' },
};

export function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 64) return '비밀번호는 8~64자로 입력해 주세요.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return '비밀번호에는 영문과 숫자를 모두 포함해 주세요.';
  return null;
}

export function check(field, value) {
  const r = RULES[field];
  return typeof value === 'string' && r.re.test(value.trim()) ? null : r.msg;
}

export const GAME_ID = /^(igdb-\d{1,12}|grac-[A-Za-z0-9%._-]{1,80}|demo-[a-z0-9-]{1,20}|user-\d{1,9})$/;
