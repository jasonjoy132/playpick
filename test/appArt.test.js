import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppArt } from '../server/services/appArt.js';

test('미리 받아 둔 App Store 아이콘: 게임위 게임에만, 이미지가 없을 때만 붙이고 App Store 링크도', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pp-art-')), 'app-store.json');
  const w = createAppArt(file);
  const g = { id: 'grac-1', title: '퍼즐왕 (모바일)', source: '게임물관리위원회', imageUrl: null, stores: [] };
  w.set(g, { imageUrl: 'https://is1-ssl.mzstatic.com/a.png', storeUrl: 'https://apps.apple.com/kr/app/id1', appName: '퍼즐왕' });
  w.set({ ...g, title: '없는 게임' }, { none: true });
  w.save();
  const r = createAppArt(file);
  const [a, b, c, d] = r.applyAll([
    { ...g, title: '퍼즐왕' }, // 플랫폼 표기만 다른 같은 게임
    { ...g, title: '없는 게임' },
    { ...g, source: 'IGDB' },
    { ...g, title: '퍼즐왕', imageUrl: 'https://x/y.png' },
  ]);
  assert.equal(a.imageUrl, 'https://is1-ssl.mzstatic.com/a.png');
  assert.equal(a.imageSource, 'App Store');
  assert.deepEqual(a.stores, [{ name: 'App Store', url: 'https://apps.apple.com/kr/app/id1', isDemo: false, appStore: true }]);
  assert.equal(b.imageUrl, null);
  assert.equal(r.has({ ...g, title: '없는 게임' }), true, '못 찾은 것도 확인한 것으로 기록');
  assert.equal(c.imageUrl, null, 'IGDB 게임은 건드리지 않음');
  assert.equal(d.imageUrl, 'https://x/y.png', '이미 이미지가 있으면 그대로');
});
