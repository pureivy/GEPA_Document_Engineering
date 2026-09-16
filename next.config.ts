import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@rhwp/core", "better-sqlite3", "@resvg/resvg-js"],
  // the e2e suite runs a second dev server next to the developer's one (own lock/cache dir)
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
