import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { BRAND_COOKIE, parseBrand } from "@/lib/brands";
import "@fontsource-variable/inter";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppToaster } from "@/components/layout/toaster";

export const metadata: Metadata = {
  title: { default: "Media Monitoring Center", template: "%s · Media Monitoring Center" },
  description: "Monitoreo operativo de Paid Media (solo lectura): Google, Meta, TikTok, Microsoft, Spotify y X.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0d" },
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // La marca elegida (izzi / Sky) pinta el acento de toda la app, incluidos menús y diálogos.
  const brand = parseBrand((await cookies()).get(BRAND_COOKIE)?.value);
  return (
    <html lang="es-MX" data-brand={brand} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            {children}
            <AppToaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
