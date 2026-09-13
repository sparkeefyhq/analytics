import { build } from 'esbuild';
// Temporary cutover lock: remove only after Phase 0 reconciliation and explicit approval.
if (process.env.VERCEL_ENV === 'production') throw Error('Control v2 is preview-only. Phase 0 production is frozen.');
await build({entryPoints:['server/vercel-handler.ts'],outfile:'api/native.js',bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',alias:{'@':'./'},sourcemap:false});
