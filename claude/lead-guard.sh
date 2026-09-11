#!/bin/bash

input=$(cat)
field() { jq -r "$1 // empty" <<<"$input"; }
tool=$(field .tool_name)
cwd=$(field .cwd)
[ -d "$cwd" ] || cwd=$PWD
common=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0

block() {
    echo "Lead guard: $1 The Lead writes only coordination records (.seatworks/, docs/, AGENTS.md, CLAUDE.md), with Edit or Write; code and tests go to an Engineer Peer through a brief." >&2
    exit 2
}

check() {
    local p=$1 d rest= top rel
    case $p in "~"*) p=$HOME${p#"~"} ;; /*) ;; *) p=$cwd/$p ;; esac
    d=$p
    while [ ! -d "$d" ]; do rest=/$(basename "$d")$rest; d=$(dirname "$d"); done
    [ "$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" = "$common" ] || return 0
    top=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) || return 0
    rel=$(cd "$d" && pwd -P)$rest
    rel=${rel#"$top"}
    rel=${rel#/}
    case /$rel/ in */../*) block "$1 is an unclear path." ;; esac
    case $rel in .seatworks/*|docs/*|AGENTS.md|CLAUDE.md) return 0 ;; esac
    block "$rel is a repository file."
}

case $tool in
Edit | Write | MultiEdit | NotebookEdit)
    p=$(field '.tool_input.file_path // .tool_input.notebook_path')
    [ -n "$p" ] && check "$p"
    ;;
Bash)
    cmd=$(field .tool_input.command | awk '
        skip { if ($0 ~ "^[ \t]*" delim "[ \t]*$") skip = 0; next }
        { print }
        match($0, /<<-?[ \t]*["'\'']?[A-Za-z_][A-Za-z0-9_]*/) {
            delim = substr($0, RSTART, RLENGTH); sub(/^<<-?[ \t]*["'\'']?/, "", delim); skip = 1
        }' | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")
    if grep -Eq '(^|[^[:alnum:]_.-])(sed[[:space:]]+([^|;&]*[[:space:]])?-[[:alnum:]]*i|perl[[:space:]]+-[[:alnum:]]*i|patch([[:space:]]|$)|git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+apply)' <<<"$cmd"; then
        block "in-place edits (sed -i, perl -i, patch, git apply) are blocked."
    fi
    while IFS= read -r seg; do
        for t in $(grep -oE '>>?[[:space:]]*[^[:space:];&|<>()]+' <<<"$seg" | sed -E 's/^>>?[[:space:]]*//'); do
            case $t in /dev/*) ;; *) check "$t" ;; esac
        done
        set -f
        set -- $(sed -E 's/[0-9]*>>?[[:space:]]*[^[:space:]]+//g' <<<"$seg")
        set +f
        case $1 in
        cd) [ -n "$2" ] && case $2 in /*) cwd=$2 ;; *) cwd=$cwd/$2 ;; esac ;;
        tee) shift; for w; do case $w in -*) ;; *) check "$w" ;; esac; done ;;
        cp | mv | install | rsync | ln) [ $# -gt 1 ] && check "${!#}" ;;
        esac
    done < <(sed -E 's/(&&|\|\||[;|&])/\n/g' <<<"$cmd")
    ;;
esac
exit 0
