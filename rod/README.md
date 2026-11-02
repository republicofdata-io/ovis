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
make sync      # merge the newest official release into rod, type-check, unit-test, push
make install   # reinstall Ovis on this Mac from rod, keeping settings and phone alerts
```

`make sync VERSION=v0.4.25` takes a given release. When the merge conflicts, `make sync` stops:
resolve, `git commit`, then `make sync-finish`. Merge official releases, not their `main`,
which changes many times a day.

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
```

## Installed settings

The plugin's settings live in the `env` file of `herdr plugin config-dir devswha.ovis`; on the
Mac: usage counts off (`OVIS_TELEMETRY=0`, `DO_NOT_TRACK=1`), `OVIS_AUTO_UPDATE=0`,
`OVIS_TAILSCALE_SERVE_ONLY=1` and `OVIS_TAILSCALE_HTTPS_PORT=443`. The app is published on the
tailnet with `tailscale serve --bg --https=443 http://127.0.0.1:7317`; `make prod-ovis` opens it.

## Our changes

| Change | Files | Since |
|---|---|---|
| This routine: `Makefile`, `rod/` | `Makefile`, `rod/*`, one line in `CLAUDE.md` | v0.4.22 |
