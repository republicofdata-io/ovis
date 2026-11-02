@AGENTS.md

RoD fork: read rod/README.md first (branches, syncing official releases, our changes). Keep our changes small and listed there.

This repository is public. Nothing private goes into files, commit messages, branch names, pull requests, issues or screenshots:
- no machine, tailnet or host names, Tailscale or other private addresses, local paths (`/Users/...`), emails or account names;
- no client, account, project or pod names from real work, and no real agent names or transcripts: tests and examples use made-up pods such as `demo-pm`, `demo-eng-2`;
- no secrets, tokens, keys or values from env files;
- screenshots only from Ovis's demo or a test session, never a live one.
Before `gh pr create` or `gh pr edit`, pass the body through `rod/public-check.sh --stdin`. The pre-push hook (`make hooks`) checks commits; never bypass it with `--no-verify`. When it flags a word, rewrite the commit; if the word is a false alarm, ask Olivier rather than editing the private list.
