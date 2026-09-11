import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = () => dirname(fileURLToPath(import.meta.url));

/**
 * Locate the bundled scenarios directory. Works from a repo checkout
 * (dist/ or src/), from the published package (assets/scenarios next to the
 * bundle) and from a project that keeps its own ./scenarios.
 */
export function scenariosDir(): string {
  const h = here();
  const candidates = [
    resolve(process.cwd(), "scenarios"),
    resolve(h, "../assets/scenarios"), // published: dist/bundle/bin.js -> assets/
    resolve(h, "../../assets/scenarios"),
    resolve(h, "../../../scenarios"), // repo: packages/cli/dist -> scenarios/
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("scenarios directory not found; run from the Oathra repo or pass a path");
}

/** Locate the Arena static files (index.html, app.js, style.css). */
export function arenaPublicDir(): string {
  const h = here();
  const candidates = [
    resolve(h, "../assets/arena"),
    resolve(h, "../../assets/arena"),
    resolve(h, "../../../apps/arena/public"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("arena assets not found");
}
