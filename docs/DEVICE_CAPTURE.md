# Mobile app capture for grounded test generation

Vaettir can generate reviewed test-case drafts from a bounded semantic capture of a real Android or iOS screen.
The hosted API does not reach into a developer laptop or device. A local capture command reads the accessibility
hierarchy, reduces it to named controls, and writes a JSON manifest for upload on the project's **Live app** page.

The manifest intentionally excludes screenshots, raw hierarchy XML, Appium endpoints, usernames, access keys,
and session IDs. Vaettir accepts at most 25 screens and 150 named elements per screen. AI output remains pending
review until a user explicitly saves a draft.

## Android over ADB

Enable USB debugging, authorize the workstation, and verify the device appears in `adb devices`. Put the app on
the screen you want to capture, then run:

```powershell
pnpm capture:device -- --source adb --output vaettir-device.json --label "Sign in"
```

If more than one device is connected, add `--serial <device-id>`. Navigate to another app state and append it:

```powershell
pnpm capture:device -- --source adb --output vaettir-device.json --label "Home" --append
```

## Connected iPhone or iPad

Apple device automation requires macOS, Xcode, WebDriverAgent, and a local Appium server. Start or select an
Appium session for the connected device, then capture its current screen:

```bash
pnpm capture:device -- \
  --source ios-connected \
  --appium-url http://127.0.0.1:4723 \
  --session-id <session-id> \
  --output vaettir-device.json \
  --label "Sign in"
```

Instead of an existing session, pass `--capabilities ./ios-capabilities.json`; the command creates and closes a
session around the capture. Keep signing credentials and provider secrets outside that file.

## Remote iOS device

Use an Appium-compatible real-device provider and an existing session or capabilities file. Put credentials in
`APPIUM_USERNAME` and `APPIUM_ACCESS_KEY`, not in the manifest or command history:

```bash
APPIUM_USERNAME=<user> APPIUM_ACCESS_KEY=<key> pnpm capture:device -- \
  --source ios-remote \
  --appium-url https://provider.example/wd/hub \
  --session-id <session-id> \
  --output vaettir-device.json
```

Provider availability, device minutes, signing, and device-farm charges are external prerequisites. A successful
manifest capture proves only the accessibility snapshot, not installation, interaction correctness, or device
acceptance.
