"use client";

import { useState } from "react";
import { isThemePreference, themeCookie, type ThemePreference } from "@/lib/theme";

export function ThemeControl({ initialTheme }: { initialTheme: ThemePreference }) {
  const [theme, setTheme] = useState(initialTheme);

  return (
    <label className="theme-control">
      <span>Theme</span>
      <select
        aria-label="Theme"
        value={theme}
        onChange={(event) => {
          const preference = event.target.value;
          if (!isThemePreference(preference)) return;
          document.documentElement.dataset.theme = preference;
          document.cookie = `${themeCookie}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
          setTheme(preference);
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
