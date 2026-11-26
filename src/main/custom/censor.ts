import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { extname } from 'path'
import type { CensorOpenResult, CensorSaveResult } from '../../shared/types'
import { getDb } from '../db'
import { t } from '../i18n'
import { isUnderImagesRoot, saveGeneratedImage } from '../images/storage'
import { getPresetName, getScene } from '../scenes/repo'
import sharp from '../sharp'

/**
 * [custom] 검수 모드의 검열(흰칠) — 원본은 건드리지 않고, 칠한 그림을 같은 씬에 새 그림으로 저장한다.
 *
 * - 처음 칠하면 원본 옆에 새 파일(씬 이름_N)을 만들고 images 행을 하나 더 넣는다. 즐겨찾기·만든 시각은
 *   원본 것을 물려받아, 원본이 대표 이미지였으면 새 그림이 대표가 되고 미생성 표시는 바뀌지 않는다.
 * - 그 그림을 다시 고치면 새 파일을 또 만들지 않고 그 파일만 다시 쓴다. 지우개가 원본을 되살릴 수 있게
 *   원본 경로와 칠한 자리(마스크)를 custom_censor에 남긴다.
 * - 흰칠은 RGB만 바꾼다. 알파(NAI 숨김 메타데이터)와 PNG 글자 청크(프롬프트)는 그대로 옮긴다.
 */

function censorDb(): ReturnType<typeof getDb> {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_censor (
      image_id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL,
      source_path TEXT NOT NULL,
      mask BLOB NOT NULL
    )
  `)
  return db
}

interface ImageRow {
  id: number
  file_path: string
  kind: string
  seed: number | null
  payload_json: string
  scene_id: number | null
  favorite: number
  created_at: string
}

interface CensorRow {
  image_id: number
  file_path: string
  source_path: string
  mask: Buffer
}

function imageByPath(filePath: string): ImageRow | undefined {
  return censorDb()
    .prepare(
      `SELECT id, file_path, kind, seed, payload_json, scene_id, favorite, created_at
       FROM images WHERE file_path = ? ORDER BY id DESC LIMIT 1`
    )
    .get(filePath) as ImageRow | undefined
}

/** 이 그림이 전에 칠해 둔 그림이면 그 기록. 그림 id는 지운 뒤 다시 쓰일 수 있어 파일 경로까지 맞춰 본다 */
function censorOf(image: ImageRow): CensorRow | undefined {
  const db = censorDb()
  const saved = db.prepare('SELECT * FROM custom_censor WHERE image_id = ?').get(image.id) as
    CensorRow | undefined
  if (saved && saved.file_path !== image.file_path) {
    db.prepare('DELETE FROM custom_censor WHERE image_id = ?').run(image.id)
    return undefined
  }
  return saved
}

/** 고칠 그림을 연다 — 이미 칠한 그림이면 원본과 칠한 자리를 돌려준다 */
export async function openCensor(filePath: string): Promise<CensorOpenResult> {
  const row = imageByPath(filePath)
  const saved = row ? censorOf(row) : undefined
  // 원본이 옮겨졌거나 지워졌으면 칠한 그림을 바탕으로 쓴다 (그때는 지우개로 되살릴 수 없다)
  const basePath = saved && existsSync(saved.source_path) ? saved.source_path : filePath
  const meta = await sharp(basePath).metadata()
  return {
    basePath,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    maskBase64: saved && basePath !== filePath ? saved.mask.toString('base64') : null
  }
}

/** 바탕 그림을 data: 주소로 — 화면이 픽셀을 읽을 수 있게 (그림 폴더 안의 파일만) */
export function readCensorBase(filePath: string): string {
  if (!isUnderImagesRoot(filePath)) throw new Error(t('ui.customCensorNoImage'))
  const mime = extname(filePath).toLowerCase() === '.webp' ? 'image/webp' : 'image/png'
  return `data:${mime};base64,${readFileSync(filePath).toString('base64')}`
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** 그림 내용이 아닌 청크 (프롬프트·색 정보) — 원본 것을 새 PNG로 옮긴다 */
const KEEP_CHUNKS = new Set([
  'tEXt',
  'iTXt',
  'zTXt',
  'eXIf',
  'iCCP',
  'sRGB',
  'gAMA',
  'cHRM',
  'pHYs'
])

function pngChunks(png: Buffer): { type: string; raw: Buffer }[] {
  const out: { type: string; raw: Buffer }[] = []
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIG)) return out
  let at = 8
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at)
    const end = at + 12 + length
    if (end > png.length) break
    out.push({ type: png.toString('latin1', at + 4, at + 8), raw: png.subarray(at, end) })
    at = end
  }
  return out
}

/** 새로 만든 PNG에 원본의 글자·색 청크를 옮겨 넣는다 (IHDR 바로 뒤) */
export function copyPngMeta(source: Buffer, target: Buffer): Buffer {
  const keep = pngChunks(source).filter((c) => KEEP_CHUNKS.has(c.type))
  const chunks = pngChunks(target)
  if (keep.length === 0 || chunks.length === 0 || chunks[0].type !== 'IHDR') return target
  const rest = chunks.slice(1).filter((c) => !KEEP_CHUNKS.has(c.type))
  return Buffer.concat([
    PNG_SIG,
    chunks[0].raw,
    ...keep.map((c) => c.raw),
    ...rest.map((c) => c.raw)
  ])
}

/**
 * 바탕 그림에 마스크만큼 흰칠을 해서 같은 형식으로 인코딩한다.
 * maskPng: 칠한 자리가 알파로 담긴 PNG (그림과 같은 크기, 다르면 맞춘다)
 */
export async function paintWhite(
  base: Buffer,
  maskPng: Buffer,
  format: 'png' | 'webp'
): Promise<{ image: Buffer; mask: Buffer; painted: boolean }> {
  const { data, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const alpha = await sharp(maskPng)
    .ensureAlpha()
    .extractChannel(3)
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer()
  const color = Math.min(channels, 3)
  let painted = false
  for (let p = 0, i = 0; p < alpha.length; p++, i += channels) {
    const a = alpha[p]
    if (a === 0) continue
    painted = true
    for (let c = 0; c < color; c++)
      data[i + c] = a === 255 ? 255 : Math.round(data[i + c] + ((255 - data[i + c]) * a) / 255)
  }
  const raw = sharp(data, { raw: { width, height, channels } })
  const image =
    format === 'webp'
      ? await raw.webp({ lossless: true }).toBuffer()
      : copyPngMeta(base, await raw.png().toBuffer())
  // 다시 열 때 쓸 마스크 — 한 채널 PNG로 작게
  const mask = await sharp(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
  return { image, mask, painted }
}

async function thumbnailOf(image: Buffer): Promise<Buffer> {
  return sharp(image).resize(640, 640, { fit: 'inside' }).webp({ quality: 90 }).toBuffer()
}

/** 다 쓴 뒤에 바꿔치기 — 쓰다가 끊겨도 반쯤 쓴 그림이 남지 않게 */
function writeAtomic(filePath: string, data: Buffer): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, filePath)
}

// 같은 그림을 겹쳐 저장하지 않게 차례로 처리한다 (자동 저장이 잇달아 올 수 있다)
let chain: Promise<unknown> = Promise.resolve()

/**
 * 칠한 그림을 저장한다. filePath = 검열을 열 때의 대표 이미지(원본이거나, 전에 칠해 둔 그림).
 * 돌려주는 filePath가 이제 씬의 대표 이미지다.
 */
export function saveCensor(filePath: string, maskBase64: string): Promise<CensorSaveResult> {
  const run = chain.then(() => saveCensorNow(filePath, Buffer.from(maskBase64, 'base64')))
  chain = run.catch(() => undefined)
  return run
}

async function saveCensorNow(filePath: string, maskPng: Buffer): Promise<CensorSaveResult> {
  const db = censorDb()
  const row = imageByPath(filePath)
  if (!row) throw new Error(t('ui.customCensorNoImage'))
  const saved = censorOf(row)
  const format = extname(row.file_path).toLowerCase() === '.webp' ? 'webp' : 'png'

  if (saved) {
    // 전에 칠해 둔 그림 — 원본에서 다시 칠해 그 파일만 다시 쓴다
    const basePath = existsSync(saved.source_path) ? saved.source_path : row.file_path
    const result = await paintWhite(readFileSync(basePath), maskPng, format)
    writeAtomic(row.file_path, result.image)
    db.prepare('UPDATE images SET thumbnail = ? WHERE id = ?').run(
      await thumbnailOf(result.image),
      row.id
    )
    db.prepare('UPDATE custom_censor SET mask = ? WHERE image_id = ?').run(result.mask, row.id)
    return { filePath: row.file_path, sceneId: row.scene_id, created: false }
  }

  const result = await paintWhite(readFileSync(row.file_path), maskPng, format)
  // 아무것도 칠하지 않았으면 새 그림을 만들지 않는다
  if (!result.painted) return { filePath: row.file_path, sceneId: row.scene_id, created: false }
  const scene = row.scene_id != null ? getScene(row.scene_id) : null
  const copy = await saveGeneratedImage({
    png: result.image,
    sentPayload: row.payload_json,
    seed: row.seed ?? 0,
    kind: row.kind as Parameters<typeof saveGeneratedImage>[0]['kind'],
    format,
    ...(scene
      ? {
          sceneId: scene.id,
          sceneName: scene.name,
          scenePresetName: getPresetName(scene.presetId) ?? undefined
        }
      : {})
  })
  db.transaction(() => {
    db.prepare('UPDATE images SET favorite = ?, created_at = ? WHERE id = ?').run(
      row.favorite,
      row.created_at,
      copy.id
    )
    db.prepare(
      `INSERT OR REPLACE INTO custom_censor (image_id, file_path, source_path, mask)
       VALUES (?, ?, ?, ?)`
    ).run(copy.id, copy.filePath, row.file_path, result.mask)
  })()
  return { filePath: copy.filePath, sceneId: copy.sceneId ?? null, created: true }
}
