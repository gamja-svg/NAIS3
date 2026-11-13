import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { basename, extname, join } from 'path'
import type { WatchFolderConfig, WatchFolderEvent, WatchFolderFailure } from '../../shared/types'
import { getSetting, setSetting } from '../db/settings'
import { t } from '../i18n'
import { parseSceneImport } from '../scenes/import-formats'
import { applyImportedScenes, createPreset, listPresets } from '../scenes/repo'

/**
 * [custom] 감시 폴더 — 지정한 폴더에 씬 JSON이 들어오면 자동으로 불러온다.
 *
 * - 불러오기 자체는 파일 고르기와 같은 applyImportedScenes를 쓴다: 같은 이름 씬은 내용만 교체,
 *   새 이름은 추가. 씬을 지우거나 이미지를 만들지는 않는다.
 * - 프리셋 정하기: JSON 최상위 `preset` 이름(없으면 새로 만듦) → 없으면 파일 이름에 든 프리셋 이름.
 *   파일 이름만으로는 프리셋을 새로 만들지 않는다(오타로 프리셋이 생기는 것 방지).
 * - 처리한 파일은 `완료`/`실패` 하위 폴더로 옮긴다. 폴더 최상위의 .json만 본다.
 * - fs.watch 대신 주기 확인: 동기화 폴더·네트워크 드라이브에서도 같게 동작하고, 쓰는 도중인
 *   파일을 크기·수정 시각이 두 번 연속 같을 때까지 기다리기 쉽다.
 */

const ENABLED_KEY = 'custom_watch_enabled'
const DIR_KEY = 'custom_watch_dir'
export const WATCH_DONE_DIR = '완료'
export const WATCH_FAILED_DIR = '실패'
const POLL_MS = 2000
const MAX_BYTES = 20 * 1024 * 1024

export function getWatchFolderConfig(): WatchFolderConfig {
  return { enabled: getSetting(ENABLED_KEY) === '1', dir: getSetting(DIR_KEY) ?? '' }
}

export function setWatchFolderEnabled(enabled: boolean): WatchFolderConfig {
  setSetting(ENABLED_KEY, enabled ? '1' : '0')
  seen.clear()
  return getWatchFolderConfig()
}

export function setWatchFolderDir(dir: string): WatchFolderConfig {
  setSetting(DIR_KEY, dir)
  seen.clear()
  return getWatchFolderConfig()
}

const norm = (s: string): string => s.normalize('NFC').trim().toLowerCase()
const isWordChar = (ch: string | undefined): boolean => !!ch && /[\p{L}\p{N}]/u.test(ch)

/**
 * 파일 이름에 든 프리셋 이름으로 프리셋을 고른다. 이름 앞뒤가 글자·숫자가 아니어야 맞는 것으로 친다
 * (`D1`이 `D10`에 걸리지 않게). 여러 개가 맞으면 가장 긴 이름, 그것도 여럿이면 고르지 않는다.
 */
export function pickPresetByFileName(
  fileName: string,
  presets: readonly { id: number; name: string }[]
): { id: number; name: string } | 'none' | 'ambiguous' {
  const base = norm(basename(fileName, extname(fileName)))
  let best: { id: number; name: string }[] = []
  let bestLength = 0
  for (const preset of presets) {
    const name = norm(preset.name)
    if (!name || name.length < bestLength) continue
    let at = base.indexOf(name)
    let hit = false
    while (at >= 0 && !hit) {
      hit = !isWordChar(base[at - 1]) && !isWordChar(base[at + name.length])
      at = base.indexOf(name, at + 1)
    }
    if (!hit) continue
    if (name.length > bestLength) {
      best = [preset]
      bestLength = name.length
    } else best.push(preset)
  }
  if (best.length === 0) return 'none'
  return best.length === 1 ? best[0] : 'ambiguous'
}

function declaredPreset(raw: string): string | null {
  try {
    const data = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const value = (data as Record<string, unknown>).preset
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  } catch {
    // 형식 오류는 parseSceneImport가 판정한다
  }
  return null
}

const FAILURE_TEXT: Record<WatchFolderFailure, Parameters<typeof t>[0]> = {
  unrecognized: 'ui.unrecognizedSceneJson',
  empty: 'ui.noScenesToImport',
  noPreset: 'ui.customWatchNoPreset',
  ambiguousPreset: 'ui.customWatchAmbiguousPreset',
  tooLarge: 'ui.customWatchTooLarge',
  readError: 'ui.customWatchReadError'
}

function stamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/** 처리한 파일을 하위 폴더로 옮긴다. 옮긴 경로(실패하면 null) */
function moveTo(dir: string, sub: string, file: string, now: Date): string | null {
  try {
    const targetDir = join(dir, sub)
    mkdirSync(targetDir, { recursive: true })
    let target = join(targetDir, `${stamp(now)}_${file}`)
    for (let i = 2; existsSync(target); i++) target = join(targetDir, `${stamp(now)}_${i}_${file}`)
    const source = join(dir, file)
    try {
      renameSync(source, target)
    } catch {
      copyFileSync(source, target)
      unlinkSync(source)
    }
    return target
  } catch {
    return null
  }
}

/** 감시 폴더의 파일 하나를 불러오고 완료/실패 폴더로 옮긴다 */
export function importWatchFile(dir: string, file: string, now = new Date()): WatchFolderEvent {
  const fail = (reason: WatchFolderFailure): WatchFolderEvent => {
    const moved = moveTo(dir, WATCH_FAILED_DIR, file, now)
    if (moved) {
      try {
        writeFileSync(`${moved}.txt`, `${t(FAILURE_TEXT[reason])}\n`, 'utf-8')
      } catch {
        // 사유 파일은 부가 정보
      }
    }
    return { file, ok: false, reason, moved: moved !== null }
  }

  let raw: string
  try {
    if (statSync(join(dir, file)).size > MAX_BYTES) return fail('tooLarge')
    raw = readFileSync(join(dir, file), 'utf-8')
  } catch {
    return fail('readError')
  }
  const scenes = parseSceneImport(raw)
  if (!scenes) return fail('unrecognized')
  if (scenes.length === 0) return fail('empty')

  const presets = listPresets()
  const declared = declaredPreset(raw)
  let preset: { id: number; name: string }
  let created = false
  if (declared) {
    const found =
      presets.find((p) => p.name.trim() === declared) ??
      presets.find((p) => norm(p.name) === norm(declared))
    if (found) preset = found
    else {
      preset = { id: createPreset(declared), name: declared }
      created = true
    }
  } else {
    const picked = pickPresetByFileName(file, presets)
    if (picked === 'none') return fail('noPreset')
    if (picked === 'ambiguous') return fail('ambiguousPreset')
    preset = picked
  }

  const outcome = applyImportedScenes(preset.id, scenes)
  const moved = moveTo(dir, WATCH_DONE_DIR, file, now)
  return {
    file,
    ok: true,
    presetId: preset.id,
    presetName: preset.name,
    presetCreated: created,
    ...outcome,
    moved: moved !== null
  }
}

/** 파일별 직전 확인 값 — 크기·수정 시각이 두 번 연속 같아야(다 써진 뒤) 처리한다 */
const seen = new Map<string, string>()
/** 옮기지 못한 파일을 매번 다시 불러오지 않게 기억 (값이 바뀌면 다시 처리) */
const stuck = new Map<string, string>()

/** 폴더를 한 번 훑어, 다 써진 .json을 불러온다. 꺼져 있거나 폴더가 없으면 아무것도 하지 않는다 */
export function scanWatchFolder(now = new Date()): WatchFolderEvent[] {
  const { enabled, dir } = getWatchFolderConfig()
  if (!enabled || !dir) return []
  let names: string[]
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && extname(e.name).toLowerCase() === '.json')
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
  const events: WatchFolderEvent[] = []
  const present = new Set(names)
  for (const key of seen.keys()) if (!present.has(key)) seen.delete(key)
  for (const key of stuck.keys()) if (!present.has(key)) stuck.delete(key)
  for (const name of names) {
    let signature: string
    try {
      const st = statSync(join(dir, name))
      signature = `${st.size}:${st.mtimeMs}`
    } catch {
      continue
    }
    if (seen.get(name) !== signature) {
      seen.set(name, signature)
      continue
    }
    if (stuck.get(name) === signature) continue
    const event = importWatchFile(dir, name, now)
    if (event.moved) seen.delete(name)
    else stuck.set(name, signature)
    events.push(event)
  }
  return events
}

let timer: ReturnType<typeof setInterval> | undefined

export function startWatchFolder(notify: (event: WatchFolderEvent) => void): void {
  stopWatchFolder()
  timer = setInterval(() => {
    try {
      for (const event of scanWatchFolder()) notify(event)
    } catch (e) {
      console.error('[custom] watch folder scan failed', e)
    }
  }, POLL_MS)
  timer.unref?.()
}

export function stopWatchFolder(): void {
  if (timer) clearInterval(timer)
  timer = undefined
  seen.clear()
  stuck.clear()
}
