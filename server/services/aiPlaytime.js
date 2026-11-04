// 상세 화면에서 바로 묻는 AI 플레이 시간 (로그인한 회원이 상세를 열었을 때만)
//  - 플레이 시간이 아무 데도 없는 게임(제보·RAWG 파일·미리 받은 AI 파일 모두 없음)만 대상
//  - 결과는 DB(ai_playtime)에 저장 → 한 게임은 한 번만 물음. AI가 '모름'이라고 해도 저장(다시 묻지 않음)
//  - 하루 상한(dailyLimit, DB에 오늘 저장된 수 기준)을 넘거나 AI 오류면 저장하지 않고 '정보 없음' → 나중에 다시 시도
//  - 같은 게임을 여러 명이 동시에 열어도 AI 호출은 한 번
//  - 화면에는 항상 'AI 추정'으로 표시(source: 'ai'). 키는 서버에서만 사용
import { GEMINI_API_BASE, sanitizeHours } from './partySize.js';
import { netReason } from '../providers/errors.js';

const GRAC = '게임물관리위원회';

/** 게임 하나 → 프롬프트 (플레이 시간만) */
export function buildPlaytimePrompt(g) {
  const info =
    g.source === GRAC
      ? { name: g.title, note: 'Korean title from the Korean game rating board (GRAC)', publisher: g.publisher ?? null, platform: g.platformsRaw ?? null, genre: g.genresRaw ?? null }
      : { name: g.originalTitle || g.title, year: g.firstYear ?? (g.releaseDate ? Number(String(g.releaseDate).slice(0, 4)) : null), modes: g.gameModes ?? [], platforms: g.platformsRaw ?? null };
  return [
    'About how many hours does it take to finish the main content of the video game below (like HowLongToBeat "Main Story")? Answer with an integer.',
    'For endless multiplayer/live-service games without a real ending, return null.',
    'If you do not specifically know this exact game, return null. Do not guess from the title or genre.',
    'Return a JSON object {hours}.',
    '',
    JSON.stringify(info),
  ].join('\n');
}

/** 이 게임에 AI 플레이 시간을 물어볼 수 있는지 (데모·회원 제보 게임 제외) */
export const canAskPlaytime = (g) => !g.isDemo && (g.source === 'IGDB' || g.source === GRAC);

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ apiKey?: string, model?: string, apiBase?: string, live?: boolean, dailyLimit?: number, timeoutMs?: number }} cfg
 */
export function createAiPlaytime(db, cfg = {}, { fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {} } = {}) {
  const enabled = Boolean(cfg.apiKey) && cfg.live !== false;
  const model = cfg.model || 'gemini-flash-lite-latest';
  const dailyLimit = cfg.dailyLimit ?? 300;
  const q = {
    get: db.prepare('SELECT hours FROM ai_playtime WHERE game_id = ?'),
    put: db.prepare('INSERT OR IGNORE INTO ai_playtime (game_id, hours, model, requested_by, created_at) VALUES (?, ?, ?, ?, ?)'),
    today: db.prepare('SELECT COUNT(*) AS n FROM ai_playtime WHERE created_at >= ?'),
  };
  const inflight = new Map();

  /** 저장된 값: undefined(아직 안 물음) | null(AI가 모름) | 시간 */
  function cached(id) {
    const row = q.get.get(id);
    return row ? row.hours ?? null : undefined;
  }

  async function callGemini(game) {
    let res;
    try {
      res = await fetchImpl(`${cfg.apiBase || GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildPlaytimePrompt(game) }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: { type: 'OBJECT', properties: { hours: { type: 'INTEGER', nullable: true } }, required: ['hours'] },
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
    return sanitizeHours(obj?.hours);
  }

  return {
    enabled,
    cached,
    /**
     * 저장된 값이 있으면 그것, 없으면 AI에게 물어 저장
     * @returns {Promise<{ hours: number|null, status: 'cached'|'asked'|'off'|'limit'|'error' }>}
     */
    async ask(game, userId) {
      const hit = cached(game.id);
      if (hit !== undefined) return { hours: hit, status: 'cached' };
      if (!enabled) return { hours: null, status: 'off' };
      if (inflight.has(game.id)) return inflight.get(game.id);
      const today = new Date(now()).toISOString().slice(0, 10);
      if (q.today.get(today).n >= dailyLimit) return { hours: null, status: 'limit' };
      const p = (async () => {
        const t0 = now();
        try {
          const hours = await callGemini(game);
          q.put.run(game.id, hours, model, userId ?? null, new Date(now()).toISOString());
          log(`[ai-playtime] ${game.id} ${hours ?? '모름'} (${now() - t0}ms)`);
          return { hours, status: 'asked' };
        } catch (e) {
          log(`[ai-playtime] ${game.id} 실패: ${e.message}`);
          return { hours: null, status: 'error' };
        } finally {
          inflight.delete(game.id);
        }
      })();
      inflight.set(game.id, p);
      return p;
    },
  };
}
