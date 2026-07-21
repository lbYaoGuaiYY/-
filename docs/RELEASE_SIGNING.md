# Release signing boundary

The release workflow treats macOS signing as a separately protected operation.
The `validation` matrix (quality, Windows, unsigned macOS, and iOS simulator)
does not reference GitHub Actions secrets. Pull requests and manual runs can
therefore exercise the build without receiving Apple credentials.

## `release-signing` environment

Create a GitHub Environment named `release-signing` and configure its protection
rules before adding credentials. Recommended settings are:

- restrict deployment branches/tags to version tags (`v*`);
- require approval from the release maintainers; and
- keep the environment's deployment history enabled for auditability.

Store the following values as environment secrets, never as values in the
repository or workflow file:

`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_PRIVATE_KEY`, `APPLE_ID`,
`APPLE_PASSWORD`, `APPLE_TEAM_ID`, and `KEYCHAIN_PASSWORD`.

The `macos-signing` job references this environment and is guarded by a push to
`refs/tags/v*`. It checks out `github.sha`, verifies that the tag exactly matches
`config/release-manifest.json`, creates a runner-local keychain and notarization
key file, and preserves the resolved `APPLE_SIGNING_IDENTITY` through
`GITHUB_ENV`. Its build-info metadata is checked before any artifact is uploaded.

Artifacts from validation are deliberately named `*-validation` or `*-unsigned`.
An unsigned or signed-but-not-notarized build is stored under `dist-app/unsigned`
and is never named or uploaded as a release. The aggregate job is likewise named
and uploaded as `qingshe-validation-*`; it is a validation bundle, not a
publishable release.

See GitHub's [deployment environments documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
for configuring required reviewers and deployment tag restrictions.
