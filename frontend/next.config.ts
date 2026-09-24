import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Without this, a local build walks up to the monorepo root (it finds
  // /opt/odoo/v16/package-lock.json) and traces the standalone output from
  // there, so the layout stops matching what the Dockerfile copies.
  outputFileTracingRoot: import.meta.dirname,
  // The Content-Security-Policy is set per request in src/proxy.ts
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Ignored over plain HTTP, as in local development
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
