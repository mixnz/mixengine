# Cutting a release

```bash
node scripts/set-version.mjs 0.0.1
git add Cargo.toml Cargo.lock docs/guide/en/cli.md
git commit -m "chore(release): v0.0.1"
git push origin master
git tag v0.0.1
git push origin v0.0.1
```

CI builds every artifact, signs them, and leaves a **draft** — nothing is public until you publish
it by hand. Full checklist: [build-and-release.md](../.claude/operations/build-and-release.md)

**The first time you publish a non-pre-release version**, delete the "no stable release exists yet"
paragraph near the top of `docs/guide/en/install.md` and `docs/guide/vi/install.md` — the download
links right below it start working the moment that release is public, since each is
`.../releases/latest/download/<unversioned name>`, which GitHub always resolves to the newest
release that is not a draft or a pre-release. Nothing else on the page needs to change, ever again,
for this reason.
