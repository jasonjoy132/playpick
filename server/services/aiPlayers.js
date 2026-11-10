// 상세 화면에서 바로 묻는 AI 추천 인원 (로그인한 회원이 상세를 열었을 때만) — aiPlaytime.js 와 같은 방식
//  - 추천 인원이 아무 데도 없는 게임(IGDB 협동 인원·미리 받은 AI 파일 모두 없음)만 대상. 파일에서 AI가 '모름'이라 한 게임은 다시 묻지 않음
//  - 결과는 DB(ai_players)에 저장 → 한 게임은 한 번만 물음. '모름'도 저장
//  - 키는 partySize.cacheKey(IGDB 번호 / 게관위 기본 제목) → 같은 게관위 게임의 플랫폼별 등급분류가 같은 값을 씀
//  - 저장된 값은 목록·추천에도 쓰임(app.js 가 1분마다 읽어 partySize.setAsked)
//  - 하루 상한(dailyLimit)을 넘거나 AI 오류면 저장하지 않음 → 나중에 다시
//  - 화면에는 항상 'AI 추정'(source: 'ai'). 키는 서버에서만 사용
import { GEMINI_API_BASE, cacheKey, sanitize } from './partySize.js';
import { netReason } from '../providers/errors.js';

const GRAC = '게임물관리위원회';

/** 게임 하나 → 프롬프트 (추천 인원만) */
export function buildPlayersPrompt(g) {
  const info =
    g.source === GRAC
      ? { name: g.title, note: 'Korean title from the Korean game rating board (GRAC)', publisher: g.publisher ?? null, platform: g.platformsRaw ?? null, genre: g.genresRaw ?? null }
      : { name: g.originalTitle || g.title, year: g.firstYear ?? (g.releaseDate ? Number(String(g.releaseDate).slice(0, 4)) : null), modes: g.gameModes ?? [], platforms: g.platformsRaw ?? null, igdbMaxPlayers: g.players?.max ?? null };
  return [
    'Give the recommended party size for the video game below: how many people usually play it TOGETHER as one group of friends',
    '(e.g. squad/team/party/co-op group, or people on one couch), NOT the total number of players in a match or on a server.',
    'Examples: PUBG: BATTLEGROUNDS -> min 1, max 4 (solo/duo/squad). League of Legends -> min 1, max 5. Minecraft -> min 1, max 8. A single-player-only game -> min 1, max 1.',
    'min is the smallest group that commonly plays (1 if it can be played alone).',
    'If you do not specifically know this exact game, return null for min and max. Do not guess from the title or genre.',
    'Return a JSON object {min, max}.',
    '',
    JSON.stringify(info),
  ].join('\n');
}

/** 이 게임에 AI 추천 인원을 물어볼 수 있는지 (데모·회원 제보 게임 제외) */
export const canAskPlayers = (g) => !g.isDemo && (g.source === 'IGDB' || g.source === GRAC);

/**
 * @param {{ apiKey?: string, model?: string, apiBase?: string, live?: boolean, dailyLimit?: number, timeoutMs?: number }} cfg
 */
export function createAiPlayers(db, cfg = {}, { fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {} } = {}) {
  const enabled = Boolean(cfg.apiKey) && cfg.live !== false;
  const model = cfg.model || 'gemini-flash-lite-latest';
  const dailyLimit = cfg.dailyLimit ?? 300;
  const q = {
    get: db.prepare('SELECT min, max FROM ai_players WHERE key = ?'),
    all: db.prepare('SELECT key, min, max FROM ai_players WHERE min IS NOT NULL'),
    put: db.prepare('INSERT OR IGNORE INTO ai_players (key, game_id, min, max, model, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    today: db.prepare('SELECT COUNT(*) AS n FROM ai_players WHERE created_at >= ?'),
  };
  const inflight = new Map();

  /** 저장된 값: undefined(아직 안 물음) | null(AI가 모름) | { min, max } */
  async function cached(game) {
    const row = await q.get.get(cacheKey(game));
    if (!row) return undefined;
    return Number.isInteger(row.min) ? { min: row.min, max: row.max } : null;
  }

  async function callGemini(game) {
    let res;
    try {
      res = await fetchImpl(`${cfg.apiBase || GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildPlayersPrompt(game) }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: { type: 'OBJECT', properties: { min: { type: 'INTEGER', nullable: true }, max: { type: 'INTEGER', nullable: true } }, required: ['min', 'max'] },
          },
        }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
      });
    } catch (e) {
      throw Object.assign(new Error(`Gemini API에 연결할 수 없습니다 (${netReason(e, cfg.timeoutMs ?? 15_000)})`), { code: 'GEMINI_NETWORK' });
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(`Gemini API 오류 (HTTP ${res.status})`), { code: res.status === 429 ? 'GEMINI_QUOTA' : 'GEMINI_HTTP' });
    const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ?? '';
    let obj;
    try {
      obj = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw Object.assign(new Error('Gemini 응답을 해석할 수 없습니다.'), { code: 'GEMINI_INVALID' });
    }
    return sanitize(obj, game); // 1 ≤ min ≤ max ≤ 32, IGDB 최대 인원 이하. 아니면 null(모름)
  }

  return {
    enabled,
    cached,
    /** 목록·추천용: 저장된 인원 전부 Map(cacheKey → { min, max }) */
    async all() {
      return new Map((await q.all.all()).map((r) => [r.key, { min: r.min, max: r.max }]));
    },
    /**
     * 저장된 값이 있으면 그것, 없으면 AI에게 물어 저장
     * @returns {Promise<{ players: {min:number,max:number}|null, status: 'cached'|'asked'|'off'|'limit'|'error' }>}
     */
    async ask(game, userId) {
      const key = cacheKey(game);
      const hit = await cached(game);
      if (hit !== undefined) return { players: hit, status: 'cached' };
      if (!enabled) return { players: null, status: 'off' };
      if (inflight.has(key)) return inflight.get(key);
      const today = new Date(now()).toISOString().slice(0, 10);
      if ((await q.today.get(today)).n >= dailyLimit) return { players: null, status: 'limit' };
      const p = (async () => {
        const t0 = now();
        try {
          const v = await callGemini(game);
          await q.put.run(key, game.id, v?.min ?? null, v?.max ?? null, model, userId ?? null, new Date(now()).toISOString());
          log(`[ai-players] ${game.id} ${v ? `${v.min}~${v.max}` : '모름'} (${now() - t0}ms)`);
          return { players: v, status: 'asked' };
        } catch (e) {
          log(`[ai-players] ${game.id} 실패: ${e.message}`);
          return { players: null, status: 'error' };
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },
  };
}
