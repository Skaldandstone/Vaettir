"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "vaettir-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const preferred = stored === "dark" ? "dark" : "light";
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
    <button
      className="theme-toggle"
      onClick={toggle}
      type="button"
      aria-label="Switch theme"
    >
      <span className="theme-dot" style={{ background: "var(--frost)" }} />
      <span>{theme}</span>
    </button>
  );
}
