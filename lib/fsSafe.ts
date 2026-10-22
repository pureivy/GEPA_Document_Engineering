/**
 * `fs.rmSync` 대용 — **한글 경로에서 rmSync 가 Node 프로세스를 통째로 죽인다.**
 *
 * Windows 의 Node 24.13 에서 `rmSync("C:\\…\\남상범피스\\…")` 는 예외도 없이 프로세스를 끝낸다
 * (종료 코드 3221226505 = 0xC0000409). 같은 경로의 `unlinkSync`·`rmdirSync` 는 멀쩡하다(2026-10-02 실측).
 * 이 저장소가 한글 폴더 아래에 있으므로 서버에서 파일을 지우는 순간(렌더 캐시 정리, 프로젝트 삭제,
 * 자료 삭제) 서버가 꺼졌다. 그래서 지우기는 모두 이 함수를 거친다 — rmSync 를 직접 쓰지 않는다.
 */
import { chmodSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** 파일이나 폴더를 지운다. 없으면 조용히 넘어간다(`rmSync(p, { recursive: true, force: true })` 와 같은 뜻). */
export function removeSync(p: string): void {
  let st;
  try {
    st = lstatSync(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) removeSync(join(p, name));
    rmdirSync(p);
  } else {
    try {
      unlinkSync(p);
    } catch (e) {
      // Windows 는 읽기 전용 파일(위키 사본은 0444 로 둔다)을 unlink 하지 못한다 — 쓰기를 열고 다시 지운다
      if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e;
      chmodSync(p, 0o666);
      unlinkSync(p);
    }
  }
}
