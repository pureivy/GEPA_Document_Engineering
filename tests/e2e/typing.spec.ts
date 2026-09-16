import { test as base, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * API calls go through their own request context with `Connection: close`: a shared keep-alive
 * socket that Node's dev server closed after 5 idle seconds fails with ECONNRESET, and the
 * header must not leak into the browser's own fetches (Chrome rejects it → HTTP 400).
 */
const test = base.extend<{ api: APIRequestContext }>({
  // Playwright's fixture callback is named `use`; the React hooks lint rule mistakes it for a hook
  api: async ({ playwright, baseURL }, provide) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Connection: "close" } });
    await provide(ctx);
    await ctx.dispose();
  },
});

/**
 * Requirement 4 end to end without an agent: a replayed writer run streams the golden 공고문
 * through SSE → the page-styled editor types it live → the version is saved → HWPX is exported
 * and rendered → the user edits, the edit auto-saves, and the download is a real HWPX.
 */

async function createProject(api: APIRequestContext, title: string): Promise<string> {
  const res = await api.post("/api/projects", {
    data: {
      title,
      topic: "e2e 주제",
      region: "안동시",
      organizer: "안동시",
      contact: { 부서명: "북부지소", 담당자: "e2e", 전화: "054-900-3801", 이메일: "gepa_north@naver.com" },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { project?: { id: string }; id?: string };
  return body.project?.id ?? body.id!;
}

async function replay(api: APIRequestContext, projectId: string, fixture: "notice-golden" | "notice-double", delayMs = 4) {
  const res = await api.post("/api/dev/replay", { data: { projectId, stage: "notice", fixture, delayMs } });
  expect(res.status(), await res.text()).toBe(202);
  return (await res.json()) as { runId: string; lines: number };
}

/** top-level ProseMirror nodes = DocModel blocks (paragraphs carry data-block-id, atoms do not) */
const editorBlocks = (page: Page) => page.locator(".hwp-content > *");

test("live typing from a replayed run, then export, render, edit, save and download", async ({ page, api }) => {
  const projectId = await createProject(api, "e2e 실시간 타이핑");
  // start the replayed run (≈1,000 lines at 12 ms) and open the stage page: it attaches to the
  // active run, catches up on the frames it missed and then types live
  const { runId } = await replay(api, projectId, "notice-golden", 12);
  await page.goto(`/projects/${projectId}/notice`);
  await expect(page.getByText("실행 중").first()).toBeVisible();

  // blocks arrive in order and the caret is visible while typing
  await expect(editorBlocks(page).first()).toBeVisible();
  const early = await editorBlocks(page).count();
  await expect(page.locator(".hwp-caret").first()).toBeVisible();
  await expect.poll(async () => editorBlocks(page).count(), { timeout: 60_000 }).toBeGreaterThan(early);

  // the run finishes → 완료, and the editor holds the whole document
  await expect(page.getByText("완료", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  const run = await (await api.get(`/api/runs/${runId}`)).json();
  expect(run.run.status).toBe("succeeded");
  const doc = (await (await api.get(`/api/projects/${projectId}/stages/notice/doc`)).json()) as { doc: { blocks: unknown[] } };
  await expect.poll(async () => editorBlocks(page).count()).toBe(doc.doc.blocks.length);
  await expect(page.getByText("[별첨1]정량평가 기준").first()).toBeVisible();

  // render pane: validation badge + page 1 SVG, whose text contains the overview section title
  await expect(page.getByText("검증 통과")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("img", { name: "1쪽 렌더" })).toBeVisible();
  const manifest = (await (await api.get(`/api/projects/${projectId}/stages/notice/render/manifest`)).json()) as { pages: number; hash: string };
  expect(manifest.pages).toBe(7);
  const svg = await (await api.get(`/api/projects/${projectId}/stages/notice/render?page=1&h=${manifest.hash}`)).text();
  // rhwp emits one <text> per glyph run; join the characters of the page to check the section title
  const glyphs = Array.from(svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g), (m) => m[1]).join("");
  expect(glyphs).toContain("모집개요");

  // edit → auto-save → the version list grows and the download is a real HWPX
  const target = page.locator(".hwp-content [data-block-id]", { hasText: "수출 기반 보유 중소기업" }).first();
  await target.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (e2e 수정)");
  await expect(page.getByText("저장됨")).toBeVisible({ timeout: 20_000 });
  const versions = (await (await api.get(`/api/projects/${projectId}/stages/notice/history`)).json()) as { versions: { source: string }[] };
  expect(versions.versions.map((v) => v.source)).toContain("user");
  const dsl = await (await api.get(`/api/projects/${projectId}/stages/notice/doc?format=dsl`)).text();
  expect(dsl).toContain("(e2e 수정)");
  const dl = await api.get(`/api/projects/${projectId}/stages/notice/download?format=hwpx`);
  expect(dl.status()).toBe(200);
  expect(dl.headers()["content-type"]).toContain("application/hwp+zip");
  const bytes = await dl.body();
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  expect(bytes.length).toBeGreaterThan(20_000);
});

test("a rewrite in the same run keeps the screen and swaps the new version in at once", async ({ page, api }) => {
  const projectId = await createProject(api, "e2e 다시 쓰기");
  await replay(api, projectId, "notice-double", 8);
  await page.goto(`/projects/${projectId}/notice`);
  await expect(page.getByText("실행 중").first()).toBeVisible();
  await expect(page.getByText("에이전트가 문서를 다시 쓰는 중")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("완료", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("두 번째 판에서 덧붙인 문단")).toBeVisible();
  await expect(page.getByText("에이전트가 문서를 다시 쓰는 중")).toBeHidden();
});
