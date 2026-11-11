// Bricks Studio from the same key: brello studio <command> and the studio_* MCP tools.
// Talks to Studio's /api/agent/* routes with the key brello auth saved. Studio
// checks the key with Roster and answers as the key owner's own Studio login.
import * as fs from 'node:fs'
import { Blob } from 'node:buffer'
import { basename, extname } from 'node:path'
import { getToken, queueNotice } from './client.mjs'
import { VERSION } from './changelog.mjs'

export const DEFAULT_STUDIO_URL = 'https://studio.bricks.com.kw'
export const studioBase = () => String(process.env.STUDIO_URL || DEFAULT_STUDIO_URL).replace(/\/+$/, '')

// What each Studio permission on a key allows, as Roster and Studio name it.
export const CAPABILITY_LABELS = {
  studio_comment: 'post team comments',
  studio_upload: 'upload a new version',
  studio_status: 'change the internal status',
  studio_plan: 'edit plans',
}

const clean = (s, max = 500) => String(s ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const enc = (s) => encodeURIComponent(String(s ?? '').trim())

const CODE_MESSAGES = {
  no_studio_user: "Your key's Slack identity has no Studio account. Ask a Studio admin to link your Slack account to your Studio login",
  access_scope: 'Your Studio access does not include this',
  read_only: 'Your Studio account is view only, so it cannot make changes here',
}

function studioError(res, j) {
  const server = j && typeof j.error === 'string' ? clean(j.error) : ''
  const code = j && typeof j.code === 'string' && /^[A-Za-z][A-Za-z_]{1,40}$/.test(j.code) ? j.code : null
  let msg = server
  if (code === 'capability_required') {
    const label = CAPABILITY_LABELS[j.capability]
    msg = label
      ? `Your key does not have the Studio permission to ${label}. Ask an admin for "Studio: ${label}" on your key.`
      : `${server || 'Your key does not have that Studio permission'}. Ask an admin to add it to your key.`
  } else if (code && CODE_MESSAGES[code]) {
    msg = CODE_MESSAGES[code]
  }
  if (!msg) msg = !j && res.status === 404 ? 'Bricks Studio does not answer this request yet (HTTP 404)' : `Bricks Studio answered HTTP ${res.status}${j ? '' : ' (non-JSON response)'}`
  const err = new Error(msg)
  err.status = res.status
  err.serverMessage = msg
  err.code = code
  err.hint = ''
  err.retryAfter = res.headers?.get?.('retry-after') || null
  return err
}

/**
 * One request to Studio's agent API.
 * query: only defined, non-empty values are sent. body: JSON. form: FormData.
 * csv: return the response text when the request succeeds.
 */
export async function callStudio(method, path, { query, body, form, csv } = {}) {
  const token = getToken()
  if (!token) throw new Error('NO_TOKEN')
  const url = new URL(studioBase() + path)
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue
    url.searchParams.set(k, String(v))
  }
  const headers = { Authorization: `Bearer ${token}`, Accept: csv ? 'text/csv, application/json' : 'application/json', 'User-Agent': `brello/${VERSION}` }
  const init = { method, headers }
  if (form) init.body = form
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body) }
  let res
  try {
    res = await fetch(url, init)
  } catch {
    const err = new Error(`Could not reach Bricks Studio at ${url.host}. Check your internet and try again.`)
    err.network = true
    throw err
  }
  const notice = res.headers?.get?.('x-studio-notice')
  if (notice) queueNotice(notice)
  const text = await res.text().catch(() => '')
  if (csv && res.ok && !/json/i.test(res.headers.get('content-type') || '')) return text
  let j = null
  try { j = text ? JSON.parse(text) : null } catch { j = null }
  if (!res.ok || !j || j.ok === false) throw studioError(res, j)
  return j
}

// ── uploads: images go as multipart, videos go presign, PUT, then register ──
export const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' }
export const VIDEO_TYPES = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }
const MAX_FILES = 30

/** Sorts local paths into one upload kind. Throws on a missing file, an unknown type or a mix. */
export function classifyFiles(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).map(p => String(p ?? '').trim()).filter(Boolean)
  if (!list.length) throw new Error('Add at least one file to upload')
  if (list.length > MAX_FILES) throw new Error(`Up to ${MAX_FILES} files go in one version`)
  const files = list.map(path => {
    const ext = extname(path).slice(1).toLowerCase()
    const kind = IMAGE_TYPES[ext] ? 'image' : VIDEO_TYPES[ext] ? 'video' : null
    if (!kind) throw new Error(`${basename(path)} is not an image (jpg, png, webp, gif, heic) or a video (mp4, mov, webm)`)
    let st
    try { st = fs.statSync(path) } catch { throw new Error(`No file at ${path}`) }
    if (!st.isFile()) throw new Error(`${path} is not a file`)
    return { path, name: basename(path), kind, mime: IMAGE_TYPES[ext] || VIDEO_TYPES[ext], size: st.size }
  })
  const kinds = new Set(files.map(f => f.kind))
  if (kinds.size > 1) throw new Error('Upload images and videos in separate versions, not in one call')
  return { kind: files[0].kind, files }
}

async function putFile(uploadUrl, f) {
  const body = typeof fs.openAsBlob === 'function' ? await fs.openAsBlob(f.path, { type: f.mime }) : fs.readFileSync(f.path)
  let res
  try {
    res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': f.mime }, body })
  } catch {
    throw new Error(`Could not send ${f.name} to storage. Check your internet and try again.`)
  }
  if (!res.ok) throw new Error(`Storage refused ${f.name} (HTTP ${res.status}). Run the upload again.`)
}

/** Adds a new version to a submission from local files. The version starts hidden from the client. */
export async function uploadVersion(ref, filePaths, { optionLabel, parentVersionId } = {}) {
  const id = String(ref ?? '').trim()
  if (!id) throw new Error('Add the submission id')
  const { kind, files } = classifyFiles(filePaths)
  const base = `/api/agent/submissions/${enc(id)}/versions`
  if (kind === 'image') {
    const form = new FormData()
    for (const f of files) form.append('files', new Blob([fs.readFileSync(f.path)], { type: f.mime }), f.name)
    if (optionLabel) form.append('optionLabel', optionLabel)
    if (parentVersionId) form.append('parentVersionId', parentVersionId)
    return callStudio('POST', base, { form })
  }
  const uploaded = []
  for (const f of files) {
    const p = await callStudio('POST', `${base}/presign`, { body: { fileName: f.name, contentType: f.mime, fileSize: f.size, ...(parentVersionId ? { parentVersionId } : {}) } })
    if (!p || typeof p.uploadUrl !== 'string' || typeof p.key !== 'string') throw new Error('Studio did not return an upload address. Try again.')
    await putFile(p.uploadUrl, f)
    uploaded.push({ key: p.key, fileName: f.name, mimeType: f.mime, fileSize: f.size })
  }
  return callStudio('POST', base, { body: { files: uploaded, ...(optionLabel ? { optionLabel } : {}), ...(parentVersionId ? { parentVersionId } : {}) } })
}

// ── brello studio <command>: argument parsing, pure ──
export const PLAN_FIELDS = ['name', 'status', 'shootDate', 'shootLocation', 'shootDuration', 'clientBrief']
const PLAN_FIELD_BY_KEY = Object.fromEntries(PLAN_FIELDS.map(f => [f.toLowerCase(), f]))
export const STATUS_ACTIONS = ['approve', 'changes', 'clear']

const SPEC = {
  whoami:      { values: [], bools: [] },
  submissions: { values: ['client', 'status', 'type', 'limit', 'offset'], bools: ['mine'] },
  submission:  { values: [], bools: [] },
  comments:    { values: ['version'], bools: ['csv'] },
  comment:     { values: ['at', 'version', 'file'], bools: [] },
  upload:      { values: ['label', 'option-of'], bools: [] },
  status:      { values: ['note', 'version-id'], bools: [] },
  plans:       { values: ['client', 'status', 'limit', 'offset'], bools: ['mine'] },
  plan:        { values: ['include', 'limit'], bools: [], multi: ['set'] },
  clients:     { values: [], bools: ['all'] },
  items:       { values: [], bools: ['plans'] },
}
export const STUDIO_SUBS = new Set(Object.keys(SPEC))

// studio plan --include: which heavy sections to add. The plan read leaves
// activity and history out by default and says so in omitted/omittedNote.
export const PLAN_INCLUDE = ['activity', 'history']
export function planInclude(v) {
  const raw = String(v ?? '').trim().toLowerCase()
  if (!raw || raw === 'none') return { include: undefined }
  if (raw === 'all') return { include: 'all' }
  const parts = raw.split(/[,\s]+/).filter(Boolean)
  const bad = parts.filter(x => !PLAN_INCLUDE.includes(x))
  if (bad.length) return { error: `--include takes ${PLAN_INCLUDE.join(', ')}, all or none, e.g.   brello studio plan 9f2c41aa --include activity,history` }
  return { include: [...new Set(parts)].join(',') }
}

const wholeNumber = (flag, v, min, sub) => {
  const n = Number(String(v).trim())
  if (!Number.isInteger(n) || n < min) return { error: `--${flag} takes a whole number, e.g.   brello studio ${sub} --${flag} ${min === 0 ? 50 : 2}` }
  return { n }
}

/** rest = argv after "studio" (first item is the command). Returns a request plan or { error }. */
export function parseStudioArgs(rest) {
  const sub = rest[0]
  const spec = SPEC[sub]
  if (!spec) return { error: `Unknown Studio command "${sub}". Run  brello help studio` }
  const opts = {}
  const multi = {}
  const words = []
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]
    if (!a.startsWith('--')) { words.push(a); continue }
    const eq = a.indexOf('=')
    const name = a.slice(2, eq === -1 ? undefined : eq)
    const inline = eq === -1 ? undefined : a.slice(eq + 1)
    if (spec.bools.includes(name)) { opts[name] = true; continue }
    if (spec.values.includes(name) || spec.multi?.includes(name)) {
      let v = inline
      if (v === undefined) {
        const next = rest[i + 1]
        if (next === undefined || next.startsWith('--')) return { error: `--${name} needs a value. Run  brello help studio` }
        v = next
        i++
      }
      if (spec.multi?.includes(name)) (multi[name] ||= []).push(v)
      else opts[name] = v
      continue
    }
    return { error: `brello studio ${sub} does not take --${name}. Run  brello help studio` }
  }
  const id = (words[0] || '').trim()
  const needId = (example) => (id ? null : { error: `Add the id, e.g.   brello studio ${example}` })
  const num = {}
  for (const k of ['limit', 'offset', 'version']) {
    if (opts[k] === undefined) continue
    const r = wholeNumber(k, opts[k], k === 'offset' ? 0 : 1, sub)
    if (r.error) return r
    num[k] = r.n
  }
  const q = words.join(' ').trim()

  switch (sub) {
    case 'whoami':
      return { sub, method: 'GET', path: '/api/agent/whoami' }
    case 'submissions':
      return { sub, method: 'GET', path: '/api/agent/submissions', query: { q, client: opts.client, status: opts.status && opts.status.trim().toUpperCase(), type: opts.type && opts.type.trim().toUpperCase(), scope: opts.mine ? 'mine' : undefined, limit: num.limit, offset: num.offset } }
    case 'submission':
      return needId('submission 1c11685c') || { sub, method: 'GET', path: `/api/agent/submissions/${enc(id)}` }
    case 'comments':
      return needId('comments 1c11685c --csv > comments.csv') || { sub, method: 'GET', path: `/api/agent/submissions/${enc(id)}/comments`, query: { format: opts.csv ? 'csv' : undefined, version: num.version }, csv: !!opts.csv }
    case 'comment': {
      const missing = needId('comment 1c11685c "logo is too small" --at 0:42')
      if (missing) return missing
      const text = words.slice(1).join(' ').trim()
      if (!text) return { error: 'Add the comment text, e.g.   brello studio comment 1c11685c "logo is too small" --at 0:42' }
      const body = { body: text }
      if (opts.at !== undefined) body.timecode = opts.at.trim()
      if (num.version !== undefined) body.version = num.version
      if (opts.file) body.fileId = opts.file.trim()
      return { sub, method: 'POST', path: `/api/agent/submissions/${enc(id)}/comments`, body }
    }
    case 'upload': {
      const missing = needId('upload 1c11685c ./final.mp4')
      if (missing) return missing
      const files = words.slice(1)
      if (!files.length) return { error: 'Add the files to upload, e.g.   brello studio upload 1c11685c ./cover.jpg ./slide2.jpg' }
      return { sub, upload: true, ref: id, files, optionLabel: opts.label?.trim() || undefined, parentVersionId: opts['option-of']?.trim() || undefined }
    }
    case 'status': {
      const missing = needId('status 1c11685c approve')
      if (missing) return missing
      const action = (words[1] || '').trim().toLowerCase()
      if (!STATUS_ACTIONS.includes(action)) return { error: 'Say approve, changes or clear, e.g.   brello studio status 1c11685c changes --note "tighten the intro"' }
      const body = { action }
      if (opts.note !== undefined) body.note = opts.note
      if (opts['version-id']) body.versionId = opts['version-id'].trim()
      return { sub, method: 'POST', path: `/api/agent/submissions/${enc(id)}/status`, body }
    }
    case 'plans': {
      const status = opts.status && opts.status.trim().toUpperCase()
      if (status && status !== 'DRAFT' && status !== 'READY') return { error: '--status takes DRAFT or READY' }
      return { sub, method: 'GET', path: '/api/agent/plans', query: { q, client: opts.client, status, scope: opts.mine ? 'mine' : undefined, limit: num.limit, offset: num.offset } }
    }
    case 'plan': {
      const missing = needId('plan 9f2c41aa --set status=READY')
      if (missing) return missing
      if (words.length > 1) return { error: 'Change fields with --set, e.g.   brello studio plan 9f2c41aa --set name="Eid shoot"' }
      const sets = multi.set || []
      const inc = planInclude(opts.include)
      if (inc.error) return inc
      if (!sets.length) return { sub, method: 'GET', path: `/api/agent/plans/${enc(id)}`, query: { include: inc.include, limit: num.limit } }
      if (opts.include !== undefined || opts.limit !== undefined) return { error: '--include and --limit read a plan; they do not go with --set' }
      const body = {}
      for (const s of sets) {
        const eq = s.indexOf('=')
        const key = eq === -1 ? '' : s.slice(0, eq).trim().replace(/[-_\s]/g, '').toLowerCase()
        const field = PLAN_FIELD_BY_KEY[key]
        if (!field) return { error: `--set takes field=value, where field is one of ${PLAN_FIELDS.join(', ')}` }
        body[field] = s.slice(eq + 1)
      }
      return { sub, method: 'PATCH', path: `/api/agent/plans/${enc(id)}`, body }
    }
    case 'clients':
      return { sub, method: 'GET', path: '/api/agent/clients', query: { q, all: opts.all ? '1' : undefined } }
    case 'items': {
      if (!id) return { error: 'Add a client id or name, e.g.   brello studio items "Foodhall" chair --plans' }
      return { sub, method: 'GET', path: `/api/agent/clients/${enc(id)}/items`, query: { q: words.slice(1).join(' ').trim(), includePlans: opts.plans ? '1' : undefined } }
    }
  }
  return { error: `Unknown Studio command "${sub}"` }
}

/** Runs a plan from parseStudioArgs. */
export function runStudioRequest(p) {
  if (p.upload) return uploadVersion(p.ref, p.files, { optionLabel: p.optionLabel, parentVersionId: p.parentVersionId })
  return callStudio(p.method, p.path, { query: p.query, body: p.body, csv: p.csv })
}
