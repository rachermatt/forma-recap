import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, loadConfig } from './index.ts';
import { setupDemo } from '../scripts/demo-setup.ts';

const primaryOrigin = 'https://forma-retrace.vercel.app';
const legacyOrigin = 'https://forma-recap.vercel.app';
export function publicDemoOrigins(env: NodeJS.ProcessEnv = process.env) {
  const origins = new Set([primaryOrigin, legacyOrigin]);
  if (env.VERCEL === '1') for (const name of ['VERCEL_URL','VERCEL_PROJECT_PRODUCTION_URL']) {
    const host=env[name];
    if (host && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/i.test(host)) origins.add(`https://${host.toLowerCase()}`);
  }
  return [...origins];
}
function routeRequest(req: IncomingMessage) {
  const original=req.url || '/';
  if (!original.startsWith('/') || original.startsWith('//')) throw Object.assign(new Error('Invalid demo request path.'),{status:400});
  const url=new URL(original,primaryOrigin);
  const markers=url.searchParams.getAll('__forma_route');
  if (markers.length>1) throw Object.assign(new Error('Duplicate internal route markers are not allowed.'),{status:400});
  if (markers.length) {
    const route=markers[0];
    if ((url.pathname!=='/api/index' && url.pathname!==route) || !/^\/(?:api|auth)\/[a-zA-Z0-9_./%~-]+$/.test(route) || route.includes('//') || route.split('/').includes('..') || new URL(route,primaryOrigin).pathname!==route) throw Object.assign(new Error('Invalid internal demo route marker.'),{status:400});
    url.searchParams.delete('__forma_route');
    return `${route}${url.searchParams.size?`?${url.searchParams}`:''}`;
  }
  return `${url.pathname}${url.search}`;
}
type Options = { dataDir?:string; env?:NodeJS.ProcessEnv; allowedOrigins?:string[] };
export function createPublicDemoHandler(options:Options={}) {
  let ready:Promise<ReturnType<typeof createApp>>|undefined;
  let closed=false;
  const initialize=()=>ready??=Promise.resolve().then(()=>{
    if(closed) throw new Error('Public demo handler is closed.');
    const dataDir=options.dataDir ?? mkdtempSync(join(tmpdir(),'forma-recap-public-'));
    setupDemo({targetDir:dataDir});
    const config=loadConfig({APP_MODE:'fixture',DATA_DIR:dataDir,PORT:'0',APS_CLIENT_ID:'',APS_CLIENT_SECRET:'',APS_HUB_ID:''});
    return createApp(config,{deployment:{kind:'public_demo',read_only:true,label:'Public synthetic demo',persistence:'fixed_snapshot',allowedOrigins:options.allowedOrigins ?? publicDemoOrigins(options.env)}});
  });
  const handler=async(req:IncomingMessage,res:ServerResponse)=>{
    try {
      req.url=routeRequest(req);
      const app=await initialize();
      await new Promise<void>((finish)=>{
        res.once('finish',finish);res.once('close',finish);
        app.server.emit('request',req,res);
      });
    } catch(error) {
      const failure=error as Error & {status?:number};
      const status=failure.status ?? 500;
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({error:status<500?failure.message:'Public demo initialization failed. The local application and saved source data remain separate.'}));
      if(status>=500) console.error('Public synthetic demo initialization failed:',failure.name);
    }
  };
  return Object.assign(handler,{close:async()=>{closed=true;if(ready)(await ready).close();}});
}
