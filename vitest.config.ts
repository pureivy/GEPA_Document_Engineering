import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // 테스트는 진짜 한글을 띄우지 않는다 — 시간 초과로 끊긴 한글이 꼬여 사용자 PC의 한글 문서가 열리지 않았다(2026-10-22).
    // 한글 배치까지 시험하려면 GEPA_TEST_HANGUL=1 로 돌린다
    env: { GEPA_NO_HANGUL: process.env.GEPA_TEST_HANGUL === "1" ? "" : "1" },
  },
});
