import { createPublicDemoHandler } from '../server/vercel-demo.ts';

// One warm-instance cache of the same immutable synthetic seed; no listener or persistent user storage.
export default createPublicDemoHandler();
