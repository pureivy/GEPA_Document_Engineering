"use client";
import { createContext, useContext } from "react";
import type { DocModel, Family } from "@/lib/docmodel/schema";

export interface MetaContextValue {
  family: Family;
  meta: DocModel["meta"] | null;
  /** open the meta side sheet (undefined when editing is not available) */
  onEdit?: () => void;
}

export const MetaContext = createContext<MetaContextValue>({ family: "notice", meta: null });

export function useDocMeta(): MetaContextValue {
  return useContext(MetaContext);
}
