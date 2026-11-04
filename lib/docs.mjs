// Local help shared by the CLI and MCP. No key or network call required.
export const DOCS_URL = 'https://roster.bricks.com.kw/developers'
export const KEYS_URL = 'https://roster.bricks.com.kw/connect'
export const KEY_GUIDE = [
  'Get access: ask at roster.bricks.com.kw/connect. Yousef approves it and picks your team or the whole board, for up to 90 days.',
  'Claim: reveal an approved key within 24 hours. A sign-in within the last 10 minutes is required. The key is shown once.',
  'Sign in: run brello auth and paste at the masked prompt. Do not pass the key as a command argument.',
  'Permissions: keys see your team’s cards, or the whole board when the key has it. Write actions need individual approval. Assignments stay within your team. Archive is unavailable.',
  'Limits: self-service keys share 60 requests/minute and 5,000/rolling day across CLI and MCP. Administrator-issued keys allow 180/minute.',
  'Renew: keys last up to 90 days. Use Renew in My keys when available, or request a replacement. Revealing a renewal revokes the old key. Run brello auth on every device with the replacement.',
  'Lost key: revoke it in My keys, then request another. brello logout only removes this device’s saved copy.',
  'Paused key: check My keys and ask Yousef to review it. Repeated retries do not restore access.',
]
export const developerGuide = () => ({
  docs: DOCS_URL,
  keys: KEYS_URL,
  setup: `${DOCS_URL}#quickstart`,
  commands: `${DOCS_URL}#reference`,
  troubleshooting: `${DOCS_URL}#troubleshooting`,
  key_help: KEY_GUIDE,
})
