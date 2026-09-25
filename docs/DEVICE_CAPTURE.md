# Mobile app capture for grounded test generation

Vaettir can generate reviewed test-case drafts from a bounded semantic capture of a real Android or iOS screen.
The hosted API does not reach into a developer laptop or device. The project's **Live App Generation** page now
pairs with a small loopback-only connector, captures the current screen, previews the screen list, and sends the
bounded semantic result directly into the draft workflow. A repository checkout and manual JSON upload are not
required.

The manifest intentionally excludes screenshots, raw hierarchy XML, Appium endpoints, usernames, access keys,
and session IDs. Vaettir accepts at most 25 screens and 150 named elements per screen. AI output remains pending
review until a user explicitly saves a draft.

## Pair the browser

1. Open **Live App Generation** and choose Android, Connected iOS, or Remote iOS.
2. Select **Download Windows helper** (or the detected macOS/Linux equivalent) on the computer that can reach
   the device.
3. Open the downloaded launcher and leave its window open. The launcher downloads the current connector, starts
   it with a page-generated pairing code, and the page connects automatically. No code needs to be copied.
4. Put the app on an important screen, name it, and select **Capture current screen**. Repeat for other states,
   then generate drafts.

The connector binds only to `127.0.0.1`, accepts only the production Vaettir origin and supported local
development origins, and requires the pairing code on every request. Close its terminal window when finished.
The raw `.mjs` download and manual pairing code remain under **Manual setup and troubleshooting**.

## Android over ADB

Enable USB debugging and authorize the workstation. After the helper connects, Vaettir discovers attached
devices and shows their model names. Choose the device and capture each foreground app screen from the page. An
unauthorized device remains visible with an instruction to accept its USB debugging prompt.

The repository command remains available as a troubleshooting fallback:

```powershell
pnpm capture:device -- --source adb --output vaettir-device.json --label "Sign in"
```

If more than one device is connected, add `--serial <device-id>`. Navigate to another app state and append it:

```powershell
pnpm capture:device -- --source adb --output vaettir-device.json --label "Home" --append
```

## Connected iPhone or iPad

Apple device automation requires macOS, Xcode, WebDriverAgent, and a local Appium server. Start an Appium session
for the connected device, pair the connector, and enter the local Appium URL and active session ID in Vaettir.
Captures then happen from the browser page.

The repository command remains available as a troubleshooting fallback:

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

Use an Appium-compatible real-device provider and an existing session. Start the connector with credentials in
`APPIUM_USERNAME` and `APPIUM_ACCESS_KEY`, pair it with Vaettir, then enter only the provider endpoint and active
session ID in the page. Provider credentials remain in the connector process and are not sent to Vaettir.

The repository command remains available as a troubleshooting fallback:

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
