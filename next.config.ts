import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@rhwp/core", "better-sqlite3", "@resvg/resvg-js"],
  // the e2e suite runs a second dev server next to the developer's one (own lock/cache dir)
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // 다른 PC(Tailscale·사내망)에서 dev 서버를 열 때 — 쉼표로 구분한 호스트(예: 100.107.71.5)
  ...(process.env.ALLOWED_DEV_ORIGINS ? { allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS.split(",").map((s) => s.trim()) } : {}),
};

export default nextConfig;
