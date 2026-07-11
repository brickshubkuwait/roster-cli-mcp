# CLAUDE.md — brello CLI + MCP

Public npm package `brello` (CLI `brello`/`roster`, MCP server `brello-mcp` with
`roster_*` tools) over the `roster-query` edge fn in the private bricks-roster
repo. Backend changes happen THERE; this repo is the client.

## RELEASE CHECKLIST — every user-visible change, no exceptions

1. **Changelog** — prepend an entry to `lib/changelog.mjs` and bump
   `package.json` to the same version. `VERSION` is derived from the newest
   entry and feeds the MCP server version — they cannot drift, don't try.
2. **Developers page** — update the command reference in
   `bricks-roster/src/pages/DevelopersPage.jsx` (GROUPS arrays: command, desc,
   sample output) and deploy the roster frontend (deploy command in
   bricks-roster/CLAUDE.md). New command → new row; changed behavior/flags →
   fix the row; removed → delete the row.
3. **Test** — `npm test` (acceptance.mjs drives the real MCP over stdio against
   the live edge fn; it asserts changelog version == package version, so
   skipping step 1 fails the suite).
4. **Publish** — `npm publish` with the keychain token:
   `--userconfig` a temp npmrc containing
   `//registry.npmjs.org/:_authToken=$(security find-generic-password -s npm-publish-token -w)`,
   delete the temp file after. Verify with `npm view brello version`.
5. **Commit + push** (origin main).

## Copy rules (public package + public page)

- Never describe the tool as "read-only", "scoped", "audited", or mention the
  privacy fence in public copy — Yousef's standing rule. "your team" / "the
  whole board" is the approved vocabulary.
- `gen-token.mjs` lives ONLY in bricks-roster/roster-mcp/ (private). Never add
  token-minting code or admin docs to this repo.

## Testing

- `npm test` needs a valid token in `~/.roster/token` (or BRELLO_TOKEN).
- Counts change daily — assert invariants (board >= team), never fixed numbers.
