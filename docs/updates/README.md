# Updates manifest

This folder is served via GitHub Pages from `/docs` (custom domain: https://pausaler.rs).

## File

- `latest.json` is the stable update manifest consumed by the desktop app.

## Releasing a new version

1) Build and publish the Windows installer assets to GitHub Releases:
   - `Paushaler-setup.exe` (required)
   - `Paushaler.msi` (optional)

2) Bump the app version in `src-tauri/tauri.conf.json`.

3) Update `docs/updates/latest.json`:
   - Set `version` to the new semver (`x.y.z`).
   - Set `releasedAt` to an ISO-8601 UTC timestamp (example: `2026-01-06T12:34:56Z`).
   - Update `notes` (array of short bullet lines).

4) Merge to `main` so GitHub Pages redeploys.

After deploy, verify:
- https://pausaler.rs/updates/latest.json
