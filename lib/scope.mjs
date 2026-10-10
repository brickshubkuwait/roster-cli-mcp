// brello scope "<client>" --month YYYY-MM
// Contracted vs shot vs delivered vs approved for one client in one month.
// Pure helpers: argument parsing and the rows the table view prints. The
// gateway does every count; nothing here derives a number.

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** rest = argv after "scope". Returns { client, month, json } or { error }. */
export function parseScopeArgs(rest) {
  const words = []
  let month = null
  let json = false
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--json') { json = true; continue }
    if (a === '--month') { month = rest[i + 1] ?? ''; i++; continue }
    if (a.startsWith('--month=')) { month = a.slice('--month='.length); continue }
    if (a.startsWith('--')) continue
    words.push(a)
  }
  const client = words.join(' ').trim()
  if (!client) return { error: 'Add a client name, e.g.   brello scope "Sedra" --month 2026-10' }
  if (month !== null && !MONTH_RE.test(month.trim())) return { error: `--month takes YYYY-MM, e.g.   brello scope "${client}" --month 2026-10` }
  return { client, month: month === null ? null : month.trim(), json }
}

const show = (v) => (v === null || v === undefined ? '?' : String(v))

/** One table row per deliverable type. `?` marks an unknown number (see notes). */
export function deliverableRows(entry) {
  return (entry?.deliverables || []).map(d => ({
    type: d.type,
    contracted: show(d.contracted),
    shot: show(d.shot),
    delivered: d.type === 'sessions' ? 'n/a' : show(d.delivered),
    approved: d.type === 'sessions' ? 'n/a' : show(d.approved),
    cards: d.type === 'sessions' ? '' : `${d.delivered_cards ?? 0} sent, ${d.approved_cards ?? 0} ok`,
  }))
}

export function valueText(v) {
  if (!v || typeof v !== 'object') return ''
  return Object.entries(v).map(([k, n]) => `${n} ${k}`).join(', ')
}

export function extraRows(extras) {
  return (extras || []).map(x => ({ request: x.what || '', status: x.status || '', value: valueText(x.value) }))
}

/** The heading line for one contract entry, plain text. */
export function entryHeading(entry) {
  const p = entry?.period || {}
  const span = p.months && p.months.length ? p.months.join(', ') : [p.from, p.to].filter(Boolean).join(' to ')
  const bits = [entry?.contract_type || 'unknown type', entry?.frequency, entry?.status, span && `period ${span}`, p.salesforce_invoice].filter(Boolean)
  return { title: entry?.contract || entry?.opportunity_id || 'Contract', sub: bits.join(' · ') }
}
