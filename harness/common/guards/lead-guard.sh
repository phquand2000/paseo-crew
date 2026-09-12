#!/bin/bash

role=${1:-${SEATWORKS_ROLE:-lead}}
case $role in
supervisor)
    who=Supervisor
    rule="The Supervisor writes only in .seatworks/; code and tests go to a Lead, whose Peers write them."
    ;;
watcher)
    who=Watcher
    rule="The watcher writes only its log in .seatworks/records/attention/; everything else goes to the Supervisor as an ATTENTION event."
    ;;
*)
    role=lead
    who=Lead
    rule="The Lead writes only coordination records (.seatworks/, docs/, doc/, CONTEXT.md, and the repository instruction files), with your file tools; code and tests go to an Engineer Peer through a brief."
    ;;
esac

export SEATWORKS_GUARD_LABEL="$who guard"
hook_io=${SEATWORKS_HOOK_IO:-${SEATWORKS_KIT:+$SEATWORKS_KIT/harness/common/hook-io.sh}}
if [ -n "$hook_io" ] && [ -r "$hook_io" ]; then
    . "$hook_io"
else
    echo "$who guard: harness/common/hook-io.sh is unreadable; set env.SEATWORKS_KIT on this seat's provider and rerun setup/setup-seats.fish." >&2
    exit 2
fi

deny() {
    block "$1 $rule"
}

context_files=$(
    if command -v jq >/dev/null 2>&1 && [ -d "${SEATWORKS_KIT:-}/harness" ]; then
        jq -r '.contextFile // empty' "$SEATWORKS_KIT"/harness/*/harness.json 2>/dev/null | sort -u | tr '\n' ' '
    fi
)
[ -n "$context_files" ] || context_files="AGENTS.md"


allowed() {
    case $role:$1 in
    supervisor:.seatworks | supervisor:.seatworks/*) return 0 ;;
    watcher:.seatworks/records/attention/?*) return 0 ;;
    lead:.seatworks | lead:.seatworks/* | lead:docs | lead:docs/* | lead:doc | lead:doc/*) return 0 ;;
    lead:CONTEXT.md) return 0 ;;
    esac
    case $role:$1 in
    lead:*.md)
        case " $context_files " in *" ${1#*:} "*) return 0 ;; esac
        case " $context_files " in *" $1 "*) return 0 ;; esac
        ;;
    esac
    return 1
}

inplace() {
    deny "in-place edits (sed -i, perl -i, patch, git apply) are blocked."
}

need_jq
read_hook_input
cwd=$(field .cwd)
[ -d "$cwd" ] || cwd=$PWD
anchor=$cwd
[ -d "$SEATWORKS_REPO" ] && anchor=$SEATWORKS_REPO
common=$(git -C "$anchor" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
root=$(cd "$anchor" && pwd -P)

resolve() {
    local p=$1 d rest t n=0
    while :; do
        d=$p rest=
        while [ ! -e "$d" ] && [ ! -L "$d" ]; do
            rest=/${d##*/}$rest
            d=${d%/*}
            d=${d:-/}
        done
        if [ -L "$d" ]; then
            n=$((n + 1))
            [ $n -le 40 ] || return 1
            t=$(readlink "$d")
            case $t in /*) ;; *) t=${d%/*}/$t ;; esac
            p=$t$rest
        elif [ -d "$d" ]; then
            t=$(cd "$d" 2>/dev/null && pwd -P) || return 1
            ex=${t%/}$rest
            return 0
        else
            t=$(cd "${d%/*}/" 2>/dev/null && pwd -P) || return 1
            ex=${t%/}/${d##*/}$rest
            return 0
        fi
    done
}

check() {
    local p=$1 d top rel
    case $p in
    /*) ;;
    *)
        [ "$cwd" = "?" ] && block "$1 is relative to a directory this guard can't follow (cd to a variable, cd -, or popd); use an absolute path."
        p=$cwd/$p
        ;;
    esac
    resolve "$p" || block "$1 can't be resolved (a symlink loop or an unreadable directory)."
    case /$ex/ in */../*) block "$1 is an unclear path." ;; esac
    case $ex in /dev/*) return 0 ;; esac
    if [ -n "$common" ]; then
        d=$ex
        while [ ! -d "$d" ]; do d=${d%/*}; d=${d:-/}; done
        [ "$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" = "$common" ] || return 0
        top=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) || return 0
    else
        top=$root
    fi
    case $ex/ in "$top"/*) ;; *) return 0 ;; esac
    rel=${ex#"$top"}
    rel=${rel#/}
    [ -n "$rel" ] || block "$1 is the repository root."
    allowed "$rel" && return 0
    deny "$rel is a repository file."
}

expand() {
    local h='$HOME' hb='${HOME}' tm='$TMPDIR' tb='${TMPDIR}' pw='$PWD' pb='${PWD}' tp='${TOP}' t
    ex=$1
    case $ex in "~") ex=$HOME ;; "~/"*) ex=$HOME/${ex#"~/"} ;; esac
    ex=${ex//"$hb"/$HOME}
    ex=${ex//"$h"/$HOME}
    ex=${ex//"$tb"/${TMPDIR:-/tmp}}
    ex=${ex//"$tm"/${TMPDIR:-/tmp}}
    if [ "$cwd" != "?" ]; then
        ex=${ex//"$pb"/$cwd}
        ex=${ex//"$pw"/$cwd}
        case $ex in *"$tp"*) t=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) && ex=${ex//"$tp"/$t} ;; esac
    fi
    case $ex in *'$'*) return 1 ;; esac
}

lex='
function add(x) { cur = cur x; has = 1 }
function endw() {
    if (!has) return
    gsub(/\n/, " ", cur)
    if (pend == "o") print "o" cur
    else if (pend == "h") { hd[++nh] = cur; hs[nh] = strip }
    else if (pend != "i") print "w" cur
    pend = ""; cur = ""; has = 0
}
function endc(t) { endw(); pend = ""; print "." t }
function closing(i,   d, c, j) {
    d = 1
    while (i <= n && d > 0) {
        c = substr(s, i, 1)
        if (c == "\047") { j = index(substr(s, i + 1), "\047"); i += j ? j + 1 : n; continue }
        if (c == "\\") { i += 2; continue }
        if (c == "(") d++
        if (c == ")") d--
        i++
    }
    return i
}
function subst(i,   j, b) {
    j = closing(i)
    b = substr(s, i, j - i - 1)
    add(b == "pwd" ? "${PWD}" : (b == "git rev-parse --show-toplevel" ? "${TOP}" : "$()"))
    return j
}
function sq(i,   j) {
    j = index(substr(s, i), "\047")
    if (!j) { add(substr(s, i)); return n + 1 }
    add(substr(s, i, j - 1))
    return i + j
}
function dq(i,   c, j) {
    has = 1
    while (i <= n) {
        c = substr(s, i, 1)
        if (c == "\"") return i + 1
        if (c == "\\") { c = substr(s, i + 1, 1); if (c != "\n") add(index("\"\\$`", c) ? c : "\\" c); i += 2; continue }
        if (c == "$" && substr(s, i + 1, 1) == "(") { i = subst(i + 2); continue }
        if (c == "`") { j = index(substr(s, i + 1), "`"); add("$()"); i += j ? j + 1 : n; continue }
        add(c)
        i++
    }
    return i
}
function heredocs(i,   k, j, line) {
    for (k = 1; k <= nh; k++) {
        while (i <= n) {
            j = index(substr(s, i), "\n")
            line = j ? substr(s, i, j - 1) : substr(s, i)
            i = j ? i + j : n + 1
            if (hs[k]) sub(/^\t+/, "", line)
            if (line == hd[k]) break
        }
    }
    nh = 0
    return i
}
{ s = s $0 "\n" }
END {
    n = length(s); i = 1
    while (i <= n) {
        c = substr(s, i, 1); d = substr(s, i + 1, 1)
        if (c == "\\") { if (d != "\n") add(d); i += 2 }
        else if (c == "\047") i = sq(i + 1)
        else if (c == "\"") i = dq(i + 1)
        else if (c == "$" && d == "\047") i = sq(i + 2)
        else if (c == "$" && d == "(") i = subst(i + 2)
        else if (c == "`") { j = index(substr(s, i + 1), "`"); add("$()"); i += j ? j + 1 : n }
        else if (c == "#" && !has) { j = index(substr(s, i), "\n"); i = j ? i + j - 1 : n + 1 }
        else if (c == " " || c == "\t") { endw(); i++ }
        else if (c == "\n") { endc(";"); i = heredocs(i + 1) }
        else if (c == "&" && d == ">") { endw(); pend = "o"; i += (substr(s, i + 2, 1) == ">") ? 3 : 2 }
        else if (c == "|") { endc(d == "|" ? ";" : "|"); i += (d == "|" || d == "&") ? 2 : 1 }
        else if (c == ";" || c == "&") { endc(";"); i += (d == c) ? 2 : 1 }
        else if ((c == "<" || c == ">") && d == "(") { i = closing(i + 2); add("$()") }
        else if (c == "(" && d == "(" && !has) { i = closing(i + 1); add("(())") }
        else if (c == "(" && d == ")") { add("()"); i += 2 }
        else if (c == "(") { endw(); print "("; i++ }
        else if (c == ")") { endc(";"); print ")"; i++ }
        else if (c == ">" || c == "<") {
            if (has && cur ~ /^[0-9]+$/) { cur = ""; has = 0 } else endw()
            i++
            if (c == ">") {
                if (d == ">" || d == "|") i++
                else if (d == "&") { i++; if (substr(s, i, 1) ~ /[0-9-]/) { while (substr(s, i, 1) ~ /[0-9-]/) i++; continue } }
                pend = "o"
            }
            else if (d == "<" && substr(s, i + 1, 1) == "<") { i += 2; pend = "i" }
            else if (d == "<") { i++; strip = (substr(s, i, 1) == "-"); if (strip) i++; pend = "h" }
            else if (d == ">") { i++; pend = "o" }
            else if (d == "&") { i++; while (substr(s, i, 1) ~ /[0-9-]/) i++ }
            else pend = "i"
        }
        else { add(c); i++ }
    }
    endc(";")
}'

operands() {
    local j end=0
    op=()
    opok=()
    for ((j = k; j < n; j++)); do
        case $end:${a[$j]} in
        0:--) end=1 ;;
        0:-*) ;;
        *) op+=("${a[$j]}"); opok+=("${ok[$j]}") ;;
        esac
    done
}

checkops() {
    local j
    for ((j = 0; j < ${#op[@]}; j++)); do
        [ "${opok[$j]}" = 1 ] && check "${op[$j]}"
    done
}

copy() {
    local j m
    for ((j = k; j < n; j++)); do
        case ${a[$j]} in
        -t | --target-directory) [ "${ok[$((j + 1))]}" = 1 ] && check "${a[$((j + 1))]}"; return ;;
        --target-directory=*) [ "${ok[$j]}" = 1 ] && check "${a[$j]#*=}"; return ;;
        esac
    done
    operands
    m=${#op[@]}
    if [ "$1" = mv ]; then
        for ((j = 0; j < m - 1; j++)); do [ "${opok[$j]}" = 1 ] && check "${op[$j]}"; done
    fi
    if [ $m -ge 2 ]; then
        j=$((m - 1))
        case ${op[$j]} in [!/]*:*) case ${op[$j]%%:*} in */*) ;; *) return ;; esac ;; esac
        [ "${opok[$j]}" = 1 ] && check "${op[$j]}"
    elif [ $m -eq 1 ] && [ "$1" = ln ] && [ "${opok[0]}" = 1 ]; then
        check "${op[0]##*/}"
    fi
}

cdto() {
    local to
    while [ $k -lt $n ]; do
        case ${a[$k]} in -[PLe@]*) k=$((k + 1)) ;; --) k=$((k + 1)); break ;; *) break ;; esac
    done
    [ "$term$inpipe" = ";0" ] || return 0
    if [ $k -ge $n ]; then
        to=$HOME
    elif [ "${ok[$k]}" != 1 ] || [ "${a[$k]}" = - ]; then
        to="?"
    else
        to=${a[$k]}
    fi
    case $to in "?" | /*) ;; *) [ "$cwd" = "?" ] && to="?" || to=$cwd/$to ;; esac
    cwd=$to
}

perlish() {
    local j=$k w x ch skip
    while [ $j -lt $n ]; do
        w=${a[$j]}
        case $w in --) return ;; --*) j=$((j + 1)); continue ;; -?*) ;; *) return ;; esac
        x=${w#-}
        skip=0
        while [ -n "$x" ]; do
            ch=${x:0:1}
            x=${x:1}
            case $ch in
            i) inplace ;;
            [eE]) [ -z "$x" ] && skip=1; break ;;
            [MmIxCdDFlr0-9]) break ;;
            esac
        done
        j=$((j + 1 + skip))
    done
}

gitapply() {
    while [ $k -lt $n ]; do
        case ${a[$k]} in -C | -c | --git-dir | --work-tree) k=$((k + 2)) ;; -*) k=$((k + 1)) ;; *) break ;; esac
    done
    [ "${a[$k]}" = apply ] || return 0
    case " ${a[*]:$((k + 1))} " in
    *" --apply "*) inplace ;;
    *" --check "* | *" --stat "* | *" --numstat "* | *" --summary "*) ;;
    *) inplace ;;
    esac
}

run() {
    local term=$1 t k=0 n c
    local -a a ok
    for t in "${tg[@]}"; do expand "$t" && check "$ex"; done
    for t in "${words[@]}"; do
        if expand "$t"; then ok+=(1); else ok+=(0); fi
        a+=("$ex")
    done
    n=${#a[@]}
    while [ $k -lt $n ]; do
        [ "${ok[$k]}" = 1 ] || return 0
        case ${a[$k]} in
        [A-Za-z_]*=*) case ${a[$k]%%=*} in *[!A-Za-z0-9_]*) break ;; esac ;;
        -* | [0-9]*) [ $k -gt 0 ] || break ;;
        *)
            case ${a[$k]##*/} in
            sudo | env | command | exec | nohup | time | nice | timeout | '!' | '{' | '}' | if | then | elif | else | do | while | until) ;;
            *) break ;;
            esac
            ;;
        esac
        k=$((k + 1))
    done
    [ $k -lt $n ] && [ "${ok[$k]}" = 1 ] || return 0
    c=${a[$k]##*/}
    k=$((k + 1))
    case $c in
    cd | pushd) cdto ;;
    popd) [ "$term$inpipe" = ";0" ] && cwd="?" ;;
    tee | rm | rmdir | unlink) operands; checkops ;;
    cp | mv | ln | install | rsync) copy "$c" ;;
    sed | gsed) for t in "${a[@]:$k}"; do case $t in --in-place*) inplace ;; --*) ;; -*i*) inplace ;; esac; done ;;
    perl | ruby) perlish ;;
    patch) case " ${a[*]:$k} " in *" --dry-run "* | *" --check "* | *" -C "*) ;; *) inplace ;; esac ;;
    git) gitapply ;;
    esac
}

scan() {
    local line inpipe=0 sp=0
    local -a words tg cs
    while IFS= read -r line; do
        case $line in
        "(") cs[$sp]=$cwd; sp=$((sp + 1)) ;;
        ")") [ $sp -gt 0 ] && sp=$((sp - 1)) && cwd=${cs[$sp]} ;;
        .?)
            run "${line#.}"
            [ "$line" = ".|" ] && inpipe=1 || inpipe=0
            words=()
            tg=()
            ;;
        w*) words+=("${line#w}") ;;
        o*) tg+=("${line#o}") ;;
        esac
    done < <(awk "$lex" <<<"$1")
}

case $(field .tool_name) in
Edit | Write | MultiEdit | NotebookEdit)
    p=$(field '.tool_input.file_path // .tool_input.notebook_path')
    [ -n "$p" ] && expand "$p" && check "$ex"
    ;;
Bash) scan "$(field .tool_input.command)" ;;
esac
pass
