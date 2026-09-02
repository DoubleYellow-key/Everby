# Releasing Everby

This document is for project maintainers. User downloads are listed at the top of the main README.

## Local packaging

Install the build dependencies before creating a package:

```bash
python -m pip install -r agent/requirements-build.txt
pnpm dist:mac:arm64
pnpm dist:mac:x64
pnpm dist:win
```

PyInstaller does not cross-compile across operating systems or architectures. Build each package on its matching platform. Every push to `main` runs `.github/workflows/build.yml`, which verifies macOS arm64, macOS x64, and Windows x64 with Python tests, type checking, Vitest, and packaging.

## GitHub Release

Set the version in `package.json`, commit it, then create a matching `v*.*.*` tag:

```bash
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

`.github/workflows/release.yml` creates a GitHub Release containing:

- Windows x64 NSIS installer and portable `.exe`
- macOS Apple Silicon `.dmg` and `.zip`
- macOS Intel `.dmg` and `.zip`
- `SHA256SUMS.txt` for all release assets

To rebuild an existing tag, run **Actions -> Publish desktop release -> Run workflow** and enter that tag.
