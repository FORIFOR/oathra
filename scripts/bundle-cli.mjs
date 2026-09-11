// Bundle the CLI (and every @oathra/* workspace package) into one file so
// `npx oathra demo` needs a single npm package. Copies Arena assets + scenarios.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "packages/cli");
const out = resolve(cli, "dist/bundle");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const pkg = JSON.parse(readFileSync(resolve(cli, "package.json"), "utf8"));
await build({
  entryPoints: [resolve(cli, "src/bin.ts")],
  outfile: resolve(out, "bin.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})],
  define: { "process.env.OATHRA_VERSION": JSON.stringify(pkg.version) },
  logLevel: "warning",
});

const assets = resolve(cli, "assets");
rmSync(assets, { recursive: true, force: true });
cpSync(resolve(root, "apps/arena/public"), resolve(assets, "arena"), { recursive: true });
cpSync(resolve(root, "scenarios"), resolve(assets, "scenarios"), { recursive: true });
cpSync(resolve(root, "README.md"), resolve(cli, "README.md"));
writeFileSync(resolve(out, ".gitkeep"), "");
console.log(`bundled -> ${out}/bin.js · assets -> ${assets}`);
