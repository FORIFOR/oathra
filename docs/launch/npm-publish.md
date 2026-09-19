# npm publishing path

The public v0.1.18 package is currently distributed from the GitHub Release because the local npm session is not authenticated. The repository includes a manual GitHub Actions path so a maintainer only needs to configure the credential once and select the tag to publish.

## One-time setup

Either of these works; the workflow uses the token when the secret exists and falls back to OIDC otherwise.

**A. Trusted publisher (no token).** On npmjs.com open the `oathra` package → Settings → Trusted Publisher → GitHub Actions, and enter organization `FORIFOR`, repository `oathra`, workflow filename `npm-publish.yml` (no environment). Nothing is stored in GitHub.

**B. Automation token.**

1. Create an npm automation token with permission to publish `oathra`.
2. Add it to the repository as the Actions secret `NPM_TOKEN`.
3. Open **Actions → Publish npm package → Run workflow** and enter the exact Git tag, such as `v0.1.18`.

The workflow checks out that tag, builds the bundled CLI and SDK, confirms that the tag version equals `packages/cli/package.json`, and publishes with npm provenance. It fails before publishing when the secret is missing or the versions differ.

After a successful run, verify the public package before changing the README command:

```bash
npm view oathra version dist-tags --json
npx --yes oathra@<version> --help
```

Do not put an npm token in `.env`, a commit, an issue, or a release asset.
