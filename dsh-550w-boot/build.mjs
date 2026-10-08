/* ============================================================================
   build.mjs — splice the animation document into lib/client.js.

   RUN
     node build.mjs                          # animation/550W_ui.html
     node build.mjs path/to/other.html       # any other standalone HTML file

   The source document is embedded verbatim, so anything that stands alone in a
   browser tab — its own <style>, its own <script>, relative-free — becomes the
   boot animation without being edited. Rebuilding is the only step; the plugin
   needs no restart of the plugin manager beyond the one the shell already does.

   The generated file is what the browser actually receives, so this script
   refuses to emit a payload that cannot survive the trip:
     - a marker that does not appear exactly once in the template;
     - a document containing the round-trip-breaking line separators;
     - a document that does not survive JSON encode/decode byte for byte.
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, basename } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/* ---------------------------------------------------------------------------
   Options baked into the browser half.

   Edit these and re-run `node build.mjs`. They live here rather than in the
   profile's YAML because a client half receives no configuration: the boot
   manifest carries a client row's id, inject list and immediately flag, and
   nothing else. A settings UI would need a real schemastery Config schema on
   the host half, which is unavailable to a profile plugin (see lib/index.js).
   --------------------------------------------------------------------------- */
const OPTIONS = {
  enabled: true,

  /* How long the animation owns the screen before it fades. The bundled 550W
   * document reaches its banner at about 4.5s. */
  durationMs: 6600,

  /* Cross-fade to the application. The application is revealed underneath at
   * the start of the fade, so this is a cross-fade, not a black gap. */
  fadeMs: 700,

  /* When the skip hint appears. Long enough not to cover the opening frames,
   * short enough to be read by someone who wants out. */
  hintDelayMs: 1400,
  hint: '550W 正在接入 · 点击任意处跳过',

  /* Any key skips too. Modifier-only presses never do. */
  skipOnAnyKey: true,

  /* Slack on the timer half of every deadline.
   *
   * Deadlines are armed twice — a frame chain and a timer — and the first to
   * arrive wins. The slack is what lets the frame-accurate path be the normal
   * one; the timer only decides the outcome when frames have stopped, which is
   * exactly when it must still reveal the application. */
  timerSlackMs: 400,
}

/* --------------------------------------------------------------------------- */

const templatePath = join(here, 'lib', 'client.template.js')
const outPath = join(here, 'lib', 'client.js')
const animationDir = join(here, 'animation')

const argPath = process.argv[2]
const sourcePath = argPath ? resolve(process.cwd(), argPath) : join(animationDir, '550W_ui.html')

if (!existsSync(sourcePath)) {
  console.error('build: animation source not found: ' + sourcePath)
  console.error('build: put a standalone .html file there, or pass one: node build.mjs <file.html>')
  process.exit(1)
}

const html = readFileSync(sourcePath, 'utf8')

const problems = []
if (!/<html[\s>]/i.test(html)) problems.push('the source does not look like a complete HTML document (no <html>)')
if (!/<\/html>/i.test(html)) problems.push('the source does not look like a complete HTML document (no </html>)')
if (/[\u2028\u2029]/.test(html)) problems.push('the source contains U+2028/U+2029 line separators')
if (html.includes('__ANIMATION_JSON__') || html.includes('__OPTIONS_JSON__') || html.includes('__BUILD_JSON__')) {
  problems.push('the source contains one of this build\'s replacement markers')
}
if (problems.length > 0) {
  console.error('build: refusing to embed this document:')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}

/* JSON escaping is what makes the payload safe inside a JavaScript string
 * literal; escaping the line separators and the `</` of a closing script tag is
 * what makes it safe if the bundle is ever inlined into HTML. */
const encode = (value) => JSON.stringify(value)
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029')
  .replace(/<\//g, '<\\/')

const animationJson = encode(html)
const optionsJson = encode(OPTIONS)

/* Round-trip check: what the browser will parse as the string must be the exact
 * bytes of the source file, or the animation would render as something subtly
 * different from what was previewed in a browser tab. */
const roundTrip = JSON.parse(animationJson)
if (roundTrip !== html) {
  console.error('build: the payload does not round-trip to the source document; aborting')
  process.exit(1)
}

let version = '0.0.0'
try {
  version = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version
} catch { /* a missing version is cosmetic */ }

const build = {
  version,
  source: basename(sourcePath),
  animationBytes: Buffer.byteLength(html, 'utf8'),
  animationSha256: createHash('sha256').update(html).digest('hex').slice(0, 12),
  builtAt: new Date().toISOString(),
}
const buildJson = encode(build)

const template = readFileSync(templatePath, 'utf8')
const markers = ['__ANIMATION_JSON__', '__OPTIONS_JSON__', '__BUILD_JSON__']
for (const marker of markers) {
  const count = template.split(marker).length - 1
  if (count !== 1) {
    console.error('build: template must contain ' + marker + ' exactly once (found ' + count + ')')
    process.exit(1)
  }
}

const out = template
  .replace('__ANIMATION_JSON__', () => animationJson)
  .replace('__OPTIONS_JSON__', () => optionsJson)
  .replace('__BUILD_JSON__', () => buildJson)

for (const marker of markers) {
  if (out.includes(marker)) {
    console.error('build: marker ' + marker + ' survived substitution; aborting')
    process.exit(1)
  }
}

writeFileSync(outPath, out, 'utf8')

/* Keep a copy of the embedded document next to the build, so the plugin folder
 * is self-contained: the animation that shipped is always readable, even if the
 * file it was built from later changes or disappears. */
const keepName = basename(sourcePath)
const keepPath = join(animationDir, keepName)
if (resolve(keepPath) !== sourcePath) {
  copyFileSync(sourcePath, keepPath)
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB'
console.log('  source     ' + sourcePath)
console.log('  animation  ' + kb(build.animationBytes) + ', sha256:' + build.animationSha256)
console.log('  duration   ' + OPTIONS.durationMs + 'ms + ' + OPTIONS.fadeMs + 'ms fade, skip on click'
  + (OPTIONS.skipOnAnyKey ? '/key' : ''))
console.log('  wrote      lib/client.js (' + kb(Buffer.byteLength(out, 'utf8')) + ')')
if (resolve(keepPath) !== sourcePath) console.log('  archived   animation/' + keepName)
