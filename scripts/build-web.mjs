import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('assets',{recursive:true});
for (const name of ['runtime','capture']) await build({entryPoints:[`src/web/${name}.ts`],outfile:`assets/${name}.webbundle`,bundle:true,format:'iife',splitting:false,platform:'browser',target:'es2020',minify:true,legalComments:'none'});
console.log('Local Web runtime and capture bundle built.');
