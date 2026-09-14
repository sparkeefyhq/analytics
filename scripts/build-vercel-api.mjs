import { build } from 'esbuild';
await build({entryPoints:['server/vercel-handler.ts'],outfile:'api/native.js',bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',alias:{'@':'./'},sourcemap:false});
