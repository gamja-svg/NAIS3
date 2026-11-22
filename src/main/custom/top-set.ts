import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, isAbsolute, join, resolve } from 'path'
import { WATCH_AUTOGEN_KEY } from '../../shared/custom-watch'
import type { FragmentRequestItem, TopSetResult, WatchRequestEvent } from '../../shared/types'
import { getSetting, setSetting } from '../db/settings'
import { t } from '../i18n'
import { getMemoryImage, isMemoryPath } from '../images/storage'
import { getPresetName, listPresets, listScenes, sortPresetScenesByNumber } from '../scenes/repo'
import { parseFragmentRequest, runFragmentRequest } from './fragment-request'
import sharp from '../sharp'

/**
 * [custom] 대표 세트 받기 — 프리셋의 씬마다 카드에 보이는 대표 이미지(최신 즐겨찾기, 없으면 최신)를
 * 한 장씩 폴더에 복사한다. 파일 이름은 씬 이름.
 *
 * - 똑같은 그림이 이미 있으면 건너뛴다.
 * - 같은 이름의 다른 그림이 있으면 그 파일을 휴지통으로 보내고 새 그림을 넣는다 (되살릴 수 있게).
 * - 폴더에 있던 다른 파일은 건드리지 않는다.
 *
 * 받는 형식을 `webp`(줄여서 받기)로 두면 PNG 그림을 WebP로 바꿔 받는다 (용량이 훨씬 작다. 원본 파일은 그대로).
 * 그때 폴더에 같은 이름의 `.png`가 남아 있으면 휴지통으로 보낸다 (두 벌이 남지 않게).
 *
 * 한 번 누르기: 기본 폴더 안의 `<프리셋 이름>` 폴더로 받는다. 감시 폴더에 요청 파일
 * (`*.request.json`)을 넣어도 받을 수 있다 — Claude가 원하는 폴더로 받아 줄 때 쓴다.
 */

const DIR_KEY = 'custom_topset_dir'
const FORMAT_KEY = 'custom_topset_format'
const MAX_NAME = 120
/** 줄여서 받기의 WebP 품질 — 원래 크기로 보면 구분하기 어려운 선에서 용량을 1/5 안팎으로 */
const WEBP_QUALITY = 85

/** 받는 형식 — original = 원본 그대로, webp = 줄여서 */
export type TopSetFormat = 'original' | 'webp'

export function getTopSetFormat(): TopSetFormat {
  return getSetting(FORMAT_KEY) === 'webp' ? 'webp' : 'original'
}

export function setTopSetFormat(format: TopSetFormat): void {
  setSetting(FORMAT_KEY, format === 'webp' ? 'webp' : 'original')
}

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

/**
 * 줄인 그림 — WebP 품질 85. 같은 그림은 늘 같은 바이트가 나온다.
 * 이미 작은 WebP라 줄여도 작아지지 않으면 원래 것을 그대로 돌려준다.
 */
export async function shrinkImage(image: Buffer): Promise<Buffer> {
  const small = await sharp(image).webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer()
  const isWebp = image.subarray(0, 4).toString('latin1') === 'RIFF'
  return isWebp && small.length >= image.length ? image : small
}

interface TopSetFile {
  name: string
  /** 줄여서 받을 때, 전에 원본으로 받아 둔 같은 이름의 PNG — 있으면 치운다 */
  sibling: string | null
  source: string
  /** WebP로 바꿔 받는다 */
  convert: boolean
  pending: boolean
}

/** 받을 그림 목록 — 프리셋의 씬 순서대로, 이름이 겹치면 (2)·(3) (Windows는 대소문자를 가리지 않는다) */
function topSetFiles(
  presetId: number,
  format: TopSetFormat
): { files: TopSetFile[]; noImage: number } {
  const used = new Set<string>()
  const files: TopSetFile[] = []
  let noImage = 0
  for (const scene of listScenes(presetId)) {
    if (!scene.thumbnailPath) {
      noImage++
      continue
    }
    const sourceExt = isMemoryPath(scene.thumbnailPath)
      ? '.png'
      : extname(scene.thumbnailPath).toLowerCase() || '.png'
    // PNG도, 크게 저장된(무손실) WebP도 줄인다
    const convert = format === 'webp' && (sourceExt === '.png' || sourceExt === '.webp')
    const ext = convert ? '.webp' : sourceExt
    const base = safeFileName(scene.name, `scene-${scene.id}`)
    let name = `${base}${ext}`
    let stem = base
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      stem = `${base} (${n})`
      name = `${stem}${ext}`
    }
    used.add(name.toLowerCase())
    files.push({
      name,
      sibling: convert && sourceExt === '.png' ? `${stem}.png` : null,
      source: scene.thumbnailPath,
      convert,
      pending: scene.pending === true
    })
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
  /** 받는 형식 — 없으면 저장된 설정 */
  format?: TopSetFormat
}

async function trashItem(path: string): Promise<void> {
  const { shell } = await import('electron')
  await shell.trashItem(path)
}

/** 대표 세트를 dest 폴더에 받는다 (없으면 만든다) */
export async function exportTopSet(
  presetId: number,
  dest: string,
  { trash = trashItem, format = getTopSetFormat() }: TopSetDeps = {}
): Promise<TopSetResult> {
  const presetName = getPresetName(presetId)
  if (presetName == null) throw new Error(t('ui.customTopSetPresetMissing'))
  const { files, noImage } = topSetFiles(presetId, format)
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
      let memory = isMemoryPath(file.source) ? getMemoryImage(file.source) : null
      if (isMemoryPath(file.source) && !memory) throw new Error('expired')
      // 줄여서 받기 — 같은 그림은 늘 같은 바이트가 나와, 아래의 '똑같으면 건너뛰기'가 그대로 통한다
      if (file.convert) memory = await shrinkImage(memory ?? readFileSync(file.source))
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
      // 줄여서 받았으면 전에 원본으로 받아 둔 같은 이름의 PNG는 휴지통으로 (두 벌이 남지 않게)
      if (file.sibling) {
        const old = join(dest, file.sibling)
        try {
          if (statSync(old).isFile()) {
            await trash(old)
            exists = true
          }
        } catch {
          // 없으면 그만
        }
      }
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
  /** 이 요청만 이 형식으로 (없으면 저장된 설정) */
  format: TopSetFormat | null
}

/** 요청 파일을 JSON 객체로 읽는다 — 읽을 수 없으면 알림 문구 */
function requestBody(raw: string): Record<string, unknown> | string {
  let data: unknown
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    return t('ui.customRequestBadJson')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return t('ui.customRequestBadJson')
  return data as Record<string, unknown>
}

/**
 * 불러온 씬 자동 생성 켜기·끄기 요청: `{ "action": "autoGenerate", "enabled": true | false }`.
 * 이 요청이 아니면 null, enabled가 true·false가 아니면 알림 문구.
 */
export function parseAutoGenerateRequest(raw: string): boolean | string | null {
  const body = requestBody(raw)
  if (typeof body === 'string' || body.action !== 'autoGenerate') return null
  return typeof body.enabled === 'boolean' ? body.enabled : t('ui.customRequestAutoGenEnabled')
}

/**
 * 요청 파일 내용:
 * `{ "action": "exportTopSet", "preset": "이름" | "presets": ["이름", ...], "to": "폴더", "subfolders": true }`
 * - to가 없으면 기본 폴더 안 프리셋 이름 폴더로 (한 번 누르기와 같다). 상대 경로는 요청 파일 기준.
 * - format: "webp" = 줄여서 받기, "original" = 원본 그대로. 없으면 버튼에서 고른 형식.
 * - to가 있으면 프리셋이 하나일 때 그 폴더에 바로, 여럿이면 그 안에 프리셋 이름 폴더로 (subfolders로 바꿀 수 있다).
 */
export function parseTopSetRequest(raw: string): TopSetRequest | string {
  const body = requestBody(raw)
  if (typeof body === 'string') return body
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
    subfolders: typeof body.subfolders === 'boolean' ? body.subfolders : null,
    format: body.format === 'webp' || body.format === 'original' ? body.format : null
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
  const autoGenerate = raw ? parseAutoGenerateRequest(raw) : null
  if (typeof autoGenerate === 'string') event.errors.push(autoGenerate)
  else if (autoGenerate !== null) {
    // 설정 > 저장의 스위치·타이틀바 `자동 생성` 버튼과 같은 값 — 화면은 알림을 받고 맞춘다
    setSetting(WATCH_AUTOGEN_KEY, autoGenerate ? '1' : '0')
    event.autoGenerate = autoGenerate
  }
  // 조각 고치기·읽기 — 조각 내용은 결과 파일에만 담는다 (화면 알림에는 수만)
  const body = raw && autoGenerate === null ? requestBody(raw) : null
  const fragments = body && typeof body !== 'string' ? parseFragmentRequest(body) : null
  let fragmentItems: FragmentRequestItem[] | undefined
  if (typeof fragments === 'string') event.errors.push(fragments)
  else if (fragments) {
    try {
      const done = runFragmentRequest(fragments)
      event.fragments = done.outcome
      fragmentItems = done.items
    } catch (e) {
      event.errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  // 씬 번호순 정렬 — { "action": "sortScenes", "preset": "이름" } (또는 "presets": [...])
  const sorting = body && typeof body !== 'string' && body.action === 'sortScenes'
  if (sorting && body && typeof body !== 'string') {
    const names = [
      ...(typeof body.preset === 'string' ? [body.preset] : []),
      ...(Array.isArray(body.presets) ? body.presets : [])
    ]
      .filter((n): n is string => typeof n === 'string')
      .map((n) => n.trim())
      .filter(Boolean)
    if (names.length === 0) event.errors.push(t('ui.customRequestNoPreset'))
    const presets = listPresets()
    event.sorted = []
    for (const name of new Set(names)) {
      const preset =
        presets.find((p) => p.name.trim() === name) ??
        presets.find((p) => norm(p.name) === norm(name))
      if (!preset) {
        event.errors.push(t('ui.customRequestPresetNotFoundValue', name))
        continue
      }
      event.sorted.push({
        presetId: preset.id,
        preset: preset.name,
        ...sortPresetScenesByNumber(preset.id)
      })
    }
  }
  const request =
    raw && autoGenerate === null && fragments === null && !sorting ? parseTopSetRequest(raw) : null
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
        event.exports.push(
          await exportTopSet(
            preset.id,
            dest,
            request.format ? { ...deps, format: request.format } : deps
          )
        )
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
      JSON.stringify(
        {
          ...event,
          ...(fragmentItems ? { fragmentItems } : {}),
          finishedAt: new Date().toISOString()
        },
        null,
        2
      ) + '\n',
      'utf-8'
    )
  } catch {
    // 결과 파일을 못 써도 앱 알림은 간다
  }
  return event
}
