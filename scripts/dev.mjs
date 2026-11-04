// 개발 모드: 클라이언트 빌드 감시 + 서버 자동 재시작
import { spawn } from 'node:child_process';
const run = (args) => spawn(process.execPath, args, { stdio: 'inherit' });
const procs = [run(['scripts/build.mjs', '--watch']), run(['--watch', 'server/index.js'])];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
