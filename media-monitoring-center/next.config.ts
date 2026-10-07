import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El SDK de BigQuery solo corre en el servidor y no debe empaquetarse.
  // pg (PostgreSQL en Replit) también corre solo en el servidor y carga módulos opcionales en tiempo de ejecución.
  serverExternalPackages: ["@google-cloud/bigquery", "google-auth-library", "pg"],
  // El mapeo de BigQuery (no secreto) se lee de config/*.json en tiempo de ejecución.
  outputFileTracingIncludes: { "/**": ["./config/**/*.json"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
