import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPartySize, sanitize, buildPrompt, cacheKey } from '../server/services/partySize.js';
import { gracItemToGame } from '../server/providers/gracProvider.js';
import { recommendFromIgdb } from '../server/providers/igdbProvider.js';
import { evaluateGame } from '../server/services/recommend.js';

test('IGDB로 정하는 추천 인원: 협동 인원 우선, 최대 8명 이하면 그대로, 큰 대전만 있으면 null', () => {
  const pubgLike = { game_modes: [{ name: 'Single player' }, { name: 'Multiplayer' }], multiplayer_modes: [{ onlinemax: 100, onlinecoopmax: 4 }] };
  assert.deepEqual(recommendFromIgdb(pubgLike), { min: 1, max: 4, source: 'igdb-coop' });
  assert.deepEqual(recommendFromIgdb({ game_modes: [{ name: 'Multiplayer' }], multiplayer_modes: [{ offlinemax: 4 }] }), { min: 2, max: 4, source: 'igdb' });
  assert.deepEqual(recommendFromIgdb({ game_modes: [{ name: 'Single player' }] }), { min: 1, max: 1, source: 'igdb' });
  assert.equal(recommendFromIgdb({ game_modes: [{ name: 'Multiplayer' }], multiplayer_modes: [{ onlinemax: 100 }] }), null);
  assert.equal(recommendFromIgdb({}), null);
});

test('추천 인원으로 판정: 배그(최대 100, 추천 1~4)는 5명 이상에 불일치', () => {
  const game = { title: 'X', players: { min: 1, max: 100 }, recommendedPlayers: { min: 1, max: 4, source: 'ai' }, platforms: ['pc'], genres: ['shooting'] };
  const st = (n) => evaluateGame(game, { players: n, platforms: [], genres: [] }).checks[0].status;
  assert.equal(st(4), 'match');
  assert.equal(st(5), 'mismatch');
  assert.equal(evaluateGame({ ...game, recommendedPlayers: null }, { players: 2, platforms: [], genres: [] }).checks[0].status, 'unknown', 'AI 값을 아직 모르면 정보 없음');
  assert.equal(evaluateGame({ title: 'G', players: { min: 1, max: 2 } }, { players: 2, platforms: [], genres: [] }).checks[0].status, 'match', '추천 인원 키가 없는 게임(게임위·데모)은 기존대로');
});

test('AI 값 검증', () => {
  assert.deepEqual(sanitize({ min: 1, max: 4 }, { players: { max: 100 } }), { min: 1, max: 4 });
  assert.deepEqual(sanitize({ min: 1, max: 6 }, { players: { max: 4 } }), { min: 1, max: 4 }, 'IGDB 최대 인원을 넘지 않게');
  assert.equal(sanitize({ min: null, max: null }), null);
  assert.equal(sanitize({ min: 3, max: 2 }), null);
  assert.equal(sanitize({ min: 1, max: 100 }), null, '파티 인원으로 너무 큼');
  assert.match(buildPrompt([{ id: 'igdb-27789', source: 'IGDB', title: '배틀그라운드', originalTitle: 'PUBG: BATTLEGROUNDS', firstYear: 2017, players: { max: 100 } }]), /"id":1,"name":"PUBG: BATTLEGROUNDS","year":2017/);
});

const big = (id, name) => ({ id: `igdb-${id}`, title: name, source: 'IGDB', players: { min: 1, max: 100 }, recommendedPlayers: null });

function gemini(reply, calls = []) {
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply(JSON.parse(init.body))) }] } }] }) };
  };
  fn.calls = calls;
  return fn;
}

test('Gemini: 필요한 게임만 한 번에 묻고, 결과 캐시, 모르는 게임은 정보 없음', async () => {
  const fetchImpl = gemini(() => [{ id: 1, min: 1, max: 4 }, { id: 2, min: null, max: null }]);
  const ps = createPartySize({ apiKey: 'K', live: true, model: 'gemini-test' }, { fetchImpl });
  const known = { id: 'igdb-3', title: 'Co-op', source: 'IGDB', players: { min: 1, max: 4 }, recommendedPlayers: { min: 1, max: 4, source: 'igdb-coop' } };
  const { games, warning } = await ps.fill([big(1, 'PUBG'), big(2, 'Obscure'), known]);
  assert.equal(warning, null);
  assert.deepEqual(games[0].recommendedPlayers, { min: 1, max: 4, source: 'ai' });
  assert.equal(games[1].recommendedPlayers, null);
  assert.equal(games[2].recommendedPlayers.source, 'igdb-coop');
  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.match(call.url, /models\/gemini-test:generateContent$/);
  assert.equal(call.init.headers['x-goog-api-key'], 'K');
  assert.doesNotMatch(call.url, /key=/, '키는 헤더로만');
  assert.doesNotMatch(call.init.body, /Co-op/, 'IGDB로 정해진 게임은 묻지 않음');
  await ps.fill([big(1, 'PUBG'), big(2, 'Obscure')]);
  assert.equal(fetchImpl.calls.length, 1, '캐시');
});

test('Gemini 실패 → 정보 없음 + 경고, 키 없으면 IGDB 최대 인원 사용', async () => {
  const bad = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) });
  const r = await createPartySize({ apiKey: 'K', live: true }, { fetchImpl: bad }).fill([big(1, 'PUBG')]);
  assert.equal(r.games[0].recommendedPlayers, null);
  assert.match(r.warning, /HTTP 429/);
  const none = createPartySize({});
  assert.deepEqual((await none.fill([big(1, 'PUBG')])).games[0].recommendedPlayers, { min: 1, max: 100, source: 'igdb' });
  assert.deepEqual(none.applyCached([big(1, 'PUBG')])[0].recommendedPlayers, { min: 1, max: 100, source: 'igdb' });
});

test('게임위 전용 게임도 AI에게: 한글 제목·업체·플랫폼·장르를 주고, 같은 기본 제목은 한 번만', async () => {
  const gr = (no, title) => ({ ...gracItemToGame({ rateno: { _text: no }, gametitle: { _text: title }, entname: { _text: '테스트게임즈' }, platform: { _text: '모바일 게임' }, genre: { _text: '퍼즐' }, rateddate: { _text: '2026-05-01' } }) });
  const a = gr('A-1', '테스트 퍼즐 (모바일)');
  const b = gr('A-2', '테스트 퍼즐');
  assert.equal(a.recommendedPlayers, null, '게임위 게임은 AI 추정 대상');
  assert.equal(cacheKey(a), cacheKey(b), '플랫폼 표기만 다르면 같은 캐시');
  const prompt = buildPrompt([a]);
  assert.match(prompt, /"name":"테스트 퍼즐 \(모바일\)","note":"Korean title/);
  assert.match(prompt, /"publisher":"테스트게임즈","platform":"모바일 게임","genre":"퍼즐","ratedYear":2026/);
  const calls = [];
  const ps = createPartySize({ apiKey: 'K', live: true }, { fetchImpl: gemini(() => [{ id: 1, min: 1, max: 1 }], calls) });
  const { games } = await ps.fill([a, b]);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].init.body).contents[0].parts[0].text.match(/"id":/g).length, 1, '같은 게임은 한 번만 물음');
  assert.deepEqual(games.map((g) => g.recommendedPlayers), [{ min: 1, max: 1, source: 'ai' }, { min: 1, max: 1, source: 'ai' }]);
});

test('빠르게: 12개씩 나눠 동시에 묻고, thinking 설정이 안 맞으면 다른 방식으로 다시', async () => {
  const games = Array.from({ length: 30 }, (_, i) => big(100 + i, `G${i}`));
  let inFlight = 0;
  let maxInFlight = 0;
  const bodies = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.generationConfig.thinkingConfig?.thinkingLevel) {
      const err = { error: { message: 'Unknown name "thinkingLevel" at generation_config.thinking_config' } };
      return { ok: false, status: 400, json: async () => err, clone: () => ({ json: async () => err }) };
    }
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    const n = body.contents[0].parts[0].text.match(/"id":/g).length;
    const reply = Array.from({ length: n }, (_, i) => ({ id: i + 1, min: 1, max: 4 }));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) };
  };
  const ps = createPartySize({ apiKey: 'K', live: true, model: 'gemini-test-flash' }, { fetchImpl });
  const [a, b] = await Promise.all([ps.fill(games), ps.fill(games.slice(0, 5))]);
  assert.ok(a.games.every((g) => g.recommendedPlayers?.source === 'ai'));
  assert.ok(b.games.every((g) => g.recommendedPlayers?.source === 'ai'), '동시에 들어온 요청은 같은 답을 기다림');
  const ok = bodies.filter((x) => !x.generationConfig.thinkingConfig?.thinkingLevel);
  assert.equal(ok.length, 3, '30개 → 12·12·6 세 번 (두 번째 요청은 다시 묻지 않음)');
  assert.ok(maxInFlight >= 2, '동시에 호출');
  assert.ok(ok.every((x) => x.generationConfig.thinkingConfig?.thinkingBudget === 0), 'thinkingLevel 안 되면 thinkingBudget 0');
});

test('연결 실패 원인을 메시지에 표시', async () => {
  const { netReason } = await import('../server/providers/errors.js');
  const timeout = Object.assign(new Error('x'), { name: 'TimeoutError' });
  assert.equal(netReason(timeout, 60_000), '60초 안에 응답 없음');
  assert.equal(netReason(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })), 'ENOTFOUND: 주소를 찾지 못함(DNS)');
  const r = await createPartySize({ apiKey: 'K', live: true }, { fetchImpl: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); } }).fill([big(9, 'X')]);
  assert.match(r.warning, /ECONNRESET: 연결 끊김/);
});

test('AI가 늦으면 검색을 붙잡지 않고 먼저 보여 줌, 받은 값은 다음 검색에 표시', async () => {
  const slow = gemini(() => [{ id: 1, min: 1, max: 4 }]);
  const fetchImpl = async (...a) => {
    await new Promise((r) => setTimeout(r, 150));
    return slow(...a);
  };
  const ps = createPartySize({ apiKey: 'K', live: true }, { fetchImpl });
  const t0 = Date.now();
  const r = await ps.fill([big(50, 'Slow')], { waitMs: 30 });
  assert.ok(Date.now() - t0 < 120, '기다리지 않음');
  assert.equal(r.late, true);
  assert.equal(r.games[0].recommendedPlayers, null);
  assert.match(r.warning, /받는 중/);
  await new Promise((res) => setTimeout(res, 200));
  assert.deepEqual(ps.applyCached([big(50, 'Slow')])[0].recommendedPlayers, { min: 1, max: 4, source: 'ai' });
});

test('Lite 모델은 thinking 설정 없이, 사용량 초과(429)면 잠시 묻지 않음', async () => {
  const bodies = [];
  let status = 429;
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    if (status === 429) return { ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '[{"id":1,"min":1,"max":4}]' }] } }] }) };
  };
  let t = 1_000_000;
  const ps = createPartySize({ apiKey: 'K', live: true }, { fetchImpl, now: () => t });
  assert.equal(ps.model, 'gemini-flash-lite-latest');
  const r1 = await ps.fill([big(70, 'A')]);
  assert.match(r1.warning, /사용량을 넘었습니다/);
  assert.equal(bodies[0].generationConfig.thinkingConfig, undefined, 'Lite는 thinking 설정 안 보냄');
  status = 200;
  await ps.fill([big(71, 'B')]);
  assert.equal(bodies.length, 1, '10분 동안은 호출 안 함');
  t += 11 * 60_000;
  const r3 = await ps.fill([big(71, 'B')]);
  assert.equal(r3.games[0].recommendedPlayers.source, 'ai');
});

test('미리 정리 모드(기본): 검색 중엔 AI를 부르지 않고 파일 값만, askBatch는 태그와 함께 파일에 저장', async () => {
  const fsm = await import('node:fs');
  const os = await import('node:os');
  const pathm = await import('node:path');
  const dir = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'pp-party-'));
  const dataFile = pathm.join(dir, 'party-size.json');
  const calls = [];
  const fetchImpl = gemini(() => [{ id: 1, min: 1, max: 4, hours: 0 }, { id: 2, min: null, max: null, hours: null }], calls);
  const writer = createPartySize({ apiKey: 'K', dataFile }, { fetchImpl, now: () => Date.parse('2026-10-29T00:00:00Z') });
  assert.equal(writer.live, false);
  const r = await writer.fill([big(1, 'PUBG')]);
  assert.equal(calls.length, 0, '검색 중에는 호출 안 함');
  assert.equal(r.games[0].recommendedPlayers, null, '정리 안 된 게임은 정보 없음');
  assert.ok(writer.isMissing(big(1, 'PUBG')));
  assert.deepEqual(await writer.askBatch([big(1, 'PUBG'), big(2, 'Obscure')]), { known: 1, unknown: 1, hoursKnown: 0, playersAsked: 2, endedCount: 0, upcomingCount: 0 });
  const saved = JSON.parse(fsm.readFileSync(dataFile, 'utf8'));
  assert.deepEqual(saved['1'], { min: 1, max: 4, hours: null, model: 'gemini-flash-lite-latest', date: '2026-10-29', at: Date.parse('2026-10-29T00:00:00Z') });
  assert.equal(saved['2'].unknown, true);

  // 서버(새로 켜짐)는 키 없이도 파일만 읽어 표시, 오래된 값도 만료 안 됨
  const server = createPartySize({ dataFile }, { now: () => Date.parse('2027-12-31') });
  const [a, b] = server.applyCached([big(1, 'PUBG'), big(2, 'Obscure')]);
  assert.deepEqual(a.recommendedPlayers, { min: 1, max: 4, source: 'ai' });
  assert.equal(b.recommendedPlayers, null);
  assert.equal(server.isMissing(big(2, 'Obscure')), false, 'AI도 모른다고 한 게임은 다시 묻지 않음');
  assert.equal(server.applyCached([big(3, 'New')])[0].recommendedPlayers, null, '데이터가 있으면 없는 게임을 최대 인원으로 대신하지 않음');
});

test('AI 플레이 시간: 함께 묻고 저장, 예전 형식(인원만)은 다시 정리 대상, 화면용 aiPlaytime', async () => {
  const fsm = await import('node:fs');
  const os = await import('node:os');
  const pathm = await import('node:path');
  const dataFile = pathm.join(fsm.mkdtempSync(pathm.join(os.tmpdir(), 'pp-hours-')), 'party-size.json');
  fsm.writeFileSync(dataFile, JSON.stringify({ 1: { min: 1, max: 4, model: 'old', date: '2026-10-01', at: 1 } }));
  const calls = [];
  const ps = createPartySize({ apiKey: 'K', dataFile }, { fetchImpl: gemini(() => [{ id: 1, min: 1, max: 4, hours: 45 }, { id: 2, min: 1, max: 1, hours: 5000 }], calls) });
  const coop = { id: 'igdb-2', title: 'Coop', source: 'IGDB', players: { min: 1, max: 4 }, recommendedPlayers: { min: 1, max: 4, source: 'igdb-coop' } };
  assert.equal(ps.needsPrefill(big(1, 'PUBG')), true, '인원만 있는 예전 형식은 플레이 시간 때문에 다시');
  assert.equal(ps.needsPrefill(coop), true, 'IGDB로 인원이 정해진 게임도 플레이 시간은 물음');
  assert.equal(ps.needsPrefill({ id: 'demo-1', title: 'D', source: '데모' }), false);
  const r = await ps.askBatch([big(1, 'PUBG'), coop]);
  assert.equal(r.hoursKnown, 1);
  assert.match(JSON.parse(calls[0].init.body).contents[0].parts[0].text, /HowLongToBeat/);
  const [a, b] = ps.applyCached([big(1, 'PUBG'), coop]);
  assert.equal(a.aiPlaytime, 45);
  assert.equal(b.aiPlaytime, undefined, '1000시간 넘는 값은 버림');
  assert.equal(b.recommendedPlayers.source, 'igdb-coop', 'IGDB 추천 인원은 그대로');
  assert.equal(ps.needsPrefill(big(1, 'PUBG')), false);
});

test('IGDB로 추천 인원이 정해진 게임은 플레이 시간만 묻고, AI 인원은 저장하지 않음', async () => {
  const calls = [];
  const ps = createPartySize({ apiKey: 'K' }, { fetchImpl: gemini(() => [{ id: 1, min: 1, max: 99, hours: 20 }], calls) });
  const coop = { id: 'igdb-9', title: 'Coop', originalTitle: 'Coop Game', source: 'IGDB', firstYear: 2020, players: { min: 1, max: 4 }, recommendedPlayers: { min: 1, max: 4, source: 'igdb-coop' } };
  const r = await ps.askBatch([coop]);
  assert.deepEqual(r, { known: 0, unknown: 0, hoursKnown: 1, playersAsked: 0, endedCount: 0, upcomingCount: 0 });
  assert.match(calls[0].init.body, /onlyHours/);
  const [g] = ps.applyCached([coop]);
  assert.deepEqual(g.recommendedPlayers, { min: 1, max: 4, source: 'igdb-coop' });
  assert.equal(g.aiPlaytime, 20);
});


test('예전에 저장한 AI 인원 정리: IGDB 인원이 있는 게임은 AI 인원만 지우고 플레이 시간은 유지', async () => {
  const fsm = await import('node:fs');
  const os = await import('node:os');
  const pathm = await import('node:path');
  const dataFile = pathm.join(fsm.mkdtempSync(pathm.join(os.tmpdir(), 'pp-drop-')), 'party-size.json');
  fsm.writeFileSync(dataFile, JSON.stringify({ 9: { min: 1, max: 40, hours: 30, model: 'm', date: 'd', at: 1 }, 1: { min: 1, max: 4, hours: 10, at: 1 } }));
  const ps = createPartySize({ dataFile });
  const coop = { id: 'igdb-9', title: 'Coop', source: 'IGDB', players: { min: 1, max: 4 }, recommendedPlayers: { min: 1, max: 4, source: 'igdb-coop' } };
  assert.equal(ps.dropAiPlayers(coop), true);
  assert.equal(ps.dropAiPlayers(coop), false, '두 번째는 지울 것 없음');
  assert.equal(ps.dropAiPlayers(big(1, 'PUBG')), false, 'AI 인원이 필요한 게임은 그대로');
  ps.save();
  const saved = JSON.parse(fsm.readFileSync(dataFile, 'utf8'));
  assert.deepEqual(saved['9'], { hours: 30, model: 'm', date: 'd', at: 1 });
  assert.equal(saved['1'].min, 1);
});

test('게임위 게임 서비스 종료(AI 판단): 확실히 종료라고 한 게임만 aiEnded, 예전 항목은 다시 정리 대상', async () => {
  const gr = (no, title) => ({ ...gracItemToGame({ rateno: { _text: no }, gametitle: { _text: title }, platform: { _text: '모바일 게임' }, genre: { _text: '퍼즐' } }) });
  const a = gr('E-1', '종료된 게임');
  const b = gr('E-2', '서비스 중인 게임');
  const c = gr('E-3', '모르는 게임');
  const calls = [];
  const ps = createPartySize({ apiKey: 'K' }, { fetchImpl: gemini(() => [{ id: 1, min: 1, max: 1, hours: 5, ended: true }, { id: 2, min: 1, max: 1, hours: 5, ended: false }, { id: 3, min: null, max: null, hours: null, ended: null }], calls) });
  assert.equal(ps.needsPrefill(a), true);
  const r = await ps.askBatch([a, b, c]);
  assert.equal(r.endedCount, 1);
  const text = JSON.parse(calls[0].init.body).contents[0].parts[0].text;
  assert.match(text, /askEnded/);
  const [x, y, z] = ps.applyCached([a, b, c]);
  assert.equal(x.aiEnded, true);
  assert.equal(y.aiEnded, undefined);
  assert.equal(z.aiEnded, undefined, '모르면 숨기지 않음');
  assert.equal(ps.needsPrefill(c), false, '모른다고 한 것도 다시 묻지 않음');
  const igdbGame = big(77, 'Online');
  await ps.askBatch([igdbGame]);
  assert.equal(ps.applyCached([igdbGame])[0].aiEnded, undefined, 'IGDB 게임은 IGDB 상태를 따름');
});

test('서비스 상태(AI): 게임위는 출시 예정/종료, 온라인 IGDB 게임은 종료 여부, 예전 판단은 이어서 사용', async () => {
  const gr = (no, title) => ({ ...gracItemToGame({ rateno: { _text: no }, gametitle: { _text: title }, platform: { _text: '모바일 게임' }, genre: { _text: '퍼즐' } }) });
  const up = gr('U-1', '나올 게임');
  const live = gr('U-2', '서비스 중 게임');
  const mmo = { id: 'igdb-501', title: 'Old MMO', source: 'IGDB', gameModes: ['Massively Multiplayer Online (MMO)'], players: { min: 1, max: 100 }, recommendedPlayers: null };
  const solo = { id: 'igdb-502', title: 'Solo', source: 'IGDB', gameModes: ['Single player'], players: { min: 1, max: 1 }, recommendedPlayers: { min: 1, max: 1, source: 'igdb' } };
  const calls = [];
  const ps = createPartySize({ apiKey: 'K' }, {
    fetchImpl: gemini(() => [
      { id: 1, min: null, max: null, hours: null, ended: null, status: 'upcoming' },
      { id: 2, min: 1, max: 1, hours: 3, ended: null, status: 'released' },
      { id: 3, min: 1, max: 5, hours: null, ended: true, status: null },
      { id: 4, min: null, max: null, hours: 10, ended: true, status: null },
    ], calls),
  });
  assert.equal(ps.needsPrefill(mmo), true);
  const r = await ps.askBatch([up, live, mmo, solo]);
  assert.equal(r.upcomingCount, 1);
  assert.equal(r.endedCount, 1, '싱글 게임의 ended는 무시');
  const text = JSON.parse(calls[0].init.body).contents[0].parts[0].text;
  assert.match(text, /Today is \d{4}-\d{2}-\d{2}/);
  assert.match(text, /"askStatus":true/);
  assert.match(text, /"name":"Old MMO".*"askEnded":true/);
  const [a, b, c, d] = ps.applyCached([up, live, mmo, solo]);
  assert.equal(a.aiUpcoming, true);
  assert.equal(a.aiEnded, undefined);
  assert.equal(b.aiUpcoming, undefined);
  assert.equal(c.aiEnded, true, '온라인 IGDB 게임도 종료면 숨김');
  assert.equal(d.aiEnded, undefined);
  assert.equal(ps.needsPrefill(mmo), false);
});

test('게임위 상태 엄격 재확인: 예전 released만 대상, 상태만 바꾸고 인원·플레이 시간 유지, released면 aiAlive', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ps-')), 'party-size.json');
  const g = (t) => ({ id: `grac-${t}`, title: t, source: '게임물관리위원회', publisher: 'P', recommendedPlayers: null });
  const A = g('알려진 게임');
  const B = g('모르는 게임');
  const C = g('예전 모름');
  fs.writeFileSync(file, JSON.stringify({ [cacheKey(A)]: { min: 1, max: 4, hours: 10, status: 'released', ended: false }, [cacheKey(B)]: { unknown: true, hours: null, status: 'released', ended: false }, [cacheKey(C)]: { unknown: true, hours: null, status: null, ended: null } }));
  const calls = [];
  const ps = createPartySize({ apiKey: 'K', dataFile: file }, { fetchImpl: gemini(() => [{ id: 1, status: 'released' }, { id: 2, status: null }], calls) });
  assert.equal(ps.applyCached([A])[0].aiAlive, true, '재확인 전 released');
  assert.equal(ps.applyCached([C])[0].aiAlive, undefined, '모름은 aiAlive 없음');
  assert.deepEqual([A, B, C].map(ps.needsStatusRecheck), [true, true, false]);
  const r = await ps.askStatusBatch([A, B]);
  assert.deepEqual(r.status, { released: 1, ended: 0, upcoming: 0, unknown: 1 });
  const prompt = JSON.parse(calls[0].init.body).contents[0].parts[0].text;
  assert.match(prompt, /When in doubt, return null/);
  assert.match(prompt, /"name":"알려진 게임"/);
  const [a, b] = ps.applyCached([A, B]);
  assert.equal(a.aiAlive, true);
  assert.deepEqual(a.recommendedPlayers, { min: 1, max: 4, source: 'ai' }, '인원 유지');
  assert.equal(a.aiPlaytime, 10, '플레이 시간 유지');
  assert.equal(b.aiAlive, undefined, '모르면 목록에서 숨김 대상');
  assert.deepEqual([A, B].map(ps.needsStatusRecheck), [false, false], '한 번 재확인하면 다시 묻지 않음');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[cacheKey(A)].statusV, 2);
});

test("'모름' 재확인: 상태를 모르는 게임위 게임만, 같은 모델로는 한 번만", async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ps-')), 'party-size.json');
  const g = (t) => ({ id: `grac-${t}`, title: t, source: '게임물관리위원회', recommendedPlayers: null });
  const U = g('모름 게임');
  const R = g('서비스 게임');
  const E = g('종료 게임');
  fs.writeFileSync(file, JSON.stringify({ [cacheKey(U)]: { unknown: true, hours: null, status: null, ended: null }, [cacheKey(R)]: { hours: null, status: 'released', ended: false }, [cacheKey(E)]: { hours: null, status: 'ended', ended: true } }));
  const ps = createPartySize({ apiKey: 'K', dataFile: file, model: 'gemini-big' }, { fetchImpl: gemini(() => [{ id: 1, status: null }]) });
  assert.deepEqual([U, R, E].map(ps.needsUnknownRecheck), [true, false, false]);
  await ps.askStatusBatch([U]);
  assert.equal(ps.needsUnknownRecheck(U), false, '같은 모델로 다시 묻지 않음');
  const other = createPartySize({ apiKey: 'K', dataFile: file, model: 'gemini-bigger' });
  assert.equal(other.needsUnknownRecheck(U), true, '다른 모델이면 다시 물을 수 있음');
});

test('IGDB 서비스 종료 확인: 온라인 모드 게임만 대상, 종료만 저장하고 인원·시간 유지, 종료면 숨김 표시', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { mayEnd } = await import('../server/services/partySize.js');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ps-')), 'party-size.json');
  const online = { id: 'igdb-501', title: 'BubbleFighter', source: 'IGDB', gameModes: ['Multiplayer'], recommendedPlayers: null };
  const solo = { id: 'igdb-502', title: 'Solo', source: 'IGDB', gameModes: ['Single player'], recommendedPlayers: { min: 1, max: 1, source: 'igdb' } };
  const kept = { id: 'igdb-503', title: 'Kept', source: 'IGDB', gameModes: ['Co-operative'], recommendedPlayers: null };
  fs.writeFileSync(file, JSON.stringify({ 503: { min: 1, max: 4, hours: 20, ended: null } }));
  assert.equal(mayEnd(online), true);
  assert.equal(mayEnd(solo), false);
  const calls = [];
  const ps = createPartySize({ apiKey: 'K', dataFile: file, model: 'gemini-x' }, { fetchImpl: gemini(() => [{ id: 1, ended: true }, { id: 2, ended: false }], calls) });
  assert.deepEqual([online, solo, kept].map((g) => ps.needsEndedCheck(g)), [true, false, true]);
  assert.equal(ps.needsEndedCheck(solo, { force: true }), true, '게임위 등급 게임은 모드와 상관없이');
  const r = await ps.askEndedBatch([online, kept]);
  assert.equal(r.ended, 1);
  assert.match(JSON.parse(calls[0].init.body).contents[0].parts[0].text, /When in doubt, return null/);
  const [a, b] = ps.applyCached([online, kept]);
  assert.equal(a.aiEnded, true, '종료 → 목록에서 숨김');
  assert.equal(a.recommendedPlayers, null, '인원을 안 물은 항목은 추천 인원 없음 그대로');
  assert.equal(b.aiEnded, undefined);
  assert.deepEqual(b.recommendedPlayers, { min: 1, max: 4, source: 'ai' }, '기존 인원 유지');
  assert.equal(b.aiPlaytime, 20);
  assert.equal(ps.needsEndedCheck(online), false, '같은 모델로 다시 묻지 않음');
});

test('게임위 게임 추천 인원만 묻기: 상태·플레이 시간은 그대로, AI가 안다고 한 게임만 저장', async () => {
  const fsm = await import('node:fs');
  const os = await import('node:os');
  const pathm = await import('node:path');
  const { buildPlayersPrompt } = await import('../server/services/partySize.js');
  const dir = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'pp-party-'));
  const dataFile = pathm.join(dir, 'party-size.json');
  const grac = (title) => ({ ...gracItemToGame({ gametitle: title, rateno: title, entname: '테스트사', platform: '모바일 게임', genre: '퍼즐' }) });
  const known = grac('유명 게임');
  const guess = grac('작은 게임');
  const ended = grac('끝난 게임');
  // 예전 형식: 상태·플레이 시간만 있고 인원 답이 없음
  fsm.writeFileSync(dataFile, JSON.stringify({
    [cacheKey(known)]: { hours: 10, status: 'released', ended: false, statusV: 2, model: 'm', date: '2026-10-01', at: 1 },
    [cacheKey(guess)]: { hours: null, status: 'released', ended: false, model: 'm', date: '2026-10-01', at: 1 },
    [cacheKey(ended)]: { hours: null, status: 'ended', ended: true, model: 'm', date: '2026-10-01', at: 1 },
  }));
  const calls = [];
  // 작은 게임은 known:false 인데 숫자를 줘도(장르로 짐작) 저장하면 안 됨
  const fetchImpl = gemini(() => [{ id: 1, known: true, min: 1, max: 4 }, { id: 2, known: false, min: 1, max: 1 }], calls);
  const ps = createPartySize({ apiKey: 'K', dataFile }, { fetchImpl, now: () => Date.parse('2026-11-05T00:00:00Z') });
  assert.equal(ps.isMissing(known), true, '상태만 있고 인원 답이 없으면 아직 안 물은 것');
  assert.equal(ps.needsPlayers(known), true);
  assert.equal(ps.needsPlayers(ended), false, '종료된 게임은 묻지 않음');
  assert.equal(ps.needsPrefill(known), false, '전체 다시 묻기 대상은 아님(상태를 덮어쓰지 않게)');

  assert.deepEqual(await ps.askPlayersBatch([known, guess]), { known: 1, unknown: 1 });
  const prompt = JSON.parse(calls[0].init.body).contents[0].parts[0].text;
  assert.match(prompt, /"known": true ONLY if you specifically recognize/);
  assert.equal(prompt, buildPlayersPrompt([known, guess]));
  const saved = JSON.parse(fsm.readFileSync(dataFile, 'utf8'));
  assert.deepEqual(saved[cacheKey(known)], { hours: 10, status: 'released', ended: false, statusV: 2, model: 'm', date: '2026-10-01', at: 1, min: 1, max: 4, playersModel: 'gemini-flash-lite-latest', playersDate: '2026-11-05' });
  assert.equal(saved[cacheKey(guess)].unknown, true);
  assert.equal(saved[cacheKey(guess)].min, undefined, '짐작한 숫자는 저장 안 함');
  assert.equal(saved[cacheKey(guess)].status, 'released', '상태 그대로');

  const [a, b] = ps.applyCached([known, guess]);
  assert.deepEqual(a.recommendedPlayers, { min: 1, max: 4, source: 'ai' });
  assert.equal(b.recommendedPlayers, null);
  assert.equal(ps.needsPlayers(guess), false, '모름도 다시 묻지 않음');
});

test('서비스 종료 확인 대상: 모드 정보 없는 PC·모바일 IGDB 게임 포함, Gemini가 서비스 중이라 한 게임도 외부 재확인 대상', async () => {
  const fsm = await import('node:fs');
  const os = await import('node:os');
  const pathm = await import('node:path');
  const { mayEnd } = await import('../server/services/partySize.js');
  const ig = (id, extra) => ({ id: `igdb-${id}`, title: `G${id}`, source: 'IGDB', recommendedPlayers: { min: 1, max: 4, source: 'igdb' }, ...extra });
  assert.equal(mayEnd(ig(1, { gameModes: [], platformsRaw: 'PC (Microsoft Windows)' })), true, '모드 정보 없는 PC 게임');
  assert.equal(mayEnd(ig(2, { gameModes: [], platformsRaw: 'Nintendo Switch' })), false, '모드 없는 콘솔 게임은 아님');
  assert.equal(mayEnd(ig(3, { gameModes: ['Single player'], platformsRaw: 'PC (Microsoft Windows)' })), false);

  const dir = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'pp-party-'));
  const dataFile = pathm.join(dir, 'party-size.json');
  const online = (id) => ig(id, { gameModes: ['Multiplayer'], platformsRaw: 'PC (Microsoft Windows)' });
  fsm.writeFileSync(dataFile, JSON.stringify({
    10: { ended: false, endedV: 2, endedModels: ['gemini-3.1-flash-lite'] }, // Gemini: 서비스 중
    11: { ended: true, endedV: 2, endedModels: ['gemini-3.1-flash-lite'] }, // 이미 종료
    12: { ended: false, endedV: 2, endedModels: ['external'] }, // 외부 AI가 이미 확인
  }));
  const ps = createPartySize({ dataFile });
  assert.equal(ps.needsExternalEndedCheck(online(10)), true, 'Gemini가 서비스 중이라 한 게임 → 외부 재확인');
  assert.equal(ps.needsEndedCheck(online(10)), false, 'Gemini로는 다시 묻지 않음(같은 답)');
  assert.equal(ps.needsExternalEndedCheck(online(11)), false, '이미 종료로 숨김');
  assert.equal(ps.needsExternalEndedCheck(online(12)), false, '외부 AI가 이미 확인');
  assert.equal(ps.needsExternalEndedCheck(online(13)), true, '아직 안 물어본 게임');
});
