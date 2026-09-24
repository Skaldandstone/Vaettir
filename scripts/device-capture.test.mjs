import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCapture,
  buildCaptureManifest,
  extractElementsFromHierarchy,
} from "./device-capture-lib.mjs";

test("extracts named Android controls without retaining hierarchy XML", () => {
  const elements = extractElementsFromHierarchy(`
    <hierarchy>
      <node class="android.widget.Button" text="Continue" clickable="true" />
      <node class="android.widget.EditText" content-desc="Email address" />
      <node class="android.widget.Button" text="Continue" clickable="true" />
    </hierarchy>`);
  assert.deepEqual(elements, [
    { role: "button", name: "Continue", event: "click" },
    { role: "textbox", name: "Email address", event: "fill" },
  ]);
});

test("extracts Appium iOS accessibility elements", () => {
  const elements = extractElementsFromHierarchy(`
    <XCUIElementTypeApplication>
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="Sign in" visible="true" />
      <XCUIElementTypeTextField type="XCUIElementTypeTextField" label="Email" visible="true" />
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="Hidden" visible="false" />
    </XCUIElementTypeApplication>`);
  assert.deepEqual(elements, [
    {
      role: "button",
      name: "Sign in",
      stableId: "Sign in",
      selector: "accessibility-id=Sign in",
      event: "click",
    },
    { role: "textbox", name: "Email", event: "fill" },
  ]);
});

test("retains Android object ids and selectors for executable steps", () => {
  const elements = extractElementsFromHierarchy(
    '<node class="android.widget.Button" text="Checkout" resource-id="com.example:id/checkout" clickable="true" />',
  );
  assert.deepEqual(elements, [
    {
      role: "button",
      name: "Checkout",
      stableId: "com.example:id/checkout",
      selector: "resource-id=com.example:id/checkout",
      event: "click",
    },
  ]);
});

test("appends screens only for the same device and source", () => {
  const first = buildCaptureManifest({
    source: "ANDROID_ADB",
    deviceName: "Pixel",
    label: "Login",
    hierarchy: '<node class="android.widget.Button" text="Continue" />',
  });
  const second = buildCaptureManifest({
    source: "ANDROID_ADB",
    deviceName: "Pixel",
    label: "Home",
    hierarchy: '<node class="android.widget.Button" text="Settings" />',
  });
  assert.equal(appendCapture(first, second).screens.length, 2);
  assert.throws(
    () => appendCapture(first, { ...second, deviceName: "Other" }),
    /same source and device/,
  );
});
