// URL 쿼리 ↔ 조건 객체
export function criteriaFromSearch(search) {
  const sp = new URLSearchParams(search);
  const list = (k) => (sp.get(k) || '').split(',').map((s) => s.trim()).filter(Boolean);
  const n = Number(sp.get('players'));
  return {
    players: Number.isInteger(n) && n >= 1 && n <= 5 ? n : null,
    platforms: list('platforms'),
    genres: list('genres'),
  };
}

export function criteriaToSearch({ players, platforms, genres }) {
  const sp = new URLSearchParams();
  if (players != null) sp.set('players', String(players));
  if (platforms.length) sp.set('platforms', platforms.join(','));
  if (genres.length) sp.set('genres', genres.join(','));
  return sp.toString().replace(/%2C/g, ',');
}

export const hasAnyCriteria = (c) => c.players != null || c.platforms.length > 0 || c.genres.length > 0;
