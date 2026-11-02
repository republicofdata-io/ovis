#!/bin/sh
# Check what is about to become public for private names and secrets.
#
#   rod/public-check.sh                  our commits on this branch not yet on origin/rod
#   rod/public-check.sh <revisions...>   our commits in those git rev-list revisions
#   rod/public-check.sh --stdin          a text, such as a pull request body
#
# "Our commits" leave out every commit of an official release (refs/tags/upstream/*), so a
# sync merge is not flagged for upstream's own code. Each commit's message, the names of
# the files it touches and the lines it adds are matched against the private word list
# (ROD_PUBLIC_DENYLIST, default ~/.config/rod/public-denylist.txt) and scanned by gitleaks.
# The word list stays outside the repository: it names what it protects.
set -eu

die() { echo "public check: $*" >&2; exit 2; }

list=${ROD_PUBLIC_DENYLIST:-$HOME/.config/rod/public-denylist.txt}
[ -r "$list" ] || die "no private word list at $list (see rod/README.md, Public repository)"
command -v gitleaks >/dev/null || die "gitleaks is not installed: brew install gitleaks"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
grep -vE '^[[:space:]]*(#|$)' "$list" | grep -v '^re:' >"$work/words" || true
grep '^re:' "$list" | sed 's/^re://' >"$work/patterns" || true

# match <label> <file>: print the lines of <file> that hold a listed word; fail when any do
match() {
	found=1
	if [ -s "$work/words" ] && grep -inF -f "$work/words" "$2" >"$work/hits" 2>/dev/null; then found=0; fi
	if [ -s "$work/patterns" ] && grep -inE -f "$work/patterns" "$2" >>"$work/hits" 2>/dev/null; then found=0; fi
	if [ "$found" -eq 0 ]; then
		echo "public check: private word in $1:" >&2
		sort -u "$work/hits" | sed 's/^/    /' >&2
		return 1
	fi
	return 0
}

# secrets <label> <file>: scan <file> with gitleaks; any finding, or gitleaks failing, fails
secrets() {
	if ! gitleaks stdin --no-banner --redact --exit-code 1 <"$2" >"$work/leaks" 2>&1; then
		echo "public check: gitleaks found a secret in $1, or could not run:" >&2
		sed 's/^/    /' "$work/leaks" >&2
		return 1
	fi
	return 0
}

failed=0

if [ "${1:-}" = "--stdin" ]; then
	cat >"$work/text"
	match "the text" "$work/text" || failed=1
	secrets "the text" "$work/text" || failed=1
	[ "$failed" -eq 0 ] && echo "public check: the text is clean"
	exit "$failed"
fi

cd "$(git rev-parse --show-toplevel)"
[ "$#" -gt 0 ] || set -- HEAD ^origin/rod
upstream=$(git for-each-ref --format='^%(objectname)' 'refs/tags/upstream/')

# shellcheck disable=SC2086
commits=$(git rev-list --no-merges "$@" $upstream)
if [ -z "$commits" ]; then
	echo "public check: no commits of ours to check"
	exit 0
fi

: >"$work/all"
for c in $commits; do
	short=$(git rev-parse --short "$c")
	git log -1 --format=%B "$c" >"$work/text"
	git show --format= --name-only "$c" >>"$work/text"
	git show --format= --unified=0 --no-color "$c" | grep -E '^\+' | grep -vE '^\+\+\+ ' >>"$work/text" || true
	match "commit $short ($(git log -1 --format=%s "$c"))" "$work/text" || failed=1
	cat "$work/text" >>"$work/all"
done

secrets "our commits" "$work/all" || failed=1

if [ "$failed" -eq 0 ]; then
	echo "public check: $(echo "$commits" | wc -l | tr -d ' ') commit(s) clean"
else
	echo "public check: fix the commits above (git commit --amend or git rebase) before pushing" >&2
fi
exit "$failed"
