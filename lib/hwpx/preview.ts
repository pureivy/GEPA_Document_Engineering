/**
 * Preview/PrvImage.png — a real thumbnail of page 1 instead of the template's 68-byte stub.
 *
 * Rasterization needs the rendered document (rhwp SVG of page 0), which needs the built HWPX,
 * so this is a repack step run by `exportStageDoc` after the build: the zip is opened, the
 * preview entry replaced and the archive written again in the same entry order with
 * `mimetype` first and stored. `buildHwpx` itself stays synchronous and byte-deterministic.
 * Any failure (missing fonts, native module unavailable) keeps the original bytes.
 */
import { unzipSync, zipSync, type Zippable } from "fflate";
import { join } from "node:path";

export const PREVIEW_WIDTH_PX = 200;

export async function rasterizePageSvg(svg: string, width = PREVIEW_WIDTH_PX): Promise<Uint8Array> {
  const { Resvg } = await import("@resvg/resvg-js");
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { fontDirs: [join(process.cwd(), "public/fonts")], loadSystemFonts: true, defaultFontFamily: "휴먼명조" },
    background: "#ffffff",
  });
  return r.render().asPng();
}

/** Replace `Preview/PrvImage.png` inside an HWPX archive, preserving entry order and the stored mimetype. */
export function replacePreviewImage(hwpx: Uint8Array, png: Uint8Array): Uint8Array {
  const entries = unzipSync(hwpx);
  const out: Zippable = {};
  for (const [name, data] of Object.entries(entries)) {
    if (name === "mimetype") out[name] = [data, { level: 0 }];
    else if (name === "Preview/PrvImage.png") out[name] = [png, { level: 6 }];
    else out[name] = [data, { level: 6 }];
  }
  if (!("Preview/PrvImage.png" in out)) out["Preview/PrvImage.png"] = [png, { level: 6 }];
  return zipSync(out, { mtime: new Date("1980-01-01T00:00:00Z") });
}

/** Rasterize page 0 and embed it; returns the original bytes when anything fails. */
export async function embedPreview(hwpx: Uint8Array, page0Svg: string | undefined): Promise<{ bytes: Uint8Array; embedded: boolean; error?: string }> {
  if (!page0Svg) return { bytes: hwpx, embedded: false, error: "no page 0" };
  try {
    const png = await rasterizePageSvg(page0Svg);
    if (png.length < 100) return { bytes: hwpx, embedded: false, error: "empty png" };
    return { bytes: replacePreviewImage(hwpx, png), embedded: true };
  } catch (e) {
    return { bytes: hwpx, embedded: false, error: (e as Error).message };
  }
}
