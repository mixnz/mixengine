# Cutting a release

```bash
node scripts/set-version.mjs 0.0.1
git commit -am "chore(release): v0.0.1"
bash scripts/gate.sh
git push origin master
git tag v0.0.1
git push origin v0.0.1
```

**Run the gate after the bump, before the tag.** It takes about two minutes and answers what the
bump itself can break: `set-version.mjs` moves the helper's baseline in `helper.lock`, and
`helper-lock.sh --check` then compares a fingerprint for the first time since the last release.
v0.0.8's first tag failed `lint` on exactly that. The tag's own run is the only full CI a release
needs.

**A tag whose run went red** is taken back before anything is fixed:

```bash
gh run cancel <run-id>
git push origin :refs/tags/v0.0.1
git tag -d v0.0.1
```

and, if `release` got as far as a draft, `gh release delete v0.0.1`. Fix on `master`, ask CI again,
and tag the new commit. Nobody has downloaded a draft, so the version number is reused.

`set-version.mjs` writes the version in one place, regenerates `cli.md`, records the privileged
helper this release ships as the baseline in `crates/mixengine-elevate/helper.lock`, and rewrites the release
the handbook names in prose — which is why `git add` takes the whole of `docs/guide`. It refuses the
bump outright if `packaging/` or `.github/` types a version out instead of deriving it from
`mix_version()`.

CI builds every artifact, signs them, and leaves a **draft** — nothing is public until you publish
it by hand. Full checklist: [build-and-release.md](build-and-release.md)

**The first time you publish a non-pre-release version**, delete the "no stable release exists yet"
paragraph near the top of `docs/guide/en/install.md` and `docs/guide/vi/install.md` — the download
links right below it start working the moment that release is public, since each is
`.../releases/latest/download/<unversioned name>`, which GitHub always resolves to the newest
release that is not a draft or a pre-release. Nothing else on the page needs to change, ever again,
for this reason.
