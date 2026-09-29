"use client";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const subscribe = () => () => {};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // El tema real solo se conoce en el navegador: hasta hidratar se usa el del servidor (oscuro) para no desalinear el HTML.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const dark = !mounted || resolvedTheme !== "light";
  return (
    <Button variant="ghost" size="icon-sm" className="rounded-full" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"} title={dark ? "Modo claro" : "Modo oscuro"}>
      <Sun className="hidden dark:block" />
      <Moon className="block dark:hidden" />
    </Button>
  );
}
