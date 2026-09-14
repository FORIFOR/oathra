# npm publishing path

The public v0.1.5 package is currently distributed from the GitHub Release because the local npm session is not authenticated. The repository now includes a manual GitHub Actions path so a maintainer only needs to configure the credential once and select the tag to publish.

## One-time setup

1. Create an npm automation token with permission to publish `oathra`.
2. Add it to the repository as the Actions secret `NPM_TOKEN`.
3. Open **Actions → Publish npm package → Run workflow** and enter the exact Git tag, such as `v0.1.5`.

The workflow checks out that tag, builds the bundled CLI and SDK, confirms that the tag version equals `packages/cli/package.json`, and publishes with npm provenance. It fails before publishing when the secret is missing or the versions differ.

After a successful run, verify the public package before changing the README command:

```bash
npm view oathra version dist-tags --json
npx --yes oathra@<version> --help
```

Do not put an npm token in `.env`, a commit, an issue, or a release asset.
