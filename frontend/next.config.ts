import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Without this, a local build walks up to the monorepo root (it finds
  // /opt/odoo/v16/package-lock.json) and traces the standalone output from
  // there, so the layout stops matching what the Dockerfile copies.
  outputFileTracingRoot: import.meta.dirname,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
