# CI/CD (GitHub Actions)

This repo ships a Windows-first Tauri v2 desktop app.

## CI builds (push/PR to `main`)

Workflow: `.github/workflows/ci-build.yml`

- Triggered on pushes to `main` and PRs targeting `main`.
- Builds the frontend (`yarn build`) and then bundles the desktop app (`yarn tauri build`).
- Uploads build artifacts to the workflow run (Actions UI):
  - `src-tauri/target/release/bundle/nsis/*.exe` (NSIS installer)
  - `src-tauri/target/release/bundle/msi/*.msi` (MSI installer)
  - `src-tauri/target/release/pausaler-app.exe` (raw exe, optional)

Artifact name format:
- `paushaler-windows-<commit-sha>`

To download:
- GitHub → **Actions** → pick the run → **Artifacts**.

## Releases (tag push `vX.Y.Z`)

Workflow: `.github/workflows/release.yml`

- Triggered by pushing a tag like `v1.2.3`.
- Builds Windows bundles and creates a GitHub Release named after the tag.
- Attaches the installer outputs as Release assets:
  - NSIS `.exe`
  - MSI `.msi`

### Version guard

Releases enforce that the tag version matches the Tauri config version:
- Tag: `vX.Y.Z` → version `X.Y.Z`
- Config: `src-tauri/tauri.conf.json` → `.version`

If they don’t match, the release workflow fails with a clear error.

### How to release

1. Bump `version` in `src-tauri/tauri.conf.json` (e.g. `1.2.3`).
2. Commit and push to `main`.
3. Tag and push the tag:

```bash
git tag v1.2.3
git push origin v1.2.3
```

4. Download the installers from GitHub → **Releases**.
