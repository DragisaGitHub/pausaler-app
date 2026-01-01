# License Generator (Desktop, dev/testing)

This is a separate Tauri desktop app used to generate a signed license string from an activation code.

## Run (from repo root)

First time only:

- `yarn license-ui:install`

Then:

- `yarn license-ui:dev`

## Use

1. Copy the activation code from the Pausaler app.
2. Paste it into this app.
3. Pick `Yearly` or `Lifetime`.
4. Click **Generate license**.
5. Copy the generated license string and paste it into Pausaler → License page.

## Security note

This app uses the dev signing key embedded in the repo for local testing.
Do not distribute a build that contains a real vendor private key.
