"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    return (
        <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="rounded-lg p-2 hover:bg-message-user/80 transition-colors"
            aria-label="Toggle theme"
        >
            {isDark ? (
                <Sun className="w-5 h-5 stroke-1" />
            ) : (
                <Moon className="w-5 h-5 stroke-1" />
            )}
        </button>
    );
}
