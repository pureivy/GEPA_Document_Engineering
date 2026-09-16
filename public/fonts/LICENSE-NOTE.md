# Font files in this directory

These TTF files are copied by `scripts/setup-fonts.ts` from the locally installed
Hancom Office HWP bundle (`/Applications/Hancom Office HWP.app/Contents/Resources/Hnc/Shared/TTF`) purely so the in-browser preview and the
rhwp SVG/PDF renderer on THIS machine can show the same fonts Hancom uses.

They are proprietary (Hancom / HanYang / Microsoft). They are gitignored, must not be
redistributed, and the generated HWPX files never embed them (`isEmbedded="0"`).
When the copies are absent the app falls back to Noto Sans KR / Noto Serif KR.
