const ROLE_BY_NATIVE_TYPE = [
  [/button|imagebutton/i, "button"],
  [/textfield|edittext|searchfield|securetextfield/i, "textbox"],
  [/switch|toggle/i, "switch"],
  [/checkbox/i, "checkbox"],
  [/radio/i, "radio"],
  [/link/i, "link"],
  [/picker|spinner|combobox/i, "combobox"],
  [/tab/i, "tab"],
  [/cell/i, "cell"],
  [/statictext|textview/i, "text"],
];

function decodeXml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attributesOf(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2]).trim();
  }
  return attributes;
}

function nativeRole(attributes, tag) {
  const type = [attributes.class, attributes.type, tag]
    .filter(Boolean)
    .join(" ");
  return (
    ROLE_BY_NATIVE_TYPE.find(([pattern]) => pattern.test(type))?.[1] ??
    (attributes.clickable === "true" ? "button" : "element")
  );
}

function eventForRole(role) {
  if (role === "textbox") return "fill";
  if (["checkbox", "radio", "switch"].includes(role)) return "check";
  if (role === "combobox") return "select";
  if (role === "link") return "navigate";
  return "click";
}

export function extractElementsFromHierarchy(xml, maximum = 150) {
  const elements = [];
  const seen = new Set();
  const tags = xml.match(/<(?:node|XCUIElementType[\w]+)\b[^>]*>/g) ?? [];
  for (const tag of tags) {
    const attributes = attributesOf(tag);
    if (attributes.visible === "false" || attributes.displayed === "false")
      continue;
    const name = [
      attributes.text,
      attributes["content-desc"],
      attributes.label,
      attributes.name,
      attributes.value,
      attributes["resource-id"],
    ].find((value) => value && value !== "true" && value !== "false");
    if (!name) continue;
    const role = nativeRole(attributes, tag);
    const normalizedName = name.slice(0, 200);
    const androidId = attributes["resource-id"];
    const iosId = tag.startsWith("<XCUIElementType")
      ? attributes.name
      : undefined;
    const stableId = (androidId || iosId || "").slice(0, 200) || undefined;
    const selector = androidId
      ? `resource-id=${androidId}`
      : iosId
        ? `accessibility-id=${iosId}`
        : undefined;
    const key = `${role}\u0000${normalizedName}\u0000${stableId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    elements.push({
      role,
      name: normalizedName,
      ...(stableId ? { stableId } : {}),
      ...(selector ? { selector } : {}),
      event: eventForRole(role),
    });
    if (elements.length >= maximum) break;
  }
  return elements;
}

export function buildCaptureManifest({
  source,
  deviceName,
  appName,
  label,
  hierarchy,
}) {
  if (!["ANDROID_ADB", "IOS_CONNECTED", "IOS_REMOTE"].includes(source)) {
    throw new Error(`Unsupported capture source: ${source}`);
  }
  const elements = extractElementsFromHierarchy(hierarchy);
  if (elements.length === 0) {
    throw new Error(
      "The device hierarchy did not contain any named UI elements.",
    );
  }
  const capturedAt = new Date().toISOString();
  return {
    version: 1,
    source,
    deviceName: String(deviceName || "Unknown device").slice(0, 200),
    ...(appName ? { appName: String(appName).slice(0, 200) } : {}),
    capturedAt,
    screens: [
      {
        id: `screen-${capturedAt.replace(/[^0-9]/g, "")}`,
        label: String(label || "Current screen").slice(0, 200),
        elements,
      },
    ],
  };
}

export function appendCapture(existing, next) {
  if (existing.version !== 1 || !Array.isArray(existing.screens)) {
    throw new Error(
      "The existing output is not a Vaettir device-capture manifest.",
    );
  }
  if (
    existing.source !== next.source ||
    existing.deviceName !== next.deviceName
  ) {
    throw new Error(
      "Appended screens must come from the same source and device.",
    );
  }
  return {
    ...existing,
    capturedAt: next.capturedAt,
    appName: next.appName ?? existing.appName,
    screens: [...existing.screens, ...next.screens].slice(0, 25),
  };
}
