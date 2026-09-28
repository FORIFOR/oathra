// Bundle the CLI (and every @oathra/* workspace package) into one file so
// `npx oathra demo` needs a single npm package. Copies Arena assets + scenarios.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

// The Gateway app for `oathra demo` (practice mode). Loaded by bin.js with import(); its runtime files come from
// assets/gateway-root, which keeps the repository layout (apps/gateway/lib/paths.mjs, OATHRA_GATEWAY_ROOT).
await build({
  entryPoints: [resolve(root, "apps/gateway/demo.mjs")],
  outfile: resolve(out, "gateway.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})],
  logLevel: "warning",
});

// Public SDK: one ESM entry without the CLI, carrier or model runtime.
await build({
  entryPoints: [resolve(cli, "src/evidence.ts")],
  outfile: resolve(out, "evidence.js"),
  bundle: true,
  platform: "neutral",
  format: "esm",
  target: "es2022",
  external: ["zod"],
  logLevel: "warning",
});
for (const name of ["contract", "evidence"]) {
  const target = resolve(out, "types", name);
  mkdirSync(target, { recursive: true });
  for (const file of readdirSync(resolve(root, "packages", name, "dist"))) {
    if (!file.endsWith(".d.ts")) continue;
    const declaration = readFileSync(resolve(root, "packages", name, "dist", file), "utf8")
      .replaceAll('"@oathra/contract"', '"../contract/index.js"')
      .replace(/\/\/# sourceMappingURL=.*$/gm, "");
    writeFileSync(resolve(target, file), declaration);
  }
}
for (const file of ["evidence", "transcript"]) {
  const declaration = readFileSync(resolve(cli, "dist", `${file}.d.ts`), "utf8")
    .replaceAll('"@oathra/evidence"', '"./types/evidence/index.js"')
    .replaceAll('"@oathra/contract"', '"./types/contract/index.js"')
    .replace(/\/\/# sourceMappingURL=.*$/gm, "");
  writeFileSync(resolve(out, `${file}.d.ts`), declaration);
}

const assets = resolve(cli, "assets");
rmSync(assets, { recursive: true, force: true });
cpSync(resolve(root, "apps/arena/public"), resolve(assets, "arena"), { recursive: true });
cpSync(resolve(root, "scenarios"), resolve(assets, "scenarios"), { recursive: true });
const gatewayRoot = resolve(assets, "gateway-root");
cpSync(resolve(root, "apps/gateway/public"), resolve(gatewayRoot, "apps/gateway/public"), { recursive: true });
cpSync(resolve(root, "apps/gateway/lib/phone.mjs"), resolve(gatewayRoot, "apps/gateway/lib/phone.mjs")); // plugin identity digest
cpSync(resolve(root, "plugins"), resolve(gatewayRoot, "plugins"), { recursive: true, filter: (f) => !/\.test\.|node_modules/.test(f) });
cpSync(resolve(root, "scenarios"), resolve(gatewayRoot, "scenarios"), { recursive: true });
mkdirSync(resolve(gatewayRoot, "apps/arena/public"), { recursive: true });
for (const f of readdirSync(resolve(root, "apps/arena/public"))) if (f === "index.html" || f.endsWith(".css")) cpSync(resolve(root, "apps/arena/public", f), resolve(gatewayRoot, "apps/arena/public", f));
cpSync(resolve(root, "README.md"), resolve(cli, "README.md"));
cpSync(resolve(root, "LICENSE"), resolve(cli, "LICENSE"));
writeFileSync(resolve(out, ".gitkeep"), "");
console.log(`bundled -> ${out}/bin.js · assets -> ${assets}`);
