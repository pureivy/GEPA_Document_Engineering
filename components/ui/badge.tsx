import * as React from "react";
import { cn } from "@/lib/client/format";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "running";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  info: "bg-sky-50 text-sky-800 border-sky-200",
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-800 border-red-200",
  running: "bg-sky-600 text-white border-sky-600",
};

export function Badge({ tone = "neutral", className, children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4", TONES[tone], className)} {...props}>
      {tone === "running" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> : null}
      {children}
    </span>
  );
}
