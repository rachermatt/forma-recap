import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp, loadConfig } from '../server/index.ts';
import { demoDirectory, loadDemoSeed } from './demo-setup.ts';

// This entry point deliberately does not load .env or inherit APS credentials.
try {
  const dataDir = demoDirectory(process.argv.slice(2));
  const bundle = loadDemoSeed();
  const markerPath = resolve(dataDir,'demo-environment.json');
  if (!existsSync(markerPath)) throw new Error('Run npm run demo:setup first. The demo will not create or replace existing review data automatically.');
  const marker = JSON.parse(readFileSync(markerPath,'utf8'));
  if (marker.data_mode !== 'fixture' || marker.bundle_sha256 !== bundle.bundle_sha256 || !existsSync(resolve(dataDir,'fixture.sqlite')) || !existsSync(resolve(dataDir,'fixture-review.sqlite'))) throw new Error('This directory is not the expected isolated synthetic demo. Choose a new directory and run demo:setup.');
  const config = loadConfig({APP_MODE:'fixture',DATA_DIR:dataDir,PORT:process.env.PORT || '8080',APS_CLIENT_ID:'',APS_CLIENT_SECRET:'',APS_HUB_ID:''});
  const app = createApp(config);
  app.server.once('error',error=>{console.error(`Demo could not start: ${error.message}. Use PORT=8081 npm run demo if 8080 is already occupied.`);app.close();process.exitCode=1;});
  app.server.listen(config.port,'127.0.0.1',()=>console.log(`Forma ReCap · isolated synthetic demo · http://localhost:${config.port} · APS credentials disabled`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{app.close();process.exit(0);});
} catch (error) { console.error((error as Error).message);process.exitCode=1; }
