"use client";

import { useEffect, useState } from "react";
import { IconButton } from "./ui/IconButton";

type Theme = "light" | "dark";
const STORAGE_KEY = "vaettir-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const preferred = stored === "light" || stored === "warm" ? "light" : "dark";
      // Reconcile browser-only preference after the matching server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTheme(preferred);
      document.documentElement.setAttribute("data-theme", preferred);
    } catch {
      /* Storage is optional. The default remains usable. */
    }
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Theme still works for this session. */
    }
  }

  return (
    <IconButton icon={theme === "dark" ? "sun" : "moon"}
      label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={toggle} />
  );
}
