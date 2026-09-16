/** Korean particle selection by final consonant (받침). */
export function hasBatchim(s: string): boolean {
  const ch = s.trim().replace(/[)\]」』】\s]+$/, "").slice(-1);
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  if (cp >= 0xac00 && cp <= 0xd7a3) return (cp - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return "013678".includes(ch);
  if (/[a-zA-Z]/.test(ch)) return /[lmnrLMNR]/.test(ch);
  return false;
}
export const josa = {
  와과: (s: string) => (hasBatchim(s) ? "과" : "와"),
  을를: (s: string) => (hasBatchim(s) ? "을" : "를"),
  이가: (s: string) => (hasBatchim(s) ? "이" : "가"),
  은는: (s: string) => (hasBatchim(s) ? "은" : "는"),
  으로로: (s: string) => (hasBatchim(s) && !s.endsWith("ㄹ") ? "으로" : "로"),
};
