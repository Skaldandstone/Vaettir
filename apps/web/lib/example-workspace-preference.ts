"use client";

import { useSyncExternalStore } from "react";

const key = "vaettir:hide-example-workspace";
const eventName = "vaettir:example-workspace-visibility";
let visibleInMemory = true;
let storageUnavailable = false;

function readVisible() {
  if (!storageUnavailable) {
    try {
      visibleInMemory = window.localStorage.getItem(key) !== "1";
    } catch {
      storageUnavailable = true;
    }
  }
  return visibleInMemory;
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener(eventName, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setExampleWorkspaceVisible(visible: boolean) {
  visibleInMemory = visible;
  try {
    if (visible) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, "1");
  } catch {
    storageUnavailable = true;
  }
  window.dispatchEvent(new Event(eventName));
}

export function useExampleWorkspaceVisible() {
  return useSyncExternalStore(subscribe, readVisible, () => true);
}
