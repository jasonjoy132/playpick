// 게임위 전용 게임(주로 국내 모바일 게임)의 App Store 아이콘 — 미리 받아 둔 파일만 읽어 목록·상세에 붙임
//  - 파일: server/data/app-store.json ( `npm run prefill:images` 로 만듦 )
//    { "grac:<기본제목>": { imageUrl, storeUrl, appName, seller, date } | { none: true, date } }
//  - 같은 게임 판단은 기존 App Store 규칙(앱 이름 + 개발사 모두 일치)을 그대로 씀
//  - 애플 이용 조건: 이미지는 해당 앱 홍보 용도로, App Store 링크와 함께 보여 줌(상세의 구매처에 App Store 링크)
import fs from 'node:fs';
import path from 'node:path';
import { normTitle, baseTitle } from '../providers/igdbProvider.js';

const GRAC = '게임물관리위원회';
export const artKey = (g) => `grac:${normTitle(baseTitle(g.title))}`;

/**
 * App Store 이미지로 카드·상세 그림 고르기
 *  - 카드 표지(세로 3:4): 세로 스크린샷이 있으면 그것, 없으면 첫 스크린샷, 스크린샷이 없으면 아이콘
 *  - 상세 배너(가로): 가로 스크린샷이 있으면 그것, 없으면 첫 스크린샷
 *  - 상세 표지 칸: 아이콘(정사각형)
 */
export function pickArt(e) {
  const shots = Array.isArray(e?.screenshots) ? e.screenshots : [];
  const portrait = shots.find((x) => x.w && x.h && x.h > x.w);
  const landscape = shots.find((x) => x.w && x.h && x.w > x.h);
  return {
    cover: (portrait ?? shots[0])?.url ?? e?.imageUrl ?? null,
    banner: (landscape ?? shots[0])?.url ?? null,
    icon: e?.imageUrl ?? null,
    screenshots: shots.map((x) => x.url),
  };
}

export function createAppArt(file, { now = () => Date.now() } = {}) {
  let map = new Map();
  let mtime = 0;
  let lastCheck = 0;
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
  if (file) load();
  let dirty = false;

  /** 게임위 게임에 아이콘·App Store 링크 붙이기 (이미 이미지가 있으면 그대로) */
  function apply(game) {
    if (game.source !== GRAC || game.imageUrl) return game;
    const e = map.get(artKey(game));
    if (!e || e.none || !e.storeUrl) return game;
    const stores = game.stores?.some((s) => s.appStore) ? game.stores : [...(game.stores || []), { name: 'App Store', url: e.storeUrl, isDemo: false, appStore: true }];
    const art = pickArt(e);
    return {
      ...game,
      imageUrl: art.cover ?? game.imageUrl,
      iconUrl: art.icon,
      bannerUrl: game.bannerUrl ?? art.banner,
      screenshots: art.screenshots,
      screenshotSource: 'App Store',
      imageSource: art.cover ? 'App Store' : null,
      appStoreUrl: e.storeUrl,
      stores,
    };
  }

  return {
    get size() {
      return map.size;
    },
    /** 목록용 (서버가 켜진 동안 파일이 바뀌면 30초 안에 다시 읽음) */
    applyAll(games) {
      if (file && now() - lastCheck > 30_000) {
        lastCheck = now();
        load();
      }
      return games.map(apply);
    },
    apply,
    /** 이미 확인했는지 (찾았든 못 찾았든) */
    has: (game) => map.has(artKey(game)),
    /** 찾았지만 스크린샷은 아직 안 받은 예전 항목 */
    needsShots: (game) => {
      const e = map.get(artKey(game));
      return Boolean(e && !e.none && !('screenshots' in e));
    },
    /** 스크립트용: 결과 저장 */
    set(game, value) {
      map.set(artKey(game), { ...value, date: new Date(now()).toISOString().slice(0, 10) });
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
