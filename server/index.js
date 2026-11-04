import { getConfig } from './config.js';
import { createApp } from './app.js';

const config = getConfig();
const server = createApp(config);
server.catalog?.warmUp?.();
server.listen(config.port, () => {
  console.log(`[playpick] http://localhost:${config.port} (데이터 소스: ${config.dataSource})`);
});
