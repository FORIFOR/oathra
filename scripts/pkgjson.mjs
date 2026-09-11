// usage: node scripts/pkgjson.mjs <dir> <name> <description> <depsJSON>
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const [dir, name, description, depsJson = "{}"] = process.argv.slice(2);
const deps = JSON.parse(depsJson);
mkdirSync(join(dir, "src"), { recursive: true });
const pkg = {
  name, version: "0.1.0", description, license: "Apache-2.0", type: "module",
  main: "./dist/index.js", types: "./dist/index.d.ts",
  exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js", default: "./dist/index.js" } },
  files: ["dist"], scripts: { build: "tsc -b" }, dependencies: deps,
};
writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
const refs = Object.keys(deps).filter(d => d.startsWith("@oathra/")).map(d => {
  const s = d.replace("@oathra/", "");
  for (const root of ["packages", "providers", "apps"]) if (existsSync(join(root, s))) return { path: `../../${root}/${s}` };
  throw new Error("unknown workspace dep " + d);
});
const ts = {
  extends: "../../tsconfig.base.json",
  compilerOptions: { rootDir: "src", outDir: "dist", tsBuildInfoFile: "dist/.tsbuildinfo" },
  include: ["src/**/*.ts"], exclude: ["src/**/*.test.ts"], references: refs,
};
writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(ts, null, 2) + "\n");
console.log("ok", name);
