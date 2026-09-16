"use client";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/client/format";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-slate-800 bg-slate-800 text-white hover:bg-slate-700",
        primary: "border-sky-700 bg-sky-700 text-white hover:bg-sky-600",
        outline: "border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
        ghost: "border-transparent bg-transparent text-slate-700 hover:bg-slate-100",
        danger: "border-red-600 bg-red-600 text-white hover:bg-red-500",
        subtle: "border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-9 px-3.5",
        lg: "h-10 px-5 text-base",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({ className, variant, size, loading, children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading ? <Spinner className="h-3.5 w-3.5" /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin text-current", className ?? "h-4 w-4")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export { buttonVariants };
