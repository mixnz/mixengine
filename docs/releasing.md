# Cutting a release

```bash
node scripts/set-version.mjs 0.0.1-beta.1
git add Cargo.toml Cargo.lock
git commit -m "chore(release): v0.0.1-beta.1"
git push origin master
git tag v0.0.1-beta.1
git push origin v0.0.1-beta.1
```

CI builds every artifact, signs them, and leaves a **draft** — nothing is public until you publish
it by hand. Full checklist: [build-and-release.md](../.claude/operations/build-and-release.md)
