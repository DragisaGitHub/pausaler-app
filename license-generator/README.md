# license-generator (vendor tool)

This is a **vendor-side** CLI that generates offline licenses for the app.

- The app ships **only** the Ed25519 **public** key (in `src-tauri/assets/public_key.pem`).
- This tool uses the matching **private** key to sign a license payload.

## Usage

From repo root:

```bash
cargo run --manifest-path license-generator/Cargo.toml -- --help
```

Generate a `LIFETIME` license:

```bash
cargo run --manifest-path license-generator/Cargo.toml -- \
  generate \
  --activation-code "<paste activation code from app>" \
  --type lifetime
```

Generate a `YEARLY` license:

```bash
cargo run --manifest-path license-generator/Cargo.toml -- \
  generate \
  --activation-code "<paste activation code from app>" \
  --type yearly
```

The output is a single license string you paste into the app’s License page.

## Key management

This repo currently includes a **development** private key seed inside the tool for local testing.

For production:
- Replace the seed with your real vendor private key (do not commit it).
- Update the app’s bundled public key to the matching public key.
