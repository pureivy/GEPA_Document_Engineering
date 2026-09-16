"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/client/format";

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

function useEscape(open: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

/** overlays are only rendered after a user opens them, i.e. always on the client */
function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

/** Centered modal dialog. */
export function Dialog({ open, onClose, title, description, children, footer, className }: OverlayProps) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div role="dialog" aria-modal="true" className={cn("flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-slate-200 bg-white shadow-xl", className)}>
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3">
            <div>
              {title ? <h2 className="text-base font-semibold text-slate-900">{title}</h2> : null}
              {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="닫기">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}

/** Side sheet sliding in from the right. */
export function Sheet({ open, onClose, title, description, children, footer, className }: OverlayProps) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div role="dialog" aria-modal="true" className={cn("flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl", className)}>
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3">
            <div>
              {title ? <h2 className="text-base font-semibold text-slate-900">{title}</h2> : null}
              {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="닫기">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}
