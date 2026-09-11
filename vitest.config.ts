import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/** Resolve @oathra/* to source so tests never depend on stale dist output. */
function oathraAlias() {
  return {
    find: /^@oathra\/([a-z-]+)$/,
    replacement: "$1",
    customResolver(id: string) {
      for (const root of ["packages", "providers", "apps"]) {
        const p = resolve(import.meta.dirname, root, id, "src/index.ts");
        if (existsSync(p)) return p;
      }
      return null;
    },
  };
}

export default defineConfig({
  resolve: { alias: [oathraAlias()] },
  test: {
    include: ["packages/**/*.test.ts", "providers/**/*.test.ts", "apps/**/*.test.ts"],
    passWithNoTests: false,
    testTimeout: 20000,
  },
});
