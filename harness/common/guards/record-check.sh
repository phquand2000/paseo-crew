#!/bin/bash

role=${1:-${SEATWORKS_ROLE:-}}
export SEATWORKS_GUARD_LABEL="Record check"
hook_io=${SEATWORKS_HOOK_IO:-${SEATWORKS_KIT:+$SEATWORKS_KIT/harness/common/hook-io.sh}}
[ -n "$hook_io" ] && [ -r "$hook_io" ] || exit 0
. "$hook_io"
command -v jq >/dev/null 2>&1 || exit 0
read_hook_input
seats=${SEATWORKS_SEATS:-$SEATWORKS_KIT/seats.json}
[ -r "$seats" ] || exit 0
sep=$(printf '\037')
shapes=$(jq -r --arg r "$role" --arg s "$sep" '
    (.recordShapes // [])[]
    | select($r == "" or ((.roles // []) | length) == 0 or ((.roles // []) | index($r)))
    | .paths[] as $p
    | [$p, (.maxLines | tostring), (.template // ""), (.tail // "")] | join($s)' "$seats" 2>/dev/null)
[ -n "$shapes" ] || exit 0

event=$(field .hook_event_name)
sid=$(field .session_id)
cwd=$(field .cwd)
[ -d "$cwd" ] || cwd=$PWD
top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || top=$cwd
state=${TMPDIR:-/tmp}/seatworks-record-check/${sid:-none}
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

records() {
    local g max template tail f
    while IFS=$sep read -r g max template tail; do
        [ -n "$g" ] || continue
        for f in "$top"/$g; do
            [ -f "$f" ] && printf '%s\n' "$f$sep$max$sep$template$sep$tail"
        done
    done <<<"$shapes"
}

headings_for() {
    local t=$1 guide
    [ -n "$t" ] || return 0
    guide=$top/$t
    [ -r "$guide" ] || guide=$SEATWORKS_KIT/project/${t#.seatworks/}
    [ -r "$guide" ] || return 0
    awk '/^```md$/ { f = 1; next } f && /^```$/ { exit } f && /^## /' "$guide"
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

check_record() {
    local f=$1 max=$2 template=$3 tail=$4 rel out total issues sig file
    rel=${f#"$top"/}
    out=$(H=$(headings_for "$template") awk "$measure" "$f")
    total=$(awk -F'\t' '$1 == "total" { print $2 }' <<<"$out")
    issues=$(grep -v '^total' <<<"$out")
    if [ "${total:-0}" -gt "$max" ]; then
        issues=$(printf 'lines:%s\tthe file is %s lines against its %s\n%s' "$(((total - max - 1) / 50))" "$total" "$max" "$issues")
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
    printf 'In %s: %s.%s' "$rel" "$(summary <<<"$issues")" "${tail:+ $tail}"
}

case $event in
PostToolUse)
    targets=
    case $(field .tool_name) in
    Edit | Write | MultiEdit)
        p=$(field .tool_input.file_path)
        case $p in /*) ;; *) p=$cwd/$p ;; esac
        while IFS=$sep read -r f max template tail; do
            [ "$f" -ef "$p" ] && targets=$f$sep$max$sep$template$sep$tail
        done < <(records)
        ;;
    Bash)
        cmd=$(field .tool_input.command)
        while IFS=$sep read -r f max template tail; do
            case $cmd in *"${f##*/}"*) targets=${targets:+$targets$'\n'}$f$sep$max$sep$template$sep$tail ;; esac
        done < <(records)
        ;;
    esac
    msg=
    while IFS=$sep read -r f max template tail; do
        [ -n "$f" ] || continue
        m=$(check_record "$f" "$max" "$template" "$tail")
        [ -n "$m" ] && msg=${msg:+$msg$'\n'}$m
    done <<<"$targets"
    [ -n "$msg" ] && note PostToolUse "$msg"
    ;;
SessionStart)
    [ "$(field .source)" = compact ] || exit 0
    list=
    tails=
    while IFS=$sep read -r f max template tail; do
        list=${list:+$list; }${f#"$top"/}" ($(wc -l <"$f" | tr -d ' ') of $max lines)"
        case $tails in *"$tail"*) ;; *) tails=${tails:+$tails }$tail ;; esac
    done < <(records)
    [ -n "$list" ] || exit 0
    [ -n "$sid" ] && rm -rf "$state"
    note SessionStart "This session was compacted. Records kept to a size: $list. $tails"
    ;;
esac
exit 0
