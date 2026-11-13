import { readFileSync, readdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import type { WatchFolderConfig, WatchFolderEvent, WatchFolderFailure } from '../../shared/types'
import { getSetting, setSetting } from '../db/settings'
import { parseSceneImport } from '../scenes/import-formats'
import { applyImportedScenes, createPreset, listPresets } from '../scenes/repo'

/**
 * [custom] 감시 폴더 — 지정한 폴더(하위 폴더 포함)에 씬 JSON이 새로 생기거나 바뀌면 자동으로 불러온다.
 *
 * - 보관 폴더를 그대로 감시한다: 파일을 옮기거나 지우거나 고치지 않는다.
 * - 감시를 켠(또는 폴더를 고른) 시각 이후에 생기거나 수정된 파일만 불러온다. 원래 있던 파일(옛 버전
 *   포함)은 건드리지 않는다. 처리한 파일은 크기·수정 시각을 기억해, 다시 바뀔 때까지 또 불러오지 않는다
 *   (프로그램을 껐다 켜도 유지).
 * - 불러오기는 파일 고르기와 같은 applyImportedScenes: 같은 이름 씬은 내용만 교체, 새 이름은 추가.
 *   씬을 지우거나 이미지를 만들지는 않는다.
 * - 프리셋 정하기: JSON 최상위 `preset` 이름(없으면 새로 만듦) → 없으면 파일 이름에 든 프리셋 이름.
 *   파일 이름만으로는 프리셋을 새로 만들지 않는다.
 * - fs.watch 대신 주기 확인: 동기화 폴더에서도 같게 동작하고, 쓰는 도중인 파일을 크기·수정 시각이
 *   두 번 연속 같을 때까지 기다리기 쉽다.
 */

const ENABLED_KEY = 'custom_watch_enabled'
const DIR_KEY = 'custom_watch_dir'
const SINCE_KEY = 'custom_watch_since'
const DONE_KEY = 'custom_watch_done'
const POLL_MS = 3000
const MAX_BYTES = 20 * 1024 * 1024
const MAX_DEPTH = 6
/** 한 번 훑을 때 보는 폴더 수 상한 — 실수로 드라이브 전체를 골라도 멈추지 않게 */
const MAX_DIRS = 3000
const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information'])

export function getWatchFolderConfig(): WatchFolderConfig {
  return { enabled: getSetting(ENABLED_KEY) === '1', dir: getSetting(DIR_KEY) ?? '' }
}

/** 기준 시각을 지금으로 — 이 시각 이전부터 있던 파일은 불러오지 않는다 */
function rebase(now: number): void {
  setSetting(SINCE_KEY, String(now))
  setSetting(DONE_KEY, '{}')
  seen.clear()
  done = null
}

export function setWatchFolderEnabled(enabled: boolean, now = Date.now()): WatchFolderConfig {
  const was = getSetting(ENABLED_KEY) === '1'
  setSetting(ENABLED_KEY, enabled ? '1' : '0')
  if (enabled && !was) rebase(now)
  return getWatchFolderConfig()
}

export function setWatchFolderDir(dir: string, now = Date.now()): WatchFolderConfig {
  setSetting(DIR_KEY, dir)
  rebase(now)
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

/** 감시 폴더의 파일 하나를 불러온다. file은 감시 폴더 기준 상대 경로(`/` 구분) */
export function importWatchFile(dir: string, file: string): WatchFolderEvent {
  const fail = (reason: WatchFolderFailure): WatchFolderEvent => ({ file, ok: false, reason })
  let raw: string
  try {
    const path = join(dir, file)
    if (statSync(path).size > MAX_BYTES) return fail('tooLarge')
    raw = readFileSync(path, 'utf-8')
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
  return {
    file,
    ok: true,
    presetId: preset.id,
    presetName: preset.name,
    presetCreated: created,
    ...outcome
  }
}

interface Found {
  /** 감시 폴더 기준 상대 경로 (`/` 구분) */
  file: string
  signature: string
  /** 수정 시각과 만든 시각 중 늦은 쪽 — 복사해 넣은 파일은 수정 시각이 옛날 그대로라 만든 시각도 본다 */
  touched: number
}

function listJson(dir: string): Found[] {
  const out: Found[] = []
  let dirs = 0
  const walk = (rel: string, depth: number): void => {
    if (++dirs > MAX_DIRS) return
    let entries
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH || entry.name.startsWith('.')) continue
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        walk(child, depth + 1)
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') {
        try {
          const st = statSync(join(dir, child))
          out.push({
            file: child,
            signature: `${st.size}:${Math.round(st.mtimeMs)}`,
            touched: Math.max(st.mtimeMs, st.birthtimeMs || 0)
          })
        } catch {
          // 방금 지워진 파일
        }
      }
    }
  }
  walk('', 0)
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/** 파일별 직전 확인 값 — 크기·수정 시각이 두 번 연속 같아야(다 써진 뒤) 처리한다 */
const seen = new Map<string, string>()
/** 처리한 파일의 크기·수정 시각 (설정에 저장) */
let done: Record<string, string> | null = null

function loadDone(): Record<string, string> {
  if (done) return done
  try {
    const parsed = JSON.parse(getSetting(DONE_KEY) ?? '{}') as unknown
    done =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {}
  } catch {
    done = {}
  }
  return done
}

/** 폴더를 한 번 훑어, 켠 뒤에 새로 생기거나 바뀐 .json을 불러온다 */
export function scanWatchFolder(): WatchFolderEvent[] {
  const { enabled, dir } = getWatchFolderConfig()
  if (!enabled || !dir) return []
  try {
    if (!statSync(dir).isDirectory()) return []
  } catch {
    return [] // 폴더가 잠깐 안 보일 때(외장·동기화) 기록을 지우지 않는다
  }
  const since = Number(getSetting(SINCE_KEY) ?? 0) || 0
  const processed = loadDone()
  const found = listJson(dir)
  const present = new Set(found.map((f) => f.file))
  for (const key of seen.keys()) if (!present.has(key)) seen.delete(key)
  let dirty = false
  for (const key of Object.keys(processed)) {
    if (!present.has(key)) {
      delete processed[key]
      dirty = true
    }
  }
  const events: WatchFolderEvent[] = []
  for (const { file, signature, touched } of found) {
    if (touched <= since || processed[file] === signature) continue
    if (seen.get(file) !== signature) {
      seen.set(file, signature)
      continue
    }
    seen.delete(file)
    events.push(importWatchFile(dir, file))
    processed[file] = signature
    dirty = true
  }
  if (dirty) setSetting(DONE_KEY, JSON.stringify(processed))
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
  done = null
}
