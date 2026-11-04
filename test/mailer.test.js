import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, BREVO_URL } from '../server/community/mailer.js';
import { hashPassword, verifyPassword } from '../server/community/passwords.js';

test('Brevo 요청 형식, HTML 이스케이프, 실패 처리', async () => {
  let call;
  const m = createMailer({ apiKey: 'KEY', fromEmail: 'me@x.com', fromName: 'PlayPick' }, { fetchImpl: async (u, i) => { call = { u, i }; return { ok: true, status: 201 }; } });
  await m.send({ to: 'a@b.com', subject: '제목', lines: ['<script>x</script>'], link: 'http://l/?a=1&b=2' });
  assert.equal(call.u, BREVO_URL);
  assert.equal(call.i.headers['api-key'], 'KEY');
  const body = JSON.parse(call.i.body);
  assert.deepEqual(body.to, [{ email: 'a@b.com' }]);
  assert.deepEqual(body.sender, { email: 'me@x.com', name: 'PlayPick' });
  assert.ok(!body.htmlContent.includes('<script>'));
  assert.ok(body.htmlContent.includes('&amp;b=2'));
  const bad = createMailer({ apiKey: 'K', fromEmail: 'me@x.com' }, { fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(bad.send({ to: 'a@b.com', subject: 's', lines: [] }), { code: 'MAIL_HTTP' });
  await assert.rejects(createMailer({}).send({ to: 'a@b.com', subject: 's', lines: [] }), { code: 'MAIL_NOT_CONFIGURED' });
  const logged = [];
  await createMailer({ devLog: true }, { log: (x) => logged.push(x) }).send({ to: 'a@b.com', subject: 's', lines: ['hi'] });
  assert.match(logged[0], /mail-dev/);
});

test('비밀번호 해시: 같은 비밀번호도 매번 다른 값, 검증', () => {
  const a = hashPassword('secret123');
  assert.notEqual(a, hashPassword('secret123'));
  assert.ok(verifyPassword('secret123', a));
  assert.ok(!verifyPassword('secret124', a));
  assert.ok(!a.includes('secret123'));
});
