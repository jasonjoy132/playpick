// 업로드 이미지 저장 (프로필 이미지 · 제보 게임 표지 · 표지 사진 제보)
// - PNG / JPEG / WebP 만 허용, 파일 앞부분(매직 바이트)으로 형식 확인, 최대 크기 제한
// - 서버리스(Vercel)에는 디스크가 없어 DB의 images 표에 저장(이름은 예전 파일 이름 규칙 그대로)
import path from 'node:path';
import crypto from 'node:crypto';
import { DataSourceError } from '../providers/errors.js';

const MAX_BYTES = 512 * 1024;
const TYPES = {
  png: { mime: 'image/png', ok: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: 'image/jpeg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mime: 'image/webp', ok: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
};
export const AVATAR_FILE = /^u\d+-[a-f0-9]{16}\.(png|jpg|webp)$/;
export const avatarMime = (file) => TYPES[path.extname(file).slice(1)]?.mime;

/**
 * 이미지 저장소 (프로필 이미지 · 제보 게임 표지 공용, DB images 표)
 * @param {{ prefix?: string, maxBytes?: number }} opt  이름 앞글자(u: 프로필, s: 제보 표지, p: 표지 사진 제보)·최대 크기
 */
export function createAvatarStore(db, { prefix = 'u', maxBytes = MAX_BYTES, now = () => Date.now() } = {}) {
  const FILE = new RegExp(`^${prefix}\\d+-[a-f0-9]{16}\\.(png|jpg|webp)$`);
  const q = {
    put: db.prepare('INSERT INTO images (name, mime, data, created_at) VALUES (?, ?, ?, ?)'),
    get: db.prepare('SELECT mime, data FROM images WHERE name = ?'),
    del: db.prepare('DELETE FROM images WHERE name = ?'),
  };
  return {
    fileRe: FILE,
    async save(userId, dataUrl) {
      const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
      if (!m) throw new DataSourceError('INVALID_IMAGE', 'PNG·JPG·WebP 이미지만 올릴 수 있어요.', 400);
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > maxBytes) throw new DataSourceError('INVALID_IMAGE', `이미지가 너무 커요. (최대 ${Math.round(maxBytes / 1024)}KB)`, 400);
      if (!TYPES[ext].ok(buf)) throw new DataSourceError('INVALID_IMAGE', '이미지 파일이 올바르지 않아요.', 400);
      const file = `${prefix}${userId}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
      await q.put.run(file, TYPES[ext].mime, buf, new Date(now()).toISOString());
      return file;
    },
    async remove(file) {
      if (file && FILE.test(file)) await q.del.run(file);
    },
    /** 이름 → { mime, data: Buffer } | null */
    async read(file) {
      if (!FILE.test(String(file))) return null;
      const r = await q.get.get(file);
      return r ? { mime: r.mime, data: Buffer.from(r.data) } : null;
    },
  };
}
