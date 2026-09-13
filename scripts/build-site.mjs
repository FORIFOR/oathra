import { build } from 'esbuild';
await build({ entryPoints: ['site/src/playground.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, outfile: 'site/playground.js' });
console.log('Built website playground from the production evidence engine.');
