// Local help shared by the CLI and MCP. No key or network call required.
export const DOCS_URL = 'https://roster.bricks.com.kw/developers'
export const KEYS_URL = 'https://roster.bricks.com.kw/connect'
export const KEY_GUIDE = [
  'Get access: run brello auth and sign in with your Bricks Google account. Yousef approves, your terminal is connected. He picks your team or the whole board, for up to 90 days.',
  'Waiting: keep the terminal open until Yousef approves. If you closed it, run brello auth again within 24 hours of the approval. Connecting needs a sign in within the last 10 minutes.',
  'Keys from Yousef: type it at the brello auth prompt, or pbpaste | brello login. Do not pass a key as a command argument.',
  'Permissions: keys see your team’s cards, or the whole board when the key has it. Write actions need individual approval. Assignments stay within your team. Archive is unavailable.',
  'Limits: self-service keys share 60 requests/minute and 5,000/rolling day across CLI and MCP. Administrator-issued keys allow 180/minute.',
  'Renew: keys last up to 90 days. Use Renew in My keys when available, then run brello auth. Connecting a new terminal revokes the old key.',
  'Lost key: revoke it in My keys, then run brello auth again. brello logout only removes this device’s saved copy.',
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
