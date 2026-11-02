#!/bin/sh
# Install Ovis on this machine from the fork, as the herdr plugin devswha.ovis, and start it.
#
#   rod/install.sh         the fork's rod branch
#   rod/install.sh <ref>   another branch, tag or commit of the fork (to try a pull request)
#
# Kept across the reinstall: the plugin's settings (its env file) and Ovis's own state in
# ~/.config/ovis (push keys and device subscriptions, so phones keep their alerts).
set -eu

die() { echo "rod install: $*" >&2; exit 1; }

ref=${1:-rod}
id=devswha.ovis
source=republicofdata-io/ovis

command -v herdr >/dev/null || die "herdr is not on PATH"
cfg=$(herdr plugin config-dir "$id")
backup=$(mktemp -d)
trap 'rm -rf "$backup"' EXIT
[ -f "$cfg/env" ] && cp -p "$cfg/env" "$backup/env"

port=$(sed -n 's/^PORT=//p' "$backup/env" 2>/dev/null | tail -n 1)
port=${port:-7317}

if herdr plugin list --plugin "$id" --json 2>/dev/null | grep -q "\"$id\""; then
	echo "rod install: stopping and removing the installed Ovis"
	herdr plugin action invoke "$id.stop" >/dev/null 2>&1 || true
	herdr plugin uninstall "$id"
fi

echo "rod install: installing $source at $ref (this builds the app)"
herdr plugin install "$source" --ref "$ref" --yes

if [ -f "$backup/env" ] && ! cmp -s "$backup/env" "$cfg/env" 2>/dev/null; then
	mkdir -p "$cfg"
	cp -p "$backup/env" "$cfg/env"
	echo "rod install: settings restored in $cfg/env"
fi

herdr plugin action invoke "$id.start" >/dev/null
i=0
until curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; do
	i=$((i + 1))
	[ "$i" -lt 30 ] || die "Ovis did not answer on port $port after 60 s; see 'herdr plugin log list --plugin $id'"
	sleep 2
done

herdr plugin list --plugin "$id" --json | python3 -c '
import json, sys
p = json.load(sys.stdin)["result"]["plugins"][0]
s = p["source"]
print("rod install: Ovis %s running from %s/%s at %s (%s)" % (p["version"], s["owner"], s["repo"], s["requested_ref"], s["resolved_commit"][:8]))
'
