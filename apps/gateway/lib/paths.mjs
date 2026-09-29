import { pathToFileURL } from 'node:url';

// Files the gateway reads at runtime, named by their place in the repository. The npm package runs a bundled gateway
// and sets OATHRA_GATEWAY_ROOT to a copy of the same layout (scripts/bundle-cli.mjs); in the repository it is the checkout.
const REPO = new URL('../../../', import.meta.url);
export function repoUrl(rel) {
  const root = process.env.OATHRA_GATEWAY_ROOT;
  return new URL(rel, root ? pathToFileURL(root.replace(/\/?$/, '/')) : REPO);
}
