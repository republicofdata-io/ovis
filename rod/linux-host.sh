#!/bin/sh
# Ovis on an always-on Linux machine, so a phone reaches its herdr with the Mac asleep or off.
# Run as the user whose herdr Ovis serves (never root); the service itself is installed by root
# from the unit this prints. See "Ovis on a Linux machine" in rod/README.md. Run it only from a
# fresh clone at a reviewed commit, or from the checkout it makes: a copy another user can write
# would run their code as this user.
#
#   rod/linux-host.sh prepare [ref]   fetch the fork at ref (default rod) into the checkout, build
#                                     it, and write the settings file with a new access token if
#                                     there is none yet; prints the unit for root to install
#   rod/linux-host.sh unit            print the systemd unit for this user
#   rod/linux-host.sh status          the server's own health answer on its loopback port
#   rod/linux-host.sh pair            a six-digit code that pairs one phone, good for ten minutes;
#                                     the token stays in this script, the code goes nowhere but here
#
# Where things live, all under the user's home and readable by nobody else:
#   ~/.local/share/ovis-rod   the checkout the service runs (no file in it writable by another user)
#   ~/.config/ovis-rod/env    the settings, with OVIS_TOKEN (folder 700, file 600)
#   ~/.local/state/ovis-rod   Ovis's state: paired devices, alert subscriptions (folder 700)
set -eu

die() { echo "rod linux-host: $*" >&2; exit 1; }
say() { echo "rod linux-host: $*"; }

[ "$(id -u)" != 0 ] || die "run this as the user whose herdr Ovis serves, not as root"
: "${HOME:?}"
user=$(id -un)
checkout="$HOME/.local/share/ovis-rod"
config="$HOME/.config/ovis-rod"
state="$HOME/.local/state/ovis-rod"
source=https://github.com/republicofdata-io/ovis.git
port=7317

# $1 a path the service runs or reads as this user: it and every folder above it must be this
# user's or root's and writable by nobody else, or another user could swap it. A sticky folder
# (/tmp) lets nobody replace another user's entry, so it passes.
alone() {
	path=$1
	while :; do
		case "$(stat -c %U "$path")" in "$user"|root) ;; *) die "$path is not $user's or root's" ;; esac
		case "$(stat -c %A "$path")" in *t|*T) ;; ?????w????|????????w?) die "$path is writable by another user" ;; esac
		[ "$path" = / ] && break
		path=$(dirname "$path")
	done
}

# The programs the service runs, resolved to the files themselves: the unit names those, so no link
# or PATH entry another user can change stands between the service and what it runs.
programs() {
	bun=$(PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH" command -v bun) || die "bun is not installed for $user (curl -fsSL https://bun.sh/install | bash)"
	herdr=$(PATH="$HOME/.local/bin:$PATH" command -v herdr) || die "herdr is not on $user's PATH"
	bun=$(readlink -f "$bun")
	herdr=$(readlink -f "$herdr")
	alone "$bun"
	alone "$herdr"
}

unit() {
	programs
	cat <<EOF
# Ovis (RoD fork) for $user's herdr, written by rod/linux-host.sh. Install as root:
#   /etc/systemd/system/ovis-rod.service, then systemctl daemon-reload && systemctl enable --now ovis-rod
# No setting is written here: every user can read a unit file. The token is in the EnvironmentFile
# (600 in a 700 folder), which systemd reads as root.
[Unit]
Description=Ovis for $user's herdr (RoD fork)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=$user
Environment=HOME=$HOME
Environment=PATH=$(dirname "$bun"):$(dirname "$herdr"):/usr/local/bin:/usr/bin:/bin
Environment=OVIS_HERDR_BIN=$herdr
EnvironmentFile=$config/env
WorkingDirectory=$checkout
# without a token any process on this machine could drive the panes, so it does not start
ExecStartPre=/bin/sh -c 'test "\$\${#OVIS_TOKEN}" -ge 32 || { echo "OVIS_TOKEN in $config/env is missing or shorter than 32 characters" >&2; exit 1; }'
ExecStart=$bun run server/managed.ts
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
}

# A file another user can change would run as this user (decision: no process of this user runs
# a file another can write), so the checkout, what its links point at, and the folders above it
# must be this user's alone.
owned() {
	bad=$(find -L "$checkout" \( ! -user "$user" -o -perm /022 \) -print -quit) || die "could not check every file in $checkout"
	[ -z "$bad" ] || die "$bad is writable by another user or not $user's; fix it before the service runs this checkout"
	alone "$checkout"
}

settings() {
	umask 077
	mkdir -p "$config" "$state"
	chmod 700 "$config" "$state"
	# another user who could swap the settings could set their own token
	alone "$config"
	alone "$state"
	if [ -f "$config/env" ]; then
		chmod 600 "$config/env"
		grep -Eq '^OVIS_TOKEN=.{32,}$' "$config/env" || die "$config/env has no OVIS_TOKEN of 32 characters or more: without one, any process on this machine can drive the panes"
		say "settings kept in $config/env"
		return
	fi
	token=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
	cat >"$config/env" <<EOF
# Ovis on this machine (rod/linux-host.sh). Loopback only: tailscale serve publishes it on the tailnet.
HOST=127.0.0.1
PORT=$port
# Required of every request but a paired device's: keeps other users of this machine out.
OVIS_TOKEN=$token
OVIS_STATE_DIR=$state
OVIS_AUTO_UPDATE=0
OVIS_TELEMETRY=0
DO_NOT_TRACK=1
EOF
	say "settings written to $config/env with a new access token (never shown here)"
}

prepare() {
	ref=${1:-rod}
	command -v git >/dev/null || die "git is not on PATH"
	umask 022
	mkdir -p "$HOME/.local/share"
	if [ -d "$checkout/.git" ]; then
		[ -z "$(git -C "$checkout" status --porcelain --untracked-files=no)" ] || die "$checkout has local changes; nothing changed"
		git -C "$checkout" fetch --quiet origin
	else
		git clone --quiet "$source" "$checkout"
	fi
	git -C "$checkout" checkout --quiet --detach "origin/$ref" 2>/dev/null || git -C "$checkout" checkout --quiet --detach "$ref"
	say "checkout at $ref ($(git -C "$checkout" rev-parse --short HEAD))"
	cd "$checkout"
	umask 022
	sh scripts/with-bun.sh install --frozen-lockfile
	sh scripts/with-bun.sh run build
	# a release tag has a checked Rust PTY host; a branch has none, and terminals use Node from PATH
	if ! sh scripts/with-bun.sh scripts/pty-sidecar.ts install; then
		if command -v cargo >/dev/null; then
			cargo build --quiet --release --manifest-path crates/pty-sidecar/Cargo.toml
		else
			say "no Rust PTY host for $ref and no cargo: terminals run on Node if it is on PATH, else they are mirrored"
		fi
	fi
	# packages ship files that their group or anyone may write; here nobody but this user may
	chmod -R go-w "$checkout"
	owned
	settings
	say "ready. The unit for root to install:"
	unit
}

# A pairing code for one phone. The token is read here and handed to curl on its standard input,
# so it is on no command line and in no output; only the code and its end are printed.
pair() {
	[ -f "$config/env" ] || die "no settings in $config/env: run prepare first"
	alone "$config/env"
	grep -Eq '^OVIS_TOKEN=.{32,}$' "$config/env" || die "no OVIS_TOKEN of 32 characters or more in $config/env: run prepare first"
	at=$(sed -n 's/^PORT=//p' "$config/env" | tail -n 1)
	answer=$(
		token=$(sed -n 's/^OVIS_TOKEN=//p' "$config/env" | tail -n 1)
		printf 'header = "Authorization: Bearer %s"\n' "$token" |
			curl -sS --max-time 10 -K - -X POST -H 'x-herdr-machine: 1' -H 'content-type: application/json' --data '{}' "http://127.0.0.1:${at:-$port}/api/devices/pair/start"
	) || die "Ovis did not answer on port ${at:-$port}: is the service running? (systemctl status ovis-rod)"
	printf '%s' "$answer" | python3 -c '
import json, sys
from datetime import datetime
try:
    answer = json.load(sys.stdin)
except ValueError:
    sys.exit("rod linux-host: Ovis gave no pairing code")
code = answer.get("code")
if not isinstance(code, str) or len(code) != 6 or not code.isdigit():
    error = answer.get("error") or {}
    sys.exit("rod linux-host: no pairing code: %s" % (error.get("message") or error.get("code") or "unexpected answer"))
until = datetime.fromisoformat(answer["expires_at"].replace("Z", "+00:00")).astimezone()
print("Pairing code: %s %s" % (code[:3], code[3:]))
print("Type it in the Ovis app on the phone before %s. It works once." % until.strftime("%H:%M %Z"))
'
}

# a copy another user can change is refused, though one written to skip this check would not be
alone "$(readlink -f "$0")"

case "${1:-}" in
	prepare) shift; prepare "$@" ;;
	unit) unit ;;
	status) curl -sS "http://127.0.0.1:$port/api/health"; echo ;;
	pair) pair ;;
	*) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
