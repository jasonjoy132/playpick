// Vercel 서버리스 함수: 모든 API·업로드 사진 요청을 기존 서버(createApp)로 넘김
//  - 화면 파일(client/dist)은 Vercel이 정적 파일로 바로 보냄(vercel.json)
//  - 서버는 인스턴스마다 한 번만 만들어 재사용(설정·데이터 파일 읽기는 콜드 스타트 때 한 번)
import { getConfig } from '../server/config.js';
import { createApp } from '../server/app.js';

let server = null;

export default function handler(req, res) {
  server ??= createApp(getConfig());
  return new Promise((resolve) => {
    res.on('finish', resolve);
    res.on('close', resolve);
    server.emit('request', req, res);
  });
}
