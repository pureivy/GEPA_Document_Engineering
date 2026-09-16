import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import "./fonts.css";

export const metadata: Metadata = {
  title: "GEPA 문서 엔지니어링",
  description: "조사 → 사업계획서 → 공고문 → 보도자료를 한글(HWPX) 서식으로 생성하는 도구",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full">
      <body className="flex h-full min-h-full flex-col">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[#003366] text-[11px] font-bold text-white">G</span>
            GEPA 문서 엔지니어링
          </Link>
          <span className="text-xs text-slate-400">경상북도경제진흥원 · 사업 문서 자동 작성</span>
        </div>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
