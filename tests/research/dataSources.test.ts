import { describe, expect, it } from "vitest";
import { callableDataGoKrServices, DATA_GO_KR_CATALOG, parseServiceIds, researchDataSourcesStatus } from "../../lib/research/dataSources";

describe("research data sources from env", () => {
  it("parses the service id list leniently and de-duplicates", () => {
    expect(parseServiceIds("15134343, 15095335;15012005\n15134343")).toEqual(["15134343", "15095335", "15012005"]);
    expect(parseServiceIds(undefined)).toEqual([]);
    expect(parseServiceIds("  ")).toEqual([]);
  });
  it("reports enabled, unknown and not-yet-enabled services and the three other portals", () => {
    const st = researchDataSourcesStatus({ DATA_GO_KR_KEY: "k", DATA_GO_KR_SERVICES: "15134343,99999999", KOSIS_KEY: "x", LAW_OC: "", BIZINFO_KEY: undefined });
    expect(st.dataGoKr.keySet).toBe(true);
    expect(st.dataGoKr.services.map((s) => s.id)).toEqual(["15134343"]);
    expect(st.dataGoKr.unknownIds).toEqual(["99999999"]);
    expect(st.dataGoKr.notEnabled).toHaveLength(DATA_GO_KR_CATALOG.length - 1);
    expect(st.kosis).toBe(true);
    expect(st.law).toBe(false);
    expect(st.bizinfo).toBe(false);
  });
  it("nothing is callable without the data.go.kr key, even when services are listed", () => {
    expect(callableDataGoKrServices({ DATA_GO_KR_SERVICES: "15134343" })).toEqual([]);
    expect(callableDataGoKrServices({ DATA_GO_KR_KEY: "k", DATA_GO_KR_SERVICES: "15134343,15095335" }).map((s) => s.id)).toEqual(["15134343", "15095335"]);
  });
  it("catalog ids are unique", () => {
    expect(new Set(DATA_GO_KR_CATALOG.map((s) => s.id)).size).toBe(DATA_GO_KR_CATALOG.length);
  });
});
