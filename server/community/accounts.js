// 회원가입·로그인·세션·아이디 찾기·비밀번호 재설정
import { DataSourceError } from '../providers/errors.js';
import { hashPassword, verifyPassword, burnTime, newToken, sha256 } from './passwords.js';
import { check, checkPassword } from './validate.js';

const SESSION_DAYS = 14;
const RESET_MINUTES = 30;
const fail = (code, message, status = 400) => new DataSourceError(code, message, status);
export const avatarUrl = (file) => (file ? `/avatars/${file}` : null);
const publicUser = (u) =>
  u ? { id: u.id, loginId: u.login_id, nickname: u.nickname, email: u.email, createdAt: u.created_at, avatarUrl: avatarUrl(u.avatar_file) } : null;
const maskId = (id) => (id.length <= 3 ? `${id[0]}**` : `${id.slice(0, 3)}${'*'.repeat(id.length - 3)}`);

export function createAccounts(db, { mailer, baseUrl, avatars, now = () => Date.now() }) {
  const q = {
    byLogin: db.prepare('SELECT * FROM users WHERE login_id = ?'),
    byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    byNick: db.prepare('SELECT id FROM users WHERE nickname = ?'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    insert: db.prepare('INSERT INTO users (login_id, nickname, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    setPw: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    newSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    session: db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'),
    delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    delUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    newReset: db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    reset: db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > ?'),
    useReset: db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?'),
    setNick: db.prepare('UPDATE users SET nickname = ? WHERE id = ?'),
    setAvatar: db.prepare('UPDATE users SET avatar_file = ? WHERE id = ?'),
    delOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
  };

  function createSession(userId) {
    const token = newToken();
    q.purge.run(now());
    q.newSession.run(sha256(token), userId, now() + SESSION_DAYS * 864e5);
    return { token, maxAgeSec: SESSION_DAYS * 86400 };
  }

  return {
    signup({ loginId, password, nickname, email }) {
      loginId = String(loginId ?? '').trim().toLowerCase();
      nickname = String(nickname ?? '').trim();
      email = String(email ?? '').trim().toLowerCase();
      const err = check('loginId', loginId) || checkPassword(password) || check('nickname', nickname) || check('email', email);
      if (err) throw fail('INVALID_INPUT', err);
      if (q.byLogin.get(loginId)) throw fail('DUPLICATE_LOGIN_ID', '이미 사용 중인 아이디입니다.', 409);
      if (q.byNick.get(nickname)) throw fail('DUPLICATE_NICKNAME', '이미 사용 중인 닉네임입니다.', 409);
      if (q.byEmail.get(email)) throw fail('DUPLICATE_EMAIL', '이미 가입된 이메일입니다. 아이디 찾기를 이용해 주세요.', 409);
      const { lastInsertRowid } = q.insert.run(loginId, nickname, email, hashPassword(password), new Date(now()).toISOString());
      const user = q.byId.get(Number(lastInsertRowid));
      return { user: publicUser(user), session: createSession(user.id) };
    },

    login({ loginId, password }) {
      loginId = String(loginId ?? '').trim().toLowerCase();
      const user = loginId ? q.byLogin.get(loginId) : null;
      const ok = user ? verifyPassword(String(password ?? ''), user.password_hash) : (burnTime(String(password ?? '')), false);
      if (!ok) throw fail('INVALID_LOGIN', '아이디 또는 비밀번호가 올바르지 않습니다.', 401);
      return { user: publicUser(user), session: createSession(user.id) };
    },

    logout(token) {
      if (token) q.delSession.run(sha256(token));
    },

    userFromToken(token) {
      if (!token) return null;
      return publicUser(q.session.get(sha256(token), now()));
    },

    /** 아이디 찾기: 가입 여부와 관계없이 같은 응답(계정 존재 여부 노출 방지) */
    async findId({ email }) {
      email = String(email ?? '').trim().toLowerCase();
      const err = check('email', email);
      if (err) throw fail('INVALID_INPUT', err);
      if (!mailer.configured && !mailer.devLog) throw fail('MAIL_NOT_CONFIGURED', '메일 발송 설정이 없어 아이디 찾기를 할 수 없습니다. 관리자에게 문의해 주세요.', 503);
      const user = q.byEmail.get(email);
      if (user) {
        await mailer.send({
          to: email,
          subject: '[플레이픽] 아이디 안내',
          lines: [`${user.nickname}님, 플레이픽 아이디는 다음과 같습니다.`, `아이디: ${user.login_id}`, '본인이 요청하지 않았다면 이 메일을 무시해 주세요.'],
        });
      }
      return { ok: true };
    },

    /** 비밀번호 재설정 메일 (아이디 + 이메일이 일치할 때만 발송, 응답은 동일) */
    async requestReset({ loginId, email }) {
      loginId = String(loginId ?? '').trim().toLowerCase();
      email = String(email ?? '').trim().toLowerCase();
      const err = check('loginId', loginId) || check('email', email);
      if (err) throw fail('INVALID_INPUT', err);
      if (!mailer.configured && !mailer.devLog) throw fail('MAIL_NOT_CONFIGURED', '메일 발송 설정이 없어 비밀번호 찾기를 할 수 없습니다. 관리자에게 문의해 주세요.', 503);
      const user = q.byLogin.get(loginId);
      if (user && user.email.toLowerCase() === email) {
        const token = newToken();
        q.newReset.run(sha256(token), user.id, now() + RESET_MINUTES * 60e3);
        await mailer.send({
          to: email,
          subject: '[플레이픽] 비밀번호 재설정',
          lines: [`${user.nickname}님(${maskId(user.login_id)}), 아래 링크에서 새 비밀번호를 설정해 주세요.`, `링크는 ${RESET_MINUTES}분 동안 한 번만 사용할 수 있습니다.`, '본인이 요청하지 않았다면 이 메일을 무시해 주세요.'],
          link: `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`,
        });
      }
      return { ok: true };
    },

    /** 닉네임 변경 */
    updateProfile(userId, { nickname }) {
      nickname = String(nickname ?? '').trim();
      const err = check('nickname', nickname);
      if (err) throw fail('INVALID_INPUT', err);
      const other = q.byNick.get(nickname);
      if (other && other.id !== userId) throw fail('DUPLICATE_NICKNAME', '이미 사용 중인 닉네임입니다.', 409);
      q.setNick.run(nickname, userId);
      return publicUser(q.byId.get(userId));
    },

    /** 프로필 이미지 변경(dataUrl) / 삭제(null) */
    setAvatar(userId, dataUrl) {
      const before = q.byId.get(userId)?.avatar_file;
      const file = dataUrl ? avatars.save(userId, dataUrl) : null;
      q.setAvatar.run(file, userId);
      if (before) avatars.remove(before);
      return publicUser(q.byId.get(userId));
    },

    /** 비밀번호 변경: 현재 비밀번호 확인, 이 기기 말고 다른 기기는 로그아웃 */
    changePassword(userId, currentToken, { currentPassword, newPassword }) {
      const user = q.byId.get(userId);
      if (!user || !verifyPassword(String(currentPassword ?? ''), user.password_hash)) throw fail('WRONG_PASSWORD', '현재 비밀번호가 올바르지 않습니다.', 400);
      const err = checkPassword(newPassword);
      if (err) throw fail('INVALID_INPUT', err);
      if (currentPassword === newPassword) throw fail('INVALID_INPUT', '현재 비밀번호와 다른 비밀번호를 입력해 주세요.');
      q.setPw.run(hashPassword(newPassword), userId);
      q.delOtherSessions.run(userId, sha256(currentToken));
      return { ok: true };
    },

    resetPassword({ token, password }) {
      const err = checkPassword(password);
      if (err) throw fail('INVALID_INPUT', err);
      const row = token ? q.reset.get(sha256(String(token)), now()) : null;
      if (!row) throw fail('INVALID_TOKEN', '재설정 링크가 만료되었거나 이미 사용되었습니다. 비밀번호 찾기를 다시 해 주세요.', 400);
      q.setPw.run(hashPassword(password), row.user_id);
      q.useReset.run(row.user_id);
      q.delUserSessions.run(row.user_id); // 다른 기기 로그아웃
      return { ok: true };
    },
  };
}
