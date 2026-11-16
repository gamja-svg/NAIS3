import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, isAbsolute, join, resolve } from 'path'
import type { TopSetResult, WatchRequestEvent } from '../../shared/types'
import { getSetting, setSetting } from '../db/settings'
import { t } from '../i18n'
import { getMemoryImage, isMemoryPath } from '../images/storage'
import { getPresetName, listPresets, listScenes } from '../scenes/repo'

/**
 * [custom] 대표 세트 받기 — 프리셋의 씬마다 카드에 보이는 대표 이미지(최신 즐겨찾기, 없으면 최신)를
 * 한 장씩 폴더에 복사한다. 파일 이름은 씬 이름.
 *
 * - 똑같은 그림이 이미 있으면 건너뛴다.
 * - 같은 이름의 다른 그림이 있으면 그 파일을 휴지통으로 보내고 새 그림을 넣는다 (되살릴 수 있게).
 * - 폴더에 있던 다른 파일은 건드리지 않는다.
 *
 * 한 번 누르기: 기본 폴더 안의 `<프리셋 이름>` 폴더로 받는다. 감시 폴더에 요청 파일
 * (`*.request.json`)을 넣어도 받을 수 있다 — Claude가 원하는 폴더로 받아 줄 때 쓴다.
 */

const DIR_KEY = 'custom_topset_dir'
const MAX_NAME = 120

export function getTopSetDir(): string {
  return getSetting(DIR_KEY) ?? ''
}

export function setTopSetDir(dir: string): void {
  setSetting(DIR_KEY, dir)
}

/** Windows에서 쓸 수 없는 글자·이름을 피한 파일·폴더 이름 */
export function safeFileName(name: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex -- 제어 문자도 파일 이름에 못 쓴다
  let safe = name.normalize('NFC').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
  safe = safe
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, MAX_NAME)
    .trim()
  if (!safe) safe = fallback
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe)) safe = `_${safe}`
  return safe
}

/** 기본 폴더 안의 이 프리셋 폴더 (기본 폴더를 아직 고르지 않았으면 null) */
export function defaultTopSetDest(presetId: number): string | null {
  const base = getTopSetDir()
  const name = getPresetName(presetId)
  if (!base || name == null) return null
  return join(base, safeFileName(name, `preset-${presetId}`))
}

interface TopSetFile {
  name: string
  source: string
  pending: boolean
}

/** 받을 그림 목록 — 프리셋의 씬 순서대로, 이름이 겹치면 (2)·(3) (Windows는 대소문자를 가리지 않는다) */
function topSetFiles(presetId: number): { files: TopSetFile[]; noImage: number } {
  const used = new Set<string>()
  const files: TopSetFile[] = []
  let noImage = 0
  for (const scene of listScenes(presetId)) {
    if (!scene.thumbnailPath) {
      noImage++
      continue
    }
    const ext = isMemoryPath(scene.thumbnailPath)
      ? '.png'
      : extname(scene.thumbnailPath).toLowerCase() || '.png'
    const base = safeFileName(scene.name, `scene-${scene.id}`)
    let name = `${base}${ext}`
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`
    used.add(name.toLowerCase())
    files.push({ name, source: scene.thumbnailPath, pending: scene.pending === true })
  }
  return { files, noImage }
}

function sameBytes(source: string, target: string): boolean {
  if (statSync(source).size !== statSync(target).size) return false
  return readFileSync(source).equals(readFileSync(target))
}

export interface TopSetDeps {
  /** 바꿀 파일을 휴지통으로 — 기본은 Electron shell.trashItem */
  trash?: (path: string) => Promise<void>
}

async function trashItem(path: string): Promise<void> {
  const { shell } = await import('electron')
  await shell.trashItem(path)
}

/** 대표 세트를 dest 폴더에 받는다 (없으면 만든다) */
export async function exportTopSet(
  presetId: number,
  dest: string,
  { trash = trashItem }: TopSetDeps = {}
): Promise<TopSetResult> {
  const presetName = getPresetName(presetId)
  if (presetName == null) throw new Error(t('ui.customTopSetPresetMissing'))
  const { files, noImage } = topSetFiles(presetId)
  mkdirSync(dest, { recursive: true })
  const result: TopSetResult = {
    presetId,
    presetName,
    dir: dest,
    total: files.length,
    written: 0,
    replaced: 0,
    same: 0,
    failed: 0,
    noImage,
    pending: files.filter((f) => f.pending).length
  }
  for (const file of files) {
    const target = join(dest, file.name)
    try {
      const memory = isMemoryPath(file.source) ? getMemoryImage(file.source) : null
      if (isMemoryPath(file.source) && !memory) throw new Error('expired')
      let exists = false
      try {
        const st = statSync(target)
        if (!st.isFile()) throw new Error('not a file') // 같은 이름 폴더는 건드리지 않는다
        exists = true
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      if (exists) {
        const same = memory ? readFileSync(target).equals(memory) : sameBytes(file.source, target)
        if (same) {
          result.same++
          continue
        }
        // 여기까지 왔으면 원본을 읽을 수 있다 (없으면 위에서 실패로 끝나 옛 그림은 그대로)
        await trash(target)
      }
      if (memory) writeFileSync(target, memory)
      else copyFileSync(file.source, target)
      if (exists) result.replaced++
      else result.written++
    } catch {
      result.failed++
    }
  }
  return result
}

// ── 감시 폴더 요청 파일 ─────────────────────────────────────────

const REQUEST_SUFFIX = '.request.json'
const RESULT_SUFFIX = '.result.json'

export const isWatchRequestFile = (file: string): boolean =>
  file.toLowerCase().endsWith(REQUEST_SUFFIX)
export const isWatchResultFile = (file: string): boolean =>
  file.toLowerCase().endsWith(RESULT_SUFFIX)

interface TopSetRequest {
  presets: string[]
  to: string | null
  subfolders: boolean | null
}

/**
 * 요청 파일 내용:
 * `{ "action": "exportTopSet", "preset": "이름" | "presets": ["이름", ...], "to": "폴더", "subfolders": true }`
 * - to가 없으면 기본 폴더 안 프리셋 이름 폴더로 (한 번 누르기와 같다). 상대 경로는 요청 파일 기준.
 * - to가 있으면 프리셋이 하나일 때 그 폴더에 바로, 여럿이면 그 안에 프리셋 이름 폴더로 (subfolders로 바꿀 수 있다).
 */
export function parseTopSetRequest(raw: string): TopSetRequest | string {
  let data: unknown
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    return t('ui.customRequestBadJson')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return t('ui.customRequestBadJson')
  const body = data as Record<string, unknown>
  if (body.action !== 'exportTopSet') return t('ui.customRequestUnknownAction')
  const names = [
    ...(typeof body.preset === 'string' ? [body.preset] : []),
    ...(Array.isArray(body.presets) ? body.presets : [])
  ]
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    .map((n) => n.trim())
  if (names.length === 0) return t('ui.customRequestNoPreset')
  return {
    presets: [...new Set(names)],
    to: typeof body.to === 'string' && body.to.trim() ? body.to.trim() : null,
    subfolders: typeof body.subfolders === 'boolean' ? body.subfolders : null
  }
}

const norm = (s: string): string => s.normalize('NFC').trim().toLowerCase()

/**
 * 감시 폴더의 요청 파일 하나를 처리하고, 옆에 결과 파일(`*.result.json`)을 남긴다.
 * file은 감시 폴더 기준 상대 경로(`/` 구분)
 */
export async function runWatchRequest(
  dir: string,
  file: string,
  deps: TopSetDeps = {}
): Promise<WatchRequestEvent> {
  const path = join(dir, file)
  const event: WatchRequestEvent = { file, ok: false, exports: [], errors: [] }
  let raw = ''
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    event.errors.push(t('ui.customWatchReadError'))
  }
  const request = raw ? parseTopSetRequest(raw) : null
  if (typeof request === 'string') event.errors.push(request)
  else if (request) {
    const presets = listPresets()
    const subfolders = request.subfolders ?? request.presets.length > 1
    const base = request.to
      ? isAbsolute(request.to)
        ? request.to
        : resolve(dirname(path), request.to)
      : getTopSetDir()
    for (const name of request.presets) {
      const preset =
        presets.find((p) => p.name.trim() === name) ??
        presets.find((p) => norm(p.name) === norm(name))
      if (!preset) {
        event.errors.push(t('ui.customRequestPresetNotFoundValue', name))
        continue
      }
      if (!base) {
        event.errors.push(t('ui.customTopSetNoDefaultDir'))
        break
      }
      const dest =
        !request.to || subfolders
          ? join(base, safeFileName(preset.name, `preset-${preset.id}`))
          : base
      try {
        event.exports.push(await exportTopSet(preset.id, dest, deps))
      } catch (e) {
        event.errors.push(`${preset.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  event.ok = event.errors.length === 0 && event.exports.every((r) => r.failed === 0)
  try {
    const out = path.slice(0, path.length - REQUEST_SUFFIX.length) + RESULT_SUFFIX
    writeFileSync(
      out,
      JSON.stringify({ ...event, finishedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf-8'
    )
  } catch {
    // 결과 파일을 못 써도 앱 알림은 간다
  }
  return event
}
