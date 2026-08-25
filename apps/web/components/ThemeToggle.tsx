"use client";

import { useEffect, useState } from "react";

type Theme = "warm" | "dark";
const STORAGE_KEY = "vaettir-theme";

export function ThemeToggle() {
  // "warm" is the default theme per STYLE_GUIDE.md #2 -- it should load
  // first on every page unless the user has an explicit stored preference.
  const [theme, setTheme] = useState<Theme>("warm");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === "warm" || stored === "dark") {
      setTheme(stored);
      document.documentElement.setAttribute("data-theme", stored);
    }
  }, []);

  function toggle() {
    const next: Theme = theme === "warm" ? "dark" : "warm";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <button className="theme-toggle" onClick={toggle} type="button" aria-label="Switch theme">
      {/* The dot intentionally shows the accent color of the theme you'd
          switch AWAY from, not the active one -- a deliberate piece of
          misdirection from STYLE_GUIDE.md #5, not a bug. */}
      <span className="theme-dot" style={{ background: theme === "warm" ? "var(--ember)" : "var(--frost)" }} />
      <span>{theme}</span>
    </button>
  );
}
