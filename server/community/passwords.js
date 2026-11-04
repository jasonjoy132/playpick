// 비밀번호 해시 (scrypt, 사용자별 salt) / 토큰 생성
import crypto from 'node:crypto';

const N = 16384, R = 8, P = 1, LEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// 계정이 없을 때도 같은 시간만큼 계산해 '없는 아이디'를 응답 시간으로 알 수 없게 함
const DUMMY = hashPassword('dummy-password-for-timing');
export const burnTime = (password) => verifyPassword(password, DUMMY);

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
