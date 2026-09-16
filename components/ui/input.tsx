"use client";
import * as React from "react";
import { cn } from "@/lib/client/format";

const base = "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:bg-slate-50 disabled:text-slate-500";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-[80px] leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(base, "h-9", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, children, hint, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: string }) {
  return (
    <label className={cn("mb-1 block text-xs font-medium text-slate-600", className)} {...props}>
      {children}
      {hint ? <span className="ml-1 font-normal text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function Field({ label, hint, children, className, required }: { label: string; hint?: string; children: React.ReactNode; className?: string; required?: boolean }) {
  return (
    <div className={className}>
      <Label hint={hint}>
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </Label>
      {children}
    </div>
  );
}
