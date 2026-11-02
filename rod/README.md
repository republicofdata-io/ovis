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
`OVIS_TAILSCALE_SERVE_ONLY=1`, `OVIS_TAILSCALE_HTTPS_PORT=443` and `OVIS_ROD_DESK_IDLE_SECONDS=300`. The app is published on the
tailnet with `tailscale serve --bg --https=443 http://127.0.0.1:7317`; `make prod-ovis` opens it.

## Our changes

| Change | Files | Since |
|---|---|---|
| This routine | `Makefile`, `rod/*`, one line in `CLAUDE.md` | v0.4.22 |
| Public-repository guards | `rod/public-check.sh`, `rod/hooks/pre-push`, `Makefile`, `CLAUDE.md` | v0.4.22 |
| Pod alert rule: pod engineers and designers join the mute list once; product managers and agents in no pod keep alerting | `shared/rod-pods.ts`, `server/rod-pod-mutes.ts`, 4 lines in `server/core/status.ts` | v0.4.22 |
| Alerts say what is needed: a finished turn quotes the first line of the agent's last message, a waiting prompt its question | `server/rod-alert-text.ts`, 4 lines in `server/push.ts`, 7 in `server/core/status.ts`, `export` on `readPrompt` in `server/prompt.ts` | v0.4.22 |
| No alerts while at the Mac: a herdr window open and input within `OVIS_ROD_DESK_IDLE_SECONDS` (300 on the Mac; off when unset) counts as in use | `server/rod-desk.ts`, 5 lines in `server/core/status.ts` | v0.4.22 |
