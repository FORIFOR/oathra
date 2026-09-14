import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pages assembles docs/media in its deploy job. Keep the local preview just as
 * useful by copying newly recorded assets into the ignored site/media folder
 * after the bundle is built. This is intentionally a copy, not a symlink, so
 * the preview also works when the repository is opened from another process.
 */
function syncMediaForLocalPreview() {
  const sourceDir = 'docs/media';
  const targetDir = 'site/media';
  if (!existsSync(sourceDir)) return;
  mkdirSync(targetDir, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(sourceDir)) {
    const source = join(sourceDir, name);
    const target = join(targetDir, name);
    const sourceStat = statSync(source);
    if (!sourceStat.isFile()) continue;
    let needsCopy = !existsSync(target);
    if (!needsCopy) {
      const targetStat = statSync(target);
      needsCopy = targetStat.size !== sourceStat.size || targetStat.mtimeMs < sourceStat.mtimeMs;
    }
    if (needsCopy) {
      cpSync(source, target);
      copied++;
    }
  }
  if (copied) console.log(`Synced ${copied} media asset(s) for local preview.`);
}

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
syncMediaForLocalPreview();
console.log('Built website playground directly from production sources.');
