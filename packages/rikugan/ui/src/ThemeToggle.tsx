import React from "react";

import { ThemeSetting, useTheme } from "./theme";

const options: Array<{ value: ThemeSetting; label: string }> = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];

const ThemeToggle: React.FC = () => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={theme === option.value ? "active" : ""}
          role="radio"
          aria-checked={theme === option.value}
          onClick={() => setTheme(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

export default ThemeToggle;
