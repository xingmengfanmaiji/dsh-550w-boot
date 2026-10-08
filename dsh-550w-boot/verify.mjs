/* ============================================================================
   verify.mjs — check the built bundle against the animation it claims to carry.

   RUN
     node verify.mjs

   What this catches, and why each one is worth a check:

     - the payload no longer matching the animation on disk, which is the normal
       consequence of editing the HTML and forgetting to rebuild;
     - a payload that does not survive parsing, which would leave a plugin that
       loads and then shows an empty frame;
     - an option key the browser half reads but the build no longer emits, which
       silently becomes `undefined` at runtime rather than an error.

   It deliberately does not attempt to render anything. test/harness-b.html does
   that in a real browser, with a controllable clock.
   ========================================================================== */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, 'lib', 'client.js')
const templatePath = join(here, 'lib', 'client.template.js')
const animationDir = join(here, 'animation')

const failures = []
const notes = []
const fail = (message) => failures.push(message)
const note = (message) => notes.push(message)

if (!existsSync(clientPath)) {
  console.error('verify: lib/client.js is missing — run: node build.mjs')
  process.exit(1)
}

const client = readFileSync(clientPath, 'utf8')

/* ---- 1. the payload decodes ---- */
const payloadLine = client.split(/\r?\n/).find((line) => line.includes('const ANIMATION ='))
if (!payloadLine) {
  fail('lib/client.js carries no ANIMATION payload')
}

let animation = null
if (payloadLine) {
  const json = payloadLine.slice(payloadLine.indexOf('const ANIMATION =') + 'const ANIMATION ='.length).trim().replace(/;$/, '')
  try {
    animation = JSON.parse(json)
  } catch (error) {
    fail('the ANIMATION payload is not parseable: ' + (error && error.message))
  }
}

/* ---- 2. it is byte-identical to an animation on disk ---- */
if (typeof animation === 'string') {
  note('payload decodes to ' + (Buffer.byteLength(animation, 'utf8') / 1024).toFixed(1) + ' KB')

  if (!/<html[\s>]/i.test(animation) || !/<\/html>/i.test(animation)) {
    fail('the decoded payload is not a complete HTML document')
  }

  const candidates = existsSync(animationDir)
    ? readdirSync(animationDir).filter((name) => /\.html?$/i.test(name))
    : []
  if (candidates.length === 0) {
    fail('animation/ holds no .html source to compare against')
  } else {
    const digest = (text) => createHash('sha256').update(text).digest('hex')
    const wanted = digest(animation)
    const match = candidates.find((name) => digest(readFileSync(join(animationDir, name), 'utf8')) === wanted)
    if (match) note('matches animation/' + match + ' (sha256:' + wanted.slice(0, 12) + ')')
    else fail('the payload matches none of: ' + candidates.join(', ') + ' — the animation was edited without rebuilding')
  }
}

/* ---- 3. substitutions are complete ---- */
for (const marker of ['__ANIMATION_JSON__', '__OPTIONS_JSON__', '__BUILD_JSON__']) {
  if (client.includes(marker)) fail('substitution marker ' + marker + ' is still in lib/client.js')
}

/* ---- 4. the options the browser half reads are all present ---- */
const optionsLine = client.split(/\r?\n/).find((line) => line.includes('const OPTIONS ='))
if (!optionsLine) {
  fail('lib/client.js carries no OPTIONS payload')
} else {
  const json = optionsLine.slice(optionsLine.indexOf('const OPTIONS =') + 'const OPTIONS ='.length).trim().replace(/;$/, '')
  let options = null
  try {
    options = JSON.parse(json)
  } catch (error) {
    fail('the OPTIONS payload is not parseable: ' + (error && error.message))
  }

  if (options) {
    const required = ['enabled', 'durationMs', 'fadeMs', 'hintDelayMs', 'hint', 'skipOnAnyKey', 'timerSlackMs']
    for (const key of required) {
      if (!(key in options)) fail('OPTIONS is missing "' + key + '", which the browser half reads')
    }

    /* The same key set the template actually references, so a new option cannot
     * be read by the browser half and never emitted by the build. */
    const template = readFileSync(templatePath, 'utf8')
    const referenced = new Set([...template.matchAll(/OPTIONS\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))
    for (const key of referenced) {
      if (!(key in options)) fail('the template reads OPTIONS.' + key + ', which the build does not emit')
    }
    if (options.durationMs <= options.fadeMs) {
      fail('durationMs must exceed fadeMs, or the animation would never be seen')
    }
    note('options: ' + options.durationMs + 'ms + ' + options.fadeMs + 'ms fade, skip on click'
      + (options.skipOnAnyKey ? '/key' : '') + ', timer slack ' + options.timerSlackMs + 'ms')
  }
}

/* ---- 5. the host half is loadable ---- */
const hostPath = join(here, 'lib', 'index.js')
if (!existsSync(hostPath)) {
  fail('lib/index.js (the host half) is missing')
} else {
  const host = await import('file://' + hostPath.replace(/\\/g, '/'))
  if (host.name !== 'boot550w') fail('the host half exports name "' + host.name + '", expected "boot550w"')
  if (typeof host.apply !== 'function') fail('the host half exports no apply()')
  if (typeof host.default !== 'object' || host.default === null) fail('the host half has no default export')
  note('host half loads and exports name/apply/default')
}

/* ---- 6. the patch row points at the package, not the browser half ---- */
const patchPath = join(here, 'cordis.patch.yml')
if (!existsSync(patchPath)) {
  fail('cordis.patch.yml is missing')
} else {
  const patch = readFileSync(patchPath, 'utf8')
  /* Comments are stripped first: this file explains at length why the row must
   * not point at the browser half, and a naive scan of the raw text matches its
   * own explanation. */
  const patchBody = patch.split(/\r?\n/).map((line) => line.replace(/#.*$/, '')).join('\n')
  if (!/name:\s*"?dsh-550w-boot"?\s*$/m.test(patchBody)) {
    fail('cordis.patch.yml inserts no row named "dsh-550w-boot"')
  }
  if (/dsh-550w-boot\/client/.test(patchBody)) {
    fail('cordis.patch.yml points at the browser half, which the host cannot import')
  }
  if (/[^\x00-\x7F]/.test(patch)) fail('cordis.patch.yml carries non-ASCII characters, which have broken the parser before')
}

for (const message of notes) console.log('  ok    ' + message)
for (const message of failures) console.log('  FAIL  ' + message)

if (failures.length > 0) {
  console.error('verify: ' + failures.length + ' problem(s)')
  process.exit(1)
}
console.log('verify: all checks passed')
