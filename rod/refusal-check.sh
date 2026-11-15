#!/bin/sh
# Tries, as whoever runs it, to get into an Ovis server that must refuse them, and fails if any
# request gets in. Run it as another user of the machine Ovis runs on (an agent's user), against
# each address that reaches the server: its loopback port and its tailscale serve address.
#
#   rod/refusal-check.sh http://127.0.0.1:7317 https://<this machine's tailnet name>
#
# Every try must be refused: 401 from Ovis's access check, or the connection refused or reset (a
# firewall rule on the port). Anything else fails: a 403 comes after the access check let the
# request in, and a name that does not resolve, a TLS error or a timeout tested nothing. It holds
# no token and redeems no pairing code, so it changes nothing on the server but one wrong-token try
# per address. Health answers anyone: it is read to show the server is up and asks for a token.
set -u

[ "$#" -gt 0 ] || { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
command -v curl >/dev/null || { echo "refusal-check: curl is not on PATH" >&2; exit 2; }

failed=0
pane=w1:p1
# what tailscale serve would state for this machine's owner, read here so the forgery is the real one
status=$(tailscale status --json 2>/dev/null) || status=""
field() { printf '%s' "$status" | python3 -c "import json,sys; d=json.load(sys.stdin); s=d['Self']; print($1)" 2>/dev/null; }
login=$(field 'd["User"][str(s["UserID"])]["LoginName"]')
node=$(field 's["DNSName"].rstrip(".")')
address=$(field 's["TailscaleIPs"][0]')
# a forgery of some other login would pass for the wrong reason
[ -n "$login" ] && [ -n "$node" ] || { echo "refusal-check: could not read this machine's Tailscale login and name (tailscale status --json, python3); nothing tested" >&2; exit 2; }

# $1 what is tried, then curl's own arguments. Any answer but 401 got past the access check (a
# 101 holds the stream open until the time limit, and still counts); no answer is a refusal only
# when curl says the connection was refused or reset (exit 7).
try() {
	what=$1; shift
	code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null)
	rc=$?
	case "$code" in
		401) echo "refused  401  $what" ;;
		""|000)
			if [ "$rc" = 7 ]; then echo "refused  no connection  $what"
			else echo "UNTESTED curl exit $rc  $what"; failed=1; fi ;;
		*) echo "LET IN   $code  $what"; failed=1 ;;
	esac
}

# a POST as a command-line client sends it: x-herdr-machine passes the browser-origin check, so
# only the access check is left to refuse it
post() { what=$1 url=$2 body=$3; shift 3; try "$what" -X POST -H "content-type: application/json" -H "x-herdr-machine: 1" --data "$body" "$@" "$url"; }

# the headers tailscale serve adds, as curl config lines for -K - (so a value with spaces stays whole)
# (a file, not a pipe: a pipe would run try in a subshell and lose what it found)
forged=$(mktemp)
trap 'rm -f "$forged"' EXIT
printf 'header = "%s"\n' "tailscale-user-login: $login" "x-forwarded-for: 100.100.100.100" "x-forwarded-proto: https" "host: $node" >"$forged"

for base in "$@"; do
	base=${base%/}
	echo "== $base, as $(id -un)"
	health=$(curl -sS --max-time 10 "$base/api/health?scope=bridge" 2>/dev/null)
	rc=$?
	case "$rc:$health" in
		0:*'"required":true'*) echo "health   up, asks for a token" ;;
		7:*) echo "health   connection refused: a firewall rule, or nothing listening (check the server is up as its owner)" ;;
		0:*) echo "TOKEN?   the server does not say it asks for a token: $(printf '%s' "$health" | head -c 200)"; failed=1 ;;
		*) echo "UNTESTED curl exit $rc reaching $base: check the address"; failed=1 ;;
	esac
	try "read the panes" "$base/api/session"
	try "read a pane's screen" "$base/api/pane/read?pane_id=$pane"
	try "read the remote PCs' events" "$base/api/machines/events"
	try "read the bridge" "$base/api/bridge"
	try "list the paired devices" "$base/api/devices"
	try "open the live terminal stream" -H "connection: Upgrade" -H "upgrade: websocket" -H "sec-websocket-version: 13" -H "sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==" "$base/ws"
	post "send a line to a pane" "$base/api/pane/input" "{\"pane_id\":\"$pane\",\"text\":\"x\"}"
	post "send keys to a pane" "$base/api/pane/keys" "{\"pane_id\":\"$pane\",\"keys\":[\"Enter\"]}"
	post "answer a pane's prompt" "$base/api/pane/prompt/answer" "{\"pane_id\":\"$pane\",\"answer\":1}"
	post "start pairing a new device" "$base/api/devices/pair/start" '{}'
	post "turn the relay on" "$base/api/relay" '{"enabled":true}'
	post "start a public address" "$base/api/portal/start" '{}'
	try "a wrong token, once" -H "authorization: Bearer $(printf '0%.0s' $(seq 64))" "$base/api/session"
	# what tailscale serve states, written by hand: any process on this machine can send it
	try "a forged Tailscale login" -K "$forged" "$base/api/session"
	post "a forged Tailscale login, sending a line" "$base/api/pane/input" "{\"pane_id\":\"$pane\",\"text\":\"x\"}" -K "$forged"
	try "a forged forward with no login" -H "x-forwarded-for: 100.100.100.100" -H "x-forwarded-proto: https" -H "host: $node" "$base/api/session"
done

# the server listens on loopback only: its port on the tailnet address must not answer at all
if [ -n "$address" ]; then
	port=$(printf '%s\n' "$@" | sed -n 's#^http://127\.0\.0\.1:\([0-9]*\).*#\1#p' | head -n 1)
	if [ -n "$port" ]; then
		curl -sS -o /dev/null --max-time 5 "http://$address:$port/api/health" 2>/dev/null
		case $? in
			0|22) echo "LET IN   the tailnet address answers on port $port"; failed=1 ;;
			7) echo "refused  no connection  port $port on the tailnet address" ;;
			*) echo "UNTESTED port $port on the tailnet address"; failed=1 ;;
		esac
	fi
fi

if [ "$failed" = 0 ]; then echo "refusal-check: every try was refused"; else echo "refusal-check: a request got in, or a try could not be made" >&2; fi
exit "$failed"
