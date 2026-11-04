// RAWG 평균 플레이 시간 — 미리 받아 둔 파일만 읽음 (상세 화면에서 RAWG를 실시간으로 부르지 않음)
//  - 파일: server/data/rawg-playtime.json ( `npm run prefill:playtime` 으로 만듦 )
//    { "igdb-71": { hours, url, name, date } | { hours: null, reason, date } }   (reason: 못 찾은 이유, 다음에 다시 검색하지 않으려고 저장)
//  - 파일에 없거나 못 찾은 게임은 null → 상세 화면은 AI 추정 또는 '정보 없음'
//  - 서버가 켜져 있으면 30초마다 파일이 바뀌었는지 확인해 다시 읽음
import fs from 'node:fs';
import path from 'node:path';

const RELOAD_MS = 30_000;

/**
 * @param {string|null} file 저장 파일 (null 이면 파일 없이 메모리에서만 — 테스트용)
 * @param {{ entries?: Record<string, object>, now?: () => number }} opt entries: 처음 값(테스트용)
 */
export function createRawgPlaytime(file, { entries = {}, now = () => Date.now() } = {}) {
  let map = new Map(Object.entries(entries));
  let mtime = 0;
  let lastCheck = 0;
  let dirty = false;

  const load = () => {
    try {
      const m = fs.statSync(file).mtimeMs;
      if (m === mtime) return;
      map = new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
      mtime = m;
    } catch {
      /* 없거나 쓰는 중이면 그대로 */
    }
  };
  const fresh = () => {
    if (!file || now() - lastCheck < RELOAD_MS) return;
    lastCheck = now();
    load();
  };
  if (file) {
    load();
    lastCheck = now();
  }

  return {
    get size() {
      fresh();
      return map.size;
    },
    /** 상세 화면용: { hours, url, name } 또는 null */
    get(id) {
      fresh();
      const e = map.get(id);
      return e && Number(e.hours) > 0 && e.url ? { hours: Number(e.hours), url: e.url, name: e.name ?? null } : null;
    },
    /** 스크립트용: 이미 확인했는지 (찾았든 못 찾았든) */
    has: (id) => map.has(id),
    /** 스크립트용: 확인했지만 못 찾은 게임인지 */
    isMiss: (id) => map.has(id) && !(Number(map.get(id).hours) > 0),
    /** 스크립트용: 결과 기록 (value: { hours, url, name } 또는 null + reason) */
    set(id, value, reason = null) {
      const date = new Date(now()).toISOString().slice(0, 10);
      map.set(id, value ? { hours: value.hours, url: value.url, name: value.name, date } : { hours: null, reason, date });
      dirty = true;
    },
    save() {
      if (!file || !dirty) return;
      dirty = false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)))));
      fs.renameSync(tmp, file);
      mtime = fs.statSync(file).mtimeMs;
    },
  };
}
