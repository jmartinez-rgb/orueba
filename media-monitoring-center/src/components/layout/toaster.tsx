"use client";
import { Toaster } from "sileo";
import { useTheme } from "next-themes";

/** Notificaciones tipo toast (Sileo) que siguen el tema claro/oscuro de la app. */
export function AppToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster position="bottom-right" theme={resolvedTheme === "light" ? "light" : "dark"} offset={{ bottom: 16, right: 16 }} />;
}
