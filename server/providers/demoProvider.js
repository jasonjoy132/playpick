import { DEMO_GAMES } from '../data/demoGames.js';

export function createDemoProvider() {
  return {
    name: 'demo',
    label: '데모 데이터',
    isDemo: true,
    async listGames() {
      return DEMO_GAMES;
    },
    async getGame(id) {
      return DEMO_GAMES.find((g) => g.id === id) ?? null;
    },
  };
}
