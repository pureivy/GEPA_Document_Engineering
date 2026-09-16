/** Prints which public-data sources are configured in .env.local (`pnpm data:status`). */
import { config } from "dotenv";
import { researchDataSourcesStatus } from "../lib/research/dataSources";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const st = researchDataSourcesStatus();
const mark = (b: boolean) => (b ? "✓" : "✗");
console.log(`data.go.kr 인증키 ${mark(st.dataGoKr.keySet)}   KOSIS ${mark(st.kosis)}   법제처 ${mark(st.law)}   기업마당 ${mark(st.bizinfo)}`);
console.log(`\n사용 가능 (DATA_GO_KR_SERVICES): ${st.dataGoKr.services.length}개`);
for (const s of st.dataGoKr.services) console.log(`  ✓ ${s.id}  ${s.name}  — ${s.use}`);
if (st.dataGoKr.unknownIds.length) console.log(`\n카탈로그에 없는 id (호출 불가): ${st.dataGoKr.unknownIds.join(", ")}`);
if (st.dataGoKr.notEnabled.length) {
  console.log(`\n아직 신청/등록 안 됨: ${st.dataGoKr.notEnabled.length}개`);
  for (const s of st.dataGoKr.notEnabled) console.log(`  · ${s.id}  ${s.name}`);
}
