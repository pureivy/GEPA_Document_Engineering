#!/bin/zsh
# Open an HWPX in Hancom Office HWP (macOS) and report PASS / FAIL (the "파일을 읽거나 저장하는데 오류가 있습니다" dialog) / TIMEOUT.
# usage: scripts/hancom-check.sh file.hwpx   — closes the document window again on PASS (answers "저장 안 함").
# Needs Accessibility permission for the terminal (System Events). See docs/adr/0004-section-controls-once.md.
f="$1"; base=$(basename "$f")
open -a "Hancom Office HWP" "$f"
res=""
for i in {1..30}; do
  sleep 1
  out=$(osascript -e 'tell application "System Events" to tell process "Hancom Office HWP"
set r to ""
repeat with w in windows
  if subrole of w is "AXDialog" then
    repeat with e in (every UI element of w)
      try
        if role of e is "AXStaticText" then set r to r & (value of e as text) & " "
      end try
    end repeat
  end if
end repeat
return r
end tell' 2>/dev/null)
  if [[ "$out" == *"오류"* ]]; then
    res="FAIL: $out"
    osascript -e 'tell application "System Events" to tell process "Hancom Office HWP" to click button "확인" of window "한컴오피스 한글"' >/dev/null 2>&1
    break
  fi
  names=$(osascript -e 'tell application "System Events" to tell process "Hancom Office HWP" to get name of every window' 2>/dev/null)
  if [[ "$names" == *"$base"* ]]; then res="PASS"; break; fi
done
[[ -z "$res" ]] && res="TIMEOUT: $names"
echo "$base => $res"
if [[ "$res" == PASS ]]; then
  # close the document window: raise it then cmd+W; answer "don't save" if asked
  osascript -e "tell application \"System Events\" to tell process \"Hancom Office HWP\"
set frontmost to true
perform action \"AXRaise\" of window \"$base\"
delay 0.5
keystroke \"w\" using command down
delay 1.5
repeat with w in windows
  if subrole of w is \"AXDialog\" then
    repeat with b in (every button of w)
      try
        set n to name of b
        if n contains \"않\" or n contains \"아니\" then click b
      end try
    end repeat
  end if
end repeat
end tell" >/dev/null 2>&1
fi
