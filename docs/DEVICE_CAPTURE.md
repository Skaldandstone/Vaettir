# Mobile app capture for grounded test generation

Vaettir's experimental **Live App Generation** workflow can draft test cases from a bounded semantic capture
of an authorized Android or iOS screen. The hosted API does not reach into a developer laptop or device.
A local connector is required for device capture. A repository checkout is not required for the page's
downloaded-connector path; importing an existing capture manifest is also available.

The manifest intentionally excludes screenshots, raw hierarchy XML, Appium endpoints, usernames, access keys,
and session IDs. Vaettir accepts at most 25 screens and 150 named elements per screen. Generated drafts are
not saved automatically. Saving a draft creates or updates a case for review, not an approved execution result.

Current source limitation: the hosted page refuses capture before helper HTTP dispatch when independently
bound target and processing consent are unavailable. Pairing does not fill that gap. The Android collector
requires an explicit device serial and expected package; its before/after foreground and hierarchy-package
observations are bounded window evidence, not atomic app-exclusive collection. iOS target validation,
signed Windows delivery and actual device acceptance remain unverified. The workflow below describes
separate actions to review, not proof that the current release supports an accepted end-to-end capture.

## Pair the browser

1. Open **Live App Generation** and choose **Android / ADB**, **Connected iOS**, or **Remote iOS**. Review the
   app, device/session and source scope you are authorized to access. Pairing does not approve capture,
   upload, AI processing, provider charges or access to another app/source.
2. Current original-account/organization access and a full editor seat are required for setup. Select
   **Download Windows unsigned launcher** (or the detected macOS/Linux equivalent) only if device and
   organization policy permits unsigned scripts. The current filenames are `Start Vaettir Device Capture.cmd`,
   `Start Vaettir Device Capture.command` and `Start Vaettir Device Capture.sh`. Node.js 22 or newer must already
   be available; the launcher does not install it or the device dependencies.
3. Review the downloaded script. If policy permits it to run, open it and keep its terminal window open.
   The pairing code is embedded. The page waits for a paired helper response; a successful download or a
   launched terminal does not prove connection, device access or capture. Use **I opened it - connect** or
   **Reconnect** for an explicit connection attempt. A timeout does not identify a Windows policy cause.
4. Only after separately approving the selected app/device/source, choose the device or active Appium session,
   put the app on the intended screen, name it and select **Capture current screen**. Inspect captured screen
   labels and content before separately choosing **Generate from device capture**. Repeat captures only within
   the approved scope. Review each generated draft before saving it for review.

The connector binds only to `127.0.0.1`, accepts only the production Vaettir origin and supported local
development origins, and requires the pairing code on every request. Close its terminal window when finished.
The private pairing code is embedded in the prepared launcher. Do not share the launcher, code or screenshots
that reveal it. Local paired health is not proof of current server authorization or physical-device acceptance.

## If Windows refuses to open the launcher

Select **Windows blocked this helper** on the page. This records your report, stops waiting and cancels the
page's health/discovery requests. Already-started local discovery may finish; late results are ignored. The
private pairing draft is retained and manual setup is hidden until explicitly requested. Reporting the block
does not start software, change policy or capture a device.

The cause is unverified. An Internet download marker, permissive file ACL or installed security product does
not establish which policy enforced the refusal. Ask the device's security administrator to review the exact
downloaded filename, error and time in its protection/policy history. Do not disable protection, unblock files,
remove Mark of the Web, add exclusions, change ExecutionPolicy or Smart App Control, or run as administrator.
A PowerShell `.ps1` workaround is not provided.

The current launcher bootstrap requests the first-party connector without following redirects, with a
30-second download timeout and a 2 MiB body ceiling. It requires a successful supported response before
writing an exclusive file in a unique temporary directory, then uses the same Node runtime without a child
shell. It cleans only its own temporary file/directory. These source safeguards are not a digital signature,
immutable version pin, Windows-policy clearance or device test. Earlier downloaded launchers can contain the
old curl/shared-temp implementation; their filenames or bytes are not proof of the current source or runtime.
Preserve a blocked original for administrator review. A fresh download is not a permission grant or proof
that the blocked-launch problem is fixed.

## Manual setup, only when policy permits

If the administrator confirms that this path is permitted, explicitly choose **Show manual instructions only
if policy permits** after a reported block, then **Manual setup and troubleshooting** and **Download raw
connector**. The delivered file is `vaettir-device-connector.mjs`; it is not a signed installer. Review it first.

On Windows, open PowerShell in the downloaded file's actual folder. With an already-approved Node.js 22 or
newer installation, run the page's command, replacing the placeholder with its private pairing code:

```powershell
node "vaettir-device-connector.mjs" --pairing-code YOUR_PAIRING_CODE
```

Adjust only the filename/path if the browser renamed or saved the download elsewhere. Do not run this command
to circumvent a blocked executable or security policy. Keep the terminal open and choose **I opened it -
connect** or **Reconnect** on the page. Manual setup does not approve any device/session connection, capture,
source processing or paid provider use. Stop if policy also refuses the raw connector.

The browser currently delivers the launcher and raw connector, not a signed standalone Windows installer.
An internal standalone build recipe exists, but its unsigned development artifacts are not trusted public
distribution or proof of physical-device capture. Signing, approved distribution and actual Windows/device
acceptance remain separate requirements.

## Android over ADB

An approved ADB installation and authorized device are prerequisites. Obtain separate permission before
enabling USB debugging or authorizing the workstation. After a paired helper response, the page can request
attached-device discovery. Choose only the approved device/app; an unauthorized device is not capture-ready.
Any USB debugging prompt requires the device owner's approval.

For an existing repository setup, this command is a separate, explicitly authorized capture operation, not
a Windows launch-policy workaround:

```powershell
pnpm capture:device -- --source adb --serial DEVICE_ID --expected-package com.example.app --output vaettir-sign-in.json --label "Sign in"
```

Replace both target placeholders with the independently approved device serial and actual Android package.
They are required even when one device is connected; device display names and `--app-name` are not identity.
The collector checks native foreground before and after the hierarchy read and refuses unexpected packages.
For another separately authorized state, choose a fresh output file:

```powershell
pnpm capture:device -- --source adb --serial DEVICE_ID --expected-package com.example.app --output vaettir-home.json --label "Home"
```

Existing files are never overwritten. Persisted version-1 manifests do not contain trusted original target
bindings, so name-only `--append` cannot authorize aggregation and is refused before collection when the
output exists. The internal collector can append only its exact, unchanged in-memory captures of the same
observed serial/package. Complete over-limit or unsupported values refuse rather than truncate: at most
150 named elements per screen, 200 UTF-16 units per retained label/name/ID and 25 whole screens. Duplicate
named controls and raw whitespace remain distinct. These source checks are not consent or native acceptance.

## Connected iPhone or iPad

Apple device automation requires macOS, Xcode, WebDriverAgent and a local Appium server. An existing approved
device/session and any required signing are external prerequisites. With permission, pair the connector and
enter the local Appium URL and active session ID. Capture is a separate page action, not a result of pairing.

The repository command remains available as a troubleshooting fallback:

```bash
pnpm capture:device -- \
  --source ios-connected \
  --appium-url http://127.0.0.1:4723 \
  --session-id <session-id> \
  --output vaettir-device.json \
  --label "Sign in"
```

Only if separately authorized to create a session, pass `--capabilities ./ios-capabilities.json`; the repository
command creates and closes a session around the capture. Keep signing credentials and provider secrets outside
that file. This is not an automatic step of the downloaded launcher.

## Remote iOS device

Use an approved Appium-compatible real-device provider and an existing authorized session. Start the connector with credentials in
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
