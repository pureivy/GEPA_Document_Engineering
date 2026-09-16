/** Small helpers shared by the agent/run API route handlers. */
import { z } from "zod";

export function jsonError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error, ...(extra ?? {}) }, { status });
}

export async function readJsonBody<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, response: jsonError(400, "Invalid JSON body") };
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: jsonError(400, "Validation failed", { issues: parsed.error.issues }) };
  }
  return { ok: true, data: parsed.data };
}
