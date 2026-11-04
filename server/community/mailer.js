// 메일 발송 (Brevo 트랜잭션 메일 API)
// 문서: https://developers.brevo.com/reference/sendtransacemail
//   POST https://api.brevo.com/v3/smtp/email, 헤더 api-key, { sender, to:[{email}], subject, htmlContent } → 201 { messageId }
// - 키가 없으면 보낸 척하지 않고 MAIL_NOT_CONFIGURED 오류
// - MAIL_DEV_LOG=true 일 때만(개발용) 메일 대신 서버 콘솔에 내용을 출력
import { DataSourceError } from '../providers/errors.js';

export const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createMailer(cfg = {}, { fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const configured = Boolean(cfg.apiKey && cfg.fromEmail);
  async function send({ to, subject, lines, link }) {
    const html = `<div style="font-family:sans-serif;line-height:1.6">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}${
      link ? `<p><a href="${esc(link)}">${esc(link)}</a></p>` : ''
    }<p style="color:#888">플레이픽(PlayPick)</p></div>`;
    if (!configured) {
      if (cfg.devLog) {
        log(`[playpick:mail-dev] to=${to} subject=${subject}\n  ${lines.join('\n  ')}${link ? `\n  ${link}` : ''}`);
        return { dev: true };
      }
      throw new DataSourceError('MAIL_NOT_CONFIGURED', '메일 발송 설정(BREVO_API_KEY, MAIL_FROM_EMAIL)이 없어 메일을 보낼 수 없습니다.', 503);
    }
    let res;
    try {
      res = await fetchImpl(BREVO_URL, {
        method: 'POST',
        headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { email: cfg.fromEmail, name: cfg.fromName || 'PlayPick' }, to: [{ email: to }], subject, htmlContent: html }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DataSourceError('MAIL_NETWORK', '메일 서버에 연결할 수 없습니다.');
    }
    if (res.status !== 201 && !res.ok) throw new DataSourceError('MAIL_HTTP', `메일 발송에 실패했습니다 (HTTP ${res.status}).`);
    return { sent: true };
  }
  return { configured, devLog: Boolean(cfg.devLog), send };
}
