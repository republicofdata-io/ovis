# RoD fork of Ovis

This repository is Republic of Data's fork of [Ovis](https://github.com/devswha/ovis), the
browser and phone client for herdr. It adds what Olivier needs to run pods of coding agents
(composed by dispatch, a private tool) from an iPhone or iPad,
and otherwise follows the official releases.

## Branches and tags

- `rod` is the fork's default branch: the newest official release we took, plus our changes.
  Our changes reach it as pull requests from `feature/...` branches.
- `main` is left as GitHub forked it and is not used.
- Official release tags are fetched as `upstream/vX.Y.Z` (see "Setting up a clone") and never
  pushed here. Ovis's own update button installs the newest `vX.Y.Z` tag of the repository it
  was installed from, so an official tag pushed to the fork would replace our changes with the
  plain release. The fork keeps the tags it was created with (up to v0.4.22) and gets no newer
  ones, so the button never offers an update. Updates go through `make install`.

## Staying current

```sh
make status    # rod, the newest official release, and what this Mac runs
make sync      # merge the newest official release into rod, run make check, push
make install   # reinstall Ovis on this Mac from rod, keeping settings and phone alerts
```

`make sync VERSION=v0.4.25` takes a given release. When the merge conflicts, `make sync` stops:
resolve, `git commit`, then `make sync-finish`. Merge official releases, not their `main`,
which changes many times a day.

`make check` type-checks, builds, and runs the convention tests plus the test files listed in
`rod/tests.txt` (the tests of our changes). Ovis runs its full unit suite on Linux only; on a
Mac part of it hangs, so the routine does not run it.

To keep conflicts rare, our changes stay small and in few places, and each one is listed below
with the files it touches.

## Trying a pull request on this Mac

```sh
make install REF=feature/pod-alerts   # the branch, pushed to the fork
make install                          # back to rod
```

## Setting up a clone

```sh
git clone https://github.com/republicofdata-io/ovis.git && cd ovis
git remote add upstream https://github.com/devswha/ovis.git
git remote set-url --push upstream DISABLED
git config remote.upstream.tagOpt --no-tags
git config --add remote.upstream.fetch '+refs/tags/v*:refs/tags/upstream/v*'
make hooks   # the pre-push check; it also needs gitleaks and the private word list
```

## Public repository

The fork is public, so three guards keep private details out of it:

- **Rules for agents** in `CLAUDE.md`: no machine or tailnet names, private addresses, local
  paths, client, project or pod names, real transcripts or secrets, in files, commits, pull
  requests or screenshots. Examples use made-up pods.
- **A check before every push** (`rod/hooks/pre-push`, turned on with `make hooks` in each
  clone). It runs `rod/public-check.sh` on our new commits: their messages, file names and added
  lines are matched against a private word list and scanned by
  [gitleaks](https://github.com/gitleaks/gitleaks) (`brew install gitleaks`). Commits of official
  releases are left out. `make public-check` runs it by hand; `rod/public-check.sh --stdin <
  body.md` checks a pull request body before it is posted.
- **GitHub's secret scanning and push protection**, switched on for the repository.

The word list lives outside the repository, at `~/.config/rod/public-denylist.txt` (or
`$ROD_PUBLIC_DENYLIST`), because it names what it protects. One entry per line, case-insensitive;
a line starting with `re:` is a regular expression. Without the list the check refuses to run.



The plugin's settings live in the `env` file of `herdr plugin config-dir devswha.ovis`; on the
Mac: usage counts off (`OVIS_TELEMETRY=0`, `DO_NOT_TRACK=1`), `OVIS_AUTO_UPDATE=0`,
`OVIS_TAILSCALE_SERVE_ONLY=1`, `OVIS_TAILSCALE_HTTPS_PORT=443` and `OVIS_ROD_DESK_IDLE_SECONDS=300`. An app that runs away from the Mac adds `OVIS_ROD_DESK_SSH=<ssh target of the Mac>` so the desk check reads the Mac. The app is published on the
tailnet with `tailscale serve --bg --https=443 http://127.0.0.1:7317`; `make prod-ovis` opens it.

## Ovis on a Linux machine

So the phone reaches the agents' herdr with the Mac asleep or off, Ovis can also run on the
always-on Linux machine that runs them, as the user whose herdr it serves. Other users of that
machine (the agents' own user, for one) can reach any port on it, its tailnet address included,
and write any header, so listening on loopback or the tailnet is no fence. The fence is
`OVIS_TOKEN`: with it set, nothing gets in but a paired device or the token
(`server/rod-linux-host.test.ts` holds that against an official release that reorders the access
check).

1. **As that user**: `rod/linux-host.sh prepare` fetches `rod` into `~/.local/share/ovis-rod`,
   builds it, writes `~/.config/ovis-rod/env` (folder 700, file 600) with a new token, and prints
   the systemd unit. Run the script from a fresh clone at a reviewed commit, made with
   `umask 022` (the script refuses a copy its group can write), or later from
   `~/.local/share/ovis-rod` itself, never from a copy another user can write: it runs as this
   user. After the build it takes group and other write off the checkout, since some packages
   ship files anyone may write. It refuses a checkout, bun or herdr that another user can change, since the service runs
   them as this user. Nothing in the unit is secret; the token stays in the env file.
2. **As root**: install the unit as `/etc/systemd/system/ovis-rod.service` and enable it; it starts
   at boot, and refuses to start without a token. Publish it with
   `tailscale serve --bg --https=443 http://127.0.0.1:7317`. A firewall rule can add a second
   fence: on this machine, only that user and root (tailscaled) may connect to 443 and 7317
   (nftables, in an `output` chain:
   `oifname "lo" tcp dport { 443, 7317 } meta skuid != { "<that user>", "root" } reject with tcp reset`).
3. **The tailnet policy**: the phone may reach this machine on tcp 443, nothing else.
4. **Pair the phone**: as that user, from a terminal of your own (the Mac's Terminal over SSH,
   for one), run `sh ~/.local/share/ovis-rod/rod/linux-host.sh pair`. It reads the token inside
   the script and prints only a six-digit code and the time it ends, ten minutes on; the code
   works once. Keep the code out of agents' panes and chats. Open `https://<machine>/` on the
   phone, add it to the Home Screen, and type the six digits in that app (it keeps its own
   cookies). Turn alerts on there and off in the Mac's app, so each
   alert comes once.
5. **Check it**: as the agents' user, `rod/refusal-check.sh http://127.0.0.1:7317 https://<machine>`
   must print `every try was refused`. Only a 401 or a refused connection counts; any other
   answer, or a try that could not be made, fails it. When the firewall rule refuses every
   connection, the check cannot see the server: confirm it is up with `rod/linux-host.sh status`
   as its owner.

Never copy the Mac's env file or state folder: `OVIS_TAILSCALE_SERVE_ONLY` lets a serve request
with no login in as the owner when no token is set, `OVIS_ROD_DESK_SSH` would reach the Mac from
the machine, and the state folder holds the Mac's paired devices. To update, run
`rod/linux-host.sh prepare [ref]` again, then `systemctl restart ovis-rod` as root. When that user's
herdr is not running, the app says it cannot reach herdr and picks it up once herdr starts.

## Our changes

| Change | Files | Since |
|---|---|---|
| This routine | `Makefile`, `rod/*`, one line in `CLAUDE.md` | v0.4.22 |
| Public-repository guards | `rod/public-check.sh`, `rod/hooks/pre-push`, `Makefile`, `CLAUDE.md` | v0.4.22 |
| Alert rule: only the chief of staff's pane alerts (`rod-chief`, or the names in `OVIS_ROD_ALERT_AGENTS`); every other agent joins the mute list once and leaves it when its pane closes or changes hands, so new panes stay quiet. Until 2026-11-06 only pod engineers and designers were muted | `shared/rod-pods.ts`, `server/rod-pod-mutes.ts`, 4 lines in `server/core/status.ts` | v0.4.22 |
| Alerts say what is needed: a finished turn quotes the first line of the agent's last message, a waiting prompt its question | `server/rod-alert-text.ts`, 4 lines in `server/push.ts`, 7 in `server/core/status.ts`, `export` on `readPrompt` in `server/prompt.ts` | v0.4.22 |
| No alerts while at the Mac: a herdr window open and input within `OVIS_ROD_DESK_IDLE_SECONDS` (300 on the Mac; off when unset) counts as in use | `server/rod-desk.ts`, 5 lines in `server/core/status.ts` | v0.4.22 |
| Summary line over the terminal and the chat: state, time in it, what the agent is doing now; tap for the whole line | `server/rod-summary.ts`, `server/rod-readers.ts`, `src/components/RodSummary.tsx` + `.css`, 2 lines in `src/components/PaneTerminal.tsx`, 2 in `server/dispatch.ts`, 2 in `server/core/status.ts`, 2 in `site/demo/transport.ts` | v0.4.22 |
| Workspaces fold for a lone Host: an "All workspaces" heading folds the workspace list, kept per device | `src/components/RodWorkspacesToggle.tsx` + `.css`, 4 lines in `src/components/MachineSidebar.tsx`, one entry each in `src/lib/i18n.{ko,ja,zh}.ts` | v0.4.22 |
| Remote PCs: pod mutes, alert text and the summary line work for agents on remote PCs (snapshots and statuses from MachineManager, text from the bridge's own prompt and conversation routes); the desk check can read a Mac over SSH (`OVIS_ROD_DESK_SSH`) | `server/rod-readers.ts`, `server/rod-pod-mutes.ts`, `server/rod-summary.ts`, `server/rod-desk.ts`, `src/components/RodSummary.tsx`; 1 line in `server/push.ts`, 3 in `server/machines.ts` (the `rodRoster` hook, tested in `server/machines-refresh.test.ts`), 18 in `server/core/status.ts`, 1 in `server/dispatch.ts`, 1 in `src/components/PaneTerminal.tsx` | v0.4.22 |
| Ovis on a Linux machine: a setup script and systemd unit for running it as the herdr user's service behind `tailscale serve`, with `OVIS_TOKEN` keeping the machine's other users out; a contract test that the token comes first in the access check, and a live check that another user is refused | `rod/linux-host.sh`, `rod/refusal-check.sh`, `server/rod-linux-host.test.ts` | v0.4.22 |
