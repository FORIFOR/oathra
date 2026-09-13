import { build } from 'esbuild';
const result = await build({
  entryPoints: ['site/src/playground.ts', 'site/src/check.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  // Workspace packages normally export dist/. Pages must build from a fresh checkout.
  alias: { '@oathra/contract': './packages/contract/src/index.ts', '@oathra/evidence': './packages/evidence/src/index.ts' },
  metafile: true,
  outdir: 'site',
});
if (Object.keys(result.metafile.inputs).some(path => /(?:packages|providers)\/[^/]+\/dist\//.test(path))) {
  throw new Error('Website bundle must not depend on precompiled workspace packages.');
}
console.log('Built website playground directly from production sources.');
