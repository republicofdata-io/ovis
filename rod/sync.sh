#!/bin/sh
# Merge an official Ovis release into the rod branch, check it, and push it.
#
#   rod/sync.sh            the newest official release (a plain vX.Y.Z tag upstream)
#   rod/sync.sh v0.4.25    that release
#   rod/sync.sh --finish   after resolving a merge conflict and committing the merge
#
# Official tags are fetched as upstream/vX.Y.Z and never pushed to the fork: Ovis's update
# button offers the fork's newest vX.Y.Z tag, which would install an official release
# without our changes. Updates go through 'make install' instead.
set -eu

die() { echo "rod sync: $*" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"

check_and_push() {
	echo "rod sync: installing dependencies, type-checking, running unit tests"
	bun install --frozen-lockfile
	bun run typecheck
	bun run test:unit
	git push origin rod
	echo "rod sync: rod pushed. Run 'make install' to put it on this Mac."
}

[ "$(git branch --show-current)" = rod ] || die "switch to the rod branch first"
[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted changes"

if [ "${1:-}" = "--finish" ]; then
	check_and_push
	exit 0
fi

git fetch --quiet upstream
git fetch --quiet origin
[ "$(git rev-parse rod)" = "$(git rev-parse origin/rod)" ] ||
	die "rod and origin/rod differ: pull or push first"

version=${1:-}
if [ -z "$version" ]; then
	version=$(git tag -l 'upstream/v*' | sed 's#^upstream/##' |
		grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1)
fi
[ -n "$version" ] || die "no official release found under upstream/v*"
git rev-parse -q --verify "refs/tags/upstream/$version" >/dev/null ||
	die "no official release $version"

if git merge-base --is-ancestor "upstream/$version" rod; then
	echo "rod sync: rod already contains Ovis $version"
	exit 0
fi

echo "rod sync: merging Ovis $version into rod"
if ! git merge --no-ff --no-edit -m "Merge Ovis $version into rod" "upstream/$version"; then
	die "conflicts. Resolve them, 'git commit', then run: make sync-finish"
fi
check_and_push
