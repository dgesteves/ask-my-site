# Changesets

Every pull request that changes the published package adds a changeset:

```sh
pnpm changeset
```

On `main`, the release workflow opens a "Version Packages" pull request that bumps the version and
updates `CHANGELOG.md`. Merging it publishes to npm with provenance.
