"use client";
import { useEffect, useState } from "react";

/** No persistence until the actor/project scope is known. Storage is optional. */
export function useLayoutPreference<T>(scope: string | null, name: string, fallback: T, parse: (raw: unknown) => T) {
  const key = scope ? `vaettir:layout:v1:${scope}:${name}` : null;
  const [state, setState] = useState<{ key: string | null; value: T }>({ key: null, value: fallback });
  useEffect(() => {
    let value = fallback;
    if (key) { try { value = parse(JSON.parse(localStorage.getItem(key) ?? "null")); } catch { /* optional storage */ } }
    // Hydration intentionally reads external browser storage after SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ key, value });
    // Callers supply a schema-specific parser; only the scope changes the saved layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (key && state.key === key) { try { localStorage.setItem(key, JSON.stringify(state.value)); } catch { /* session layout still works */ } }
  }, [key, state]);
  const value = state.key === key ? state.value : fallback;
  const update = (next: T | ((previous: T) => T)) => setState(previous => ({ key, value: typeof next === "function" ? (next as (previous: T) => T)(previous.key === key ? previous.value : fallback) : next }));
  return [value, update] as const;
}
