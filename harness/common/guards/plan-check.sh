#!/bin/bash

export SEATWORKS_GUARD_LABEL="Plan check"
hook_io=${SEATWORKS_HOOK_IO:-${SEATWORKS_KIT:+$SEATWORKS_KIT/harness/common/hook-io.sh}}
[ -n "$hook_io" ] && [ -r "$hook_io" ] || exit 0
. "$hook_io"
command -v jq >/dev/null 2>&1 || exit 0
read_hook_input
seats=${SEATWORKS_SEATS:-$SEATWORKS_KIT/seats.json}
[ -r "$seats" ] || exit 0
max=$(jq -r '.planShape.maxLines // empty' "$seats")
globs=$(jq -r '.planShape.paths[]?' "$seats")
[ -n "$max" ] && [ -n "$globs" ] || exit 0

event=$(field .hook_event_name)
sid=$(field .session_id)
cwd=$(field .cwd)
[ -d "$cwd" ] || cwd=$PWD
top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || top=$cwd
guide_rel=.seatworks/guides/PLANS.md
guide=$top/$guide_rel
[ -r "$guide" ] || guide=$SEATWORKS_KIT/project/guides/PLANS.md
headings=$(awk '/^```md$/ { f = 1; next } f && /^```$/ { exit } f && /^## /' "$guide" 2>/dev/null)
state=${TMPDIR:-/tmp}/seatworks-plan-check/${sid:-none}
shopt -s nullglob

measure='
function flush() {
    if (name != "" && limit > 0 && count > limit)
        print "section:" name "\t" substr(name, 4) " holds " count " lines against its " limit
}
BEGIN { n = split(ENVIRON["H"], a, "\n"); for (i = 1; i <= n; i++) if (a[i] != "") ok[a[i]] = 1 }
{ sub(/\r$/, "") }
/^(```|~~~)/ { fence = !fence }
!fence && /^## / {
    flush()
    name = $0; limit = 0; count = 0
    if (match($0, /up to [0-9]+ lines/)) limit = substr($0, RSTART + 6, RLENGTH - 12) + 0
    if (n > 0 && !($0 in ok)) print "heading:" $0 "\tthe heading \"" substr($0, 4) "\" is not in the template"
    next
}
NF { count++ }
END { flush(); print "total\t" NR }'

plans() {
    local g f
    while IFS= read -r g; do
        [ -n "$g" ] || continue
        for f in "$top"/$g; do [ -f "$f" ] && printf '%s\n' "$f"; done
    done <<<"$globs"
}

summary() {
    awk -F'\t' '
        $2 ~ /^the heading / { if (++h <= 3) out[++n] = $2; next }
        { out[++n] = $2 }
        END {
            if (h > 3) out[++n] = (h - 3) " more headings are not in the template"
            for (i = 1; i <= n; i++) printf "%s%s", (i > 1 ? "; " : ""), out[i]
        }'
}

check_plan() {
    local f=$1 rel out total issues sig file
    rel=${f#"$top"/}
    out=$(H=$headings awk "$measure" "$f")
    total=$(awk -F'\t' '$1 == "total" { print $2 }' <<<"$out")
    issues=$(grep -v '^total' <<<"$out")
    if [ "${total:-0}" -gt "$max" ]; then
        issues=$(printf 'lines:%s\tthe plan is %s lines against a %s-line page\n%s' "$(((total - max - 1) / 50))" "$total" "$max" "$issues")
    fi
    issues=$(grep . <<<"$issues")
    file=$state/$(printf '%s' "$f" | shasum | cut -c1-16)
    if [ -z "$issues" ]; then
        rm -f "$file"
        return
    fi
    sig=$(cut -f1 <<<"$issues" | sort)
    if [ -f "$file" ] && [ -z "$(comm -13 "$file" <(printf '%s\n' "$sig"))" ]; then
        return
    fi
    mkdir -p "$state" && printf '%s\n' "$sig" >"$file"
    printf 'In %s: %s. In this kit a plan is current state: an update replaces its row or line, each section'\''s size is in its heading, and reviews, the reasoning behind rulings, evidence and incidents each have a file of their own, listed in %s.' \
        "$rel" "$(summary <<<"$issues")" "$guide_rel"
}

case $event in
PostToolUse)
    targets=
    case $(field .tool_name) in
    Edit | Write | MultiEdit)
        p=$(field .tool_input.file_path)
        case $p in /*) ;; *) p=$cwd/$p ;; esac
        while IFS= read -r f; do
            [ "$f" -ef "$p" ] && targets=$f
        done < <(plans)
        ;;
    Bash)
        cmd=$(field .tool_input.command)
        while IFS= read -r g; do
            case $cmd in *"${g%/*}"*) targets=$(plans) ;; esac
        done <<<"$globs"
        ;;
    esac
    msg=
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        m=$(check_plan "$f")
        [ -n "$m" ] && msg=${msg:+$msg$'\n'}$m
    done <<<"$targets"
    [ -n "$msg" ] && note PostToolUse "$msg"
    ;;
SessionStart)
    [ "$(field .source)" = compact ] || exit 0
    list=
    count=0
    while IFS= read -r f; do
        list=${list:+$list, }${f#"$top"/}" ($(wc -l <"$f" | tr -d ' ') lines)"
        count=$((count + 1))
    done < <(plans)
    [ $count -gt 0 ] || exit 0
    [ -n "$sid" ] && rm -rf "$state"
    [ $count -eq 1 ] && label="Active plan" || label="Active plans"
    note SessionStart "This session was compacted. $label: $list. A plan here is current state: an update replaces its row or line, each section's size is in its heading, and rulings, reviews and evidence go to the files listed in $guide_rel."
    ;;
esac
exit 0
