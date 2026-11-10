// 회원가입·로그인·세션·아이디 찾기·비밀번호 재설정
import crypto from 'node:crypto';
import { DataSourceError } from '../providers/errors.js';
import { hashPassword, verifyPassword, burnTime, newToken, sha256 } from './passwords.js';
import { check, checkPassword } from './validate.js';
import { providerLabel } from './oauth.js';

const SESSION_DAYS = 14;
const RESET_MINUTES = 30;
const PENDING_MINUTES = 30;
const fail = (code, message, status = 400) => new DataSourceError(code, message, status);
export const avatarUrl = (file) => (file ? `/avatars/${file}` : null);
const publicUser = (u) =>
  u ? { id: u.id, loginId: u.login_id, nickname: u.nickname, email: u.email, createdAt: u.created_at, avatarUrl: avatarUrl(u.avatar_file), hasPassword: Boolean(u.password_hash) } : null;
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
    // 다른 계정으로 로그인
    identity: db.prepare('SELECT * FROM user_identities WHERE provider = ? AND subject = ?'),
    identitiesOf: db.prepare('SELECT provider, email, created_at FROM user_identities WHERE user_id = ? ORDER BY created_at'),
    addIdentity: db.prepare('INSERT INTO user_identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)'),
    delIdentity: db.prepare('DELETE FROM user_identities WHERE user_id = ? AND provider = ?'),
    newPending: db.prepare('INSERT INTO oauth_pending (token_hash, provider, subject, email, name, next, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    pending: db.prepare('SELECT * FROM oauth_pending WHERE token_hash = ? AND expires_at > ?'),
    delPending: db.prepare('DELETE FROM oauth_pending WHERE token_hash = ?'),
    purgePending: db.prepare('DELETE FROM oauth_pending WHERE expires_at <= ?'),
  };
  const iso = () => new Date(now()).toISOString();
  /** 소셜로만 가입한 계정의 아이디: g_xxxxxxxxxx / d_xxxxxxxxxx (아이디 규칙에 맞게, 겹치지 않게) */
  async function newSocialLoginId(provider) {
    for (;;) {
      const id = `${provider[0]}_${crypto.randomBytes(5).toString('hex')}`;
      if (!(await q.byLogin.get(id))) return id;
    }
  }
  /** 제공자 이름 → 닉네임 후보(규칙에 맞게 다듬고, 겹치면 숫자를 붙임). 못 만들면 빈 값 */
  async function suggestNickname(name) {
    const base = String(name || '').replace(/[^가-힣a-zA-Z0-9_]/g, '').slice(0, 10);
    if (base.length < 2) return '';
    if (!(await q.byNick.get(base))) return base;
    for (let i = 0; i < 20; i++) {
      const n = `${base}${Math.floor(10 + Math.random() * 90)}`;
      if (!(await q.byNick.get(n))) return n;
    }
    return '';
  }
  const linkedLabels = async (userId) => (await q.identitiesOf.all(userId)).map((r) => providerLabel(r.provider)).join('·');

  async function createSession(userId) {
    const token = newToken();
    await q.purge.run(now());
    await q.newSession.run(sha256(token), userId, now() + SESSION_DAYS * 864e5);
    return { token, maxAgeSec: SESSION_DAYS * 86400 };
  }

  return {
    /**
     * 소셜 로그인 결과 처리
     *  - 이미 연결된 계정 → 로그인
     *  - 인증된 같은 이메일의 회원 → 그 계정에 연결하고 로그인
     *  - 처음 → 닉네임을 정하도록 잠시 보관 { pending: { token, maxAgeSec } }
     */
    async oauthLogin(profile, { next = '/' } = {}) {
      const linked = await q.identity.get(profile.provider, profile.subject);
      if (linked) return { user: publicUser(await q.byId.get(linked.user_id)), session: await createSession(linked.user_id) };
      if (!profile.email || !profile.verified)
        throw fail('OAUTH_EMAIL_UNVERIFIED', `${providerLabel(profile.provider)} 계정에 인증된 이메일이 없어요. 이메일을 인증한 뒤 다시 시도하거나, 아이디로 가입해 주세요.`);
      const same = await q.byEmail.get(profile.email);
      if (same) {
        if ((await q.identitiesOf.all(same.id)).some((r) => r.provider === profile.provider))
          throw fail('OAUTH_TAKEN', `이 이메일의 회원에게는 이미 다른 ${providerLabel(profile.provider)} 계정이 연결되어 있어요.`, 409);
        await q.addIdentity.run(profile.provider, profile.subject, same.id, profile.email, iso());
        return { user: publicUser(same), session: await createSession(same.id), linkedExisting: true };
      }
      const token = newToken();
      await q.purgePending.run(now());
      await q.newPending.run(sha256(token), profile.provider, profile.subject, profile.email, profile.name || null, next, now() + PENDING_MINUTES * 60e3);
      return { pending: { token, maxAgeSec: PENDING_MINUTES * 60 } };
    },

    /** 닉네임 정하는 화면에 보여 줄 정보 */
    async oauthPending(token) {
      const row = token ? await q.pending.get(sha256(String(token)), now()) : null;
      if (!row) return null;
      return { provider: row.provider, providerLabel: providerLabel(row.provider), email: row.email, nickname: await suggestNickname(row.name), next: row.next || '/' };
    },

    /** 닉네임을 정해 가입 마치기 */
    async oauthComplete(token, { nickname }) {
      const row = token ? await q.pending.get(sha256(String(token)), now()) : null;
      if (!row) throw fail('OAUTH_EXPIRED', '가입 시간이 지났어요. 처음부터 다시 시도해 주세요.', 400);
      nickname = String(nickname ?? '').trim();
      const err = check('nickname', nickname);
      if (err) throw fail('INVALID_INPUT', err);
      // 그사이 같은 계정·이메일로 가입된 경우: 그 계정으로 로그인
      const linked = await q.identity.get(row.provider, row.subject);
      const same = linked ? await q.byId.get(linked.user_id) : await q.byEmail.get(row.email);
      let userId = same?.id;
      if (!userId) {
        if (await q.byNick.get(nickname)) throw fail('DUPLICATE_NICKNAME', '이미 사용 중인 닉네임입니다.', 409);
        const { lastInsertRowid } = await q.insert.run(await newSocialLoginId(row.provider), nickname, row.email, '', iso());
        userId = Number(lastInsertRowid);
      }
      if (!linked) await q.addIdentity.run(row.provider, row.subject, userId, row.email, iso());
      await q.delPending.run(row.token_hash);
      return { user: publicUser(await q.byId.get(userId)), session: await createSession(userId), next: row.next || '/' };
    },

    /** 로그인한 회원이 다른 계정을 더 연결 */
    async oauthLink(userId, profile) {
      const linked = await q.identity.get(profile.provider, profile.subject);
      if (linked && linked.user_id !== userId) throw fail('OAUTH_TAKEN', `이 ${providerLabel(profile.provider)} 계정은 이미 다른 회원과 연결되어 있어요.`, 409);
      if (linked) return { ok: true };
      if ((await q.identitiesOf.all(userId)).some((r) => r.provider === profile.provider))
        throw fail('OAUTH_TAKEN', `이미 다른 ${providerLabel(profile.provider)} 계정이 연결되어 있어요. 먼저 연결을 끊어 주세요.`, 409);
      await q.addIdentity.run(profile.provider, profile.subject, userId, profile.email, iso());
      return { ok: true };
    },

    /** 연결된 계정 목록 */
    async identities(userId) {
      return (await q.identitiesOf.all(userId)).map((r) => ({ provider: r.provider, label: providerLabel(r.provider), email: r.email, linkedAt: r.created_at }));
    },

    /** 연결 끊기: 남는 로그인 방법(비밀번호·다른 계정)이 있어야 함 */
    async unlink(userId, provider) {
      const user = await q.byId.get(userId);
      const list = await q.identitiesOf.all(userId);
      if (!list.some((r) => r.provider === provider)) throw fail('NOT_FOUND', '연결되지 않은 계정이에요.', 404);
      if (!user.password_hash && list.length <= 1)
        throw fail('LAST_LOGIN_METHOD', '로그인할 방법이 하나뿐이라 끊을 수 없어요. 먼저 비밀번호를 만들거나 다른 계정을 연결해 주세요.', 400);
      await q.delIdentity.run(userId, provider);
      return { ok: true };
    },

    async signup({ loginId, password, nickname, email }) {
      loginId = String(loginId ?? '').trim().toLowerCase();
      nickname = String(nickname ?? '').trim();
      email = String(email ?? '').trim().toLowerCase();
      const err = check('loginId', loginId) || checkPassword(password) || check('nickname', nickname) || check('email', email);
      if (err) throw fail('INVALID_INPUT', err);
      if (await q.byLogin.get(loginId)) throw fail('DUPLICATE_LOGIN_ID', '이미 사용 중인 아이디입니다.', 409);
      if (await q.byNick.get(nickname)) throw fail('DUPLICATE_NICKNAME', '이미 사용 중인 닉네임입니다.', 409);
      if (await q.byEmail.get(email)) throw fail('DUPLICATE_EMAIL', '이미 가입된 이메일입니다. 아이디 찾기를 이용해 주세요.', 409);
      const { lastInsertRowid } = await q.insert.run(loginId, nickname, email, hashPassword(password), new Date(now()).toISOString());
      const user = await q.byId.get(Number(lastInsertRowid));
      return { user: publicUser(user), session: await createSession(user.id) };
    },

    async login({ loginId, password }) {
      loginId = String(loginId ?? '').trim().toLowerCase();
      const user = loginId ? await q.byLogin.get(loginId) : null;
      const ok = user ? verifyPassword(String(password ?? ''), user.password_hash) : (burnTime(String(password ?? '')), false);
      if (!ok) throw fail('INVALID_LOGIN', '아이디 또는 비밀번호가 올바르지 않습니다.', 401);
      return { user: publicUser(user), session: await createSession(user.id) };
    },

    async logout(token) {
      if (token) await q.delSession.run(sha256(token));
    },

    async userFromToken(token) {
      if (!token) return null;
      return publicUser(await q.session.get(sha256(token), now()));
    },

    /** 아이디 찾기: 가입 여부와 관계없이 같은 응답(계정 존재 여부 노출 방지) */
    async findId({ email }) {
      email = String(email ?? '').trim().toLowerCase();
      const err = check('email', email);
      if (err) throw fail('INVALID_INPUT', err);
      if (!mailer.configured && !mailer.devLog) throw fail('MAIL_NOT_CONFIGURED', '메일 발송 설정이 없어 아이디 찾기를 할 수 없습니다. 관리자에게 문의해 주세요.', 503);
      const user = await q.byEmail.get(email);
      if (user && !user.password_hash) {
        // 소셜로만 가입한 계정: 아이디·비밀번호 대신 그 계정으로 로그인하라고 안내
        const via = (await linkedLabels(user.id)) || '다른';
        await mailer.send({
          to: email,
          subject: '[플레이픽] 로그인 방법 안내',
          lines: [`${user.nickname}님은 ${via} 계정으로 가입하셨어요.`, `로그인 화면에서 '${via}로 계속하기'를 눌러 로그인해 주세요.`, '본인이 요청하지 않았다면 이 메일을 무시해 주세요.'],
          link: `${baseUrl}/login`,
        });
      } else if (user) {
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
      const user = await q.byLogin.get(loginId);
      if (user && user.email.toLowerCase() === email) {
        const token = newToken();
        await q.newReset.run(sha256(token), user.id, now() + RESET_MINUTES * 60e3);
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
    async updateProfile(userId, { nickname }) {
      nickname = String(nickname ?? '').trim();
      const err = check('nickname', nickname);
      if (err) throw fail('INVALID_INPUT', err);
      const other = await q.byNick.get(nickname);
      if (other && other.id !== userId) throw fail('DUPLICATE_NICKNAME', '이미 사용 중인 닉네임입니다.', 409);
      await q.setNick.run(nickname, userId);
      return publicUser(await q.byId.get(userId));
    },

    /** 프로필 이미지 변경(dataUrl) / 삭제(null) */
    async setAvatar(userId, dataUrl) {
      const before = (await q.byId.get(userId))?.avatar_file;
      const file = dataUrl ? await avatars.save(userId, dataUrl) : null;
      await q.setAvatar.run(file, userId);
      if (before) await avatars.remove(before);
      return publicUser(await q.byId.get(userId));
    },

    /** 비밀번호 변경: 현재 비밀번호 확인, 이 기기 말고 다른 기기는 로그아웃 */
    async changePassword(userId, currentToken, { currentPassword, newPassword }) {
      const user = await q.byId.get(userId);
      if (!user) throw fail('WRONG_PASSWORD', '현재 비밀번호가 올바르지 않습니다.', 400);
      // 소셜로만 가입한 계정은 현재 비밀번호 없이 처음 만들 수 있음
      if (user.password_hash && !verifyPassword(String(currentPassword ?? ''), user.password_hash)) throw fail('WRONG_PASSWORD', '현재 비밀번호가 올바르지 않습니다.', 400);
      const err = checkPassword(newPassword);
      if (err) throw fail('INVALID_INPUT', err);
      if (user.password_hash && currentPassword === newPassword) throw fail('INVALID_INPUT', '현재 비밀번호와 다른 비밀번호를 입력해 주세요.');
      await q.setPw.run(hashPassword(newPassword), userId);
      await q.delOtherSessions.run(userId, sha256(currentToken));
      return { ok: true };
    },

  /** 회원 탈퇴: 비밀번호(있으면)·확인 문구 확인 → 프로필 사진 파일 삭제 → 계정 삭제(세션·찜·리뷰·알림 등은 DB가 함께 지움) */
    async deleteAccount(userId, { password, confirm } = {}, beforeDelete = () => {}) {
      const user = await q.byId.get(userId);
      if (!user) throw fail('WRONG_PASSWORD', '비밀번호가 올바르지 않습니다.', 400);
      // 소셜로만 가입한 계정(비밀번호 없음)은 '탈퇴' 입력만 확인
      if (user.password_hash && !verifyPassword(String(password ?? ''), user.password_hash)) throw fail('WRONG_PASSWORD', '비밀번호가 올바르지 않습니다.', 400);
      if (String(confirm ?? '').trim() !== '탈퇴') throw fail('INVALID_INPUT', "확인 칸에 '탈퇴'라고 입력해 주세요.");
      await beforeDelete();
      // 원격 DB는 외래 키(ON DELETE)를 믿지 않으므로 자식 행을 직접 지우고, 남기는 기록은 작성자만 비움 — 한 트랜잭션으로
      const del = (t, col = 'user_id') => [`DELETE FROM ${t} WHERE ${col} = ?`, [userId]];
      const nul = (t, col = 'user_id') => [`UPDATE ${t} SET ${col} = NULL WHERE ${col} = ?`, [userId]];
      await db.batch([
        ...['sessions', 'password_resets', 'user_identities', 'wishlist', 'recent_views', 'notifications', 'contrib_milestones'].map((t) => del(t)),
        ['DELETE FROM review_reports WHERE review_id IN (SELECT id FROM reviews WHERE user_id = ?)', [userId]],
        del('reviews'),
        nul('game_submissions'),
        nul('image_submissions'),
        nul('game_reports'),
        nul('review_reports', 'reporter_id'),
        nul('ai_playtime', 'requested_by'),
        del('users', 'id'),
      ]);
      if (user.avatar_file) await avatars.remove(user.avatar_file);
      return { ok: true };
    },

    async resetPassword({ token, password }) {
      const err = checkPassword(password);
      if (err) throw fail('INVALID_INPUT', err);
      const row = token ? await q.reset.get(sha256(String(token)), now()) : null;
      if (!row) throw fail('INVALID_TOKEN', '재설정 링크가 만료되었거나 이미 사용되었습니다. 비밀번호 찾기를 다시 해 주세요.', 400);
      await q.setPw.run(hashPassword(password), row.user_id);
      await q.useReset.run(row.user_id);
      await q.delUserSessions.run(row.user_id); // 다른 기기 로그아웃
      return { ok: true };
    },
  };
}
