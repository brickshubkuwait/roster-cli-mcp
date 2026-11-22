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

- `npm test` needs a valid key saved by `brello auth` (`~/.roster/token`). Keys come
  from `brello auth` (an admin approves); never paste a key into a config file or doc.
- Counts change daily — assert invariants (board >= team), never fixed numbers.

## Ecosystem map (added 22 Nov 2026)

- Thin client. Every `roster_*` call goes to the `roster-query` edge function in `brickshubkuwait/bricks-roster` (Supabase `sfmdwoxlyvajiutdmqok`, shared with Bakora); `studio_*` tools go to Bricks Studio `/api/agent` routes with the caller's key. The hosted twin is the `roster-mcp` edge function (claude.ai custom connector).
- Keys: `brello auth` signs in at `roster.bricks.com.kw/connect`; an admin approves at `/admin/keys`; keys live in `roster_tokens` with depts, capabilities and exclusions.
- No CI. `npm publish` is the release; a push to `main` deploys nothing.
- Pointer: see `~/Documents/GitHub/ECOSYSTEM.md` and `~/Documents/GitHub/ecosystem-kb/roster-brello.md`.

## Ecosystem (added 22 Nov 2026)

This repo is public. Keep internal architecture notes in the private bricks-roster `CLAUDE.md` (section "Ecosystem"), not here. Public facts only: the CLI and MCP call the `roster-query` endpoint and, for `brello studio`, Bricks Studio's agent routes, with the key from `brello auth`. Cross-repo map for maintainers: `~/Documents/GitHub/ECOSYSTEM.md` on the maintainer's machine.
