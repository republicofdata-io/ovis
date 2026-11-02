# RoD fork of Ovis: keep the rod branch current with official releases and install it.
# See rod/README.md. Run bare `make` for the menu.

.DEFAULT_GOAL := help
.PHONY: help status sync sync-finish install check hooks public-check prod-ovis

help: ## Show this menu
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  %-12s %s\n", $$1, $$2}'

status: ## Show rod, the newest official release, and what this Mac runs
	@git fetch --quiet upstream && git fetch --quiet origin
	@latest=$$(git tag -l 'upstream/v*' | sed 's#^upstream/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$$' | sort -V | tail -n 1); \
	echo "rod:              $$(git rev-parse --short origin/rod)  $$(git log -1 --format=%s origin/rod)"; \
	if git merge-base --is-ancestor "upstream/$$latest" origin/rod; then echo "official release: $$latest (in rod)"; \
	else echo "official release: $$latest (NOT in rod: run make sync)"; fi
	@herdr plugin list --plugin devswha.ovis --json 2>/dev/null | python3 -c 'import json,sys; p=json.load(sys.stdin)["result"]["plugins"][0]; s=p["source"]; print("installed:        " + p["version"] + " from " + s["owner"] + "/" + s["repo"] + " at " + s["requested_ref"] + " (" + s["resolved_commit"][:8] + ")")' || echo "installed:        none"

sync: ## Merge the newest official release into rod, check, push (VERSION=vX.Y.Z for another)
	@sh rod/sync.sh $(VERSION)

sync-finish: ## After fixing sync conflicts and committing: test and push rod
	@sh rod/sync.sh --finish

install: ## Reinstall Ovis on this Mac from the fork (REF=branch to try a pull request)
	@sh rod/install.sh $(or $(REF),rod)

check: ## Type-check, build, run the convention tests and the tests of our changes
	@sh rod/check.sh

hooks: ## Turn on the pre-push check of this clone (private names, secrets)
	@git config core.hooksPath rod/hooks && echo "pre-push check on (rod/hooks/pre-push)"

public-check: ## Check our commits not yet on origin/rod for private names and secrets
	@sh rod/public-check.sh

prod-ovis: ## Open this Mac's Ovis address in the browser
	@open "https://$$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
