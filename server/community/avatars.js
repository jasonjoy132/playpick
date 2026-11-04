// 프로필 이미지 저장 (브라우저에서 256px 정사각형으로 줄여 보낸 이미지를 파일로 저장)
// - PNG / JPEG / WebP 만 허용, 파일 앞부분(매직 바이트)으로 형식 확인, 최대 512KB
import fs from 'node:fs';
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
 * 이미지 파일 저장소 (프로필 이미지 · 제보 게임 표지 공용)
 * @param {{ prefix?: string, maxBytes?: number }} opt  파일 이름 앞글자(u: 프로필, s: 제보 표지)·최대 크기
 */
export function createAvatarStore(dir, { prefix = 'u', maxBytes = MAX_BYTES } = {}) {
  const FILE = new RegExp(`^${prefix}\\d+-[a-f0-9]{16}\\.(png|jpg|webp)$`);
  return {
    dir,
    fileRe: FILE,
    save(userId, dataUrl) {
      const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
      if (!m) throw new DataSourceError('INVALID_IMAGE', 'PNG·JPG·WebP 이미지만 올릴 수 있어요.', 400);
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > maxBytes) throw new DataSourceError('INVALID_IMAGE', `이미지가 너무 커요. (최대 ${Math.round(maxBytes / 1024)}KB)`, 400);
      if (!TYPES[ext].ok(buf)) throw new DataSourceError('INVALID_IMAGE', '이미지 파일이 올바르지 않아요.', 400);
      fs.mkdirSync(dir, { recursive: true });
      const file = `${prefix}${userId}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(dir, file), buf);
      return file;
    },
    remove(file) {
      if (file && FILE.test(file)) fs.rmSync(path.join(dir, file), { force: true });
    },
    path: (file) => (FILE.test(file) ? path.join(dir, file) : null),
  };
}
