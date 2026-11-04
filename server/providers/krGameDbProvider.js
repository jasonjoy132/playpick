// 국내 게임 DB API 모듈 (자리만 마련됨)
// 원페이저·발표 대본에는 '국내 게임 DB API'라고만 되어 있고 구체적인 서비스명·문서가 없습니다.
// 어떤 API를 사용할지 정해지면 아래 enrich() 를 구현해, 게임위 데이터에 없는
// 플레이 인원수(players)·구매처(stores)·이미지(imageUrl) 등을 '확인된 값'으로만 채우세요.
import { DataSourceError } from './errors.js';

export function createKrGameDbProvider(cfg) {
  const configured = Boolean(cfg.url && cfg.key);
  return {
    name: 'kr-game-db',
    label: '국내 게임 DB',
    configured,
    implemented: false,
    /** @param {object[]} games 게임위 기반 게임 목록 → 보강된 목록 */
    async enrich(games) {
      if (!configured) return games; // 미설정: 보강하지 않음(인원수·구매처는 '정보 없음' 유지)
      throw new DataSourceError(
        'NOT_IMPLEMENTED',
        '국내 게임 DB API 키가 설정되었지만 연동 대상 서비스가 정해지지 않아 아직 구현되지 않았습니다.',
        501,
      );
    },
  };
}
