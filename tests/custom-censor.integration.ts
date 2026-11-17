import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyPngMeta, openCensor, paintWhite, saveCensor } from '../src/main/custom/censor'
import { closeDb, getDb, initDb } from '../src/main/db'
import { createPreset, createScene, listScenes, updateScene } from '../src/main/scenes/repo'
import sharp from '../src/main/sharp'

// [custom] 검수 모드의 검열(흰칠): 원본은 두고 칠한 그림을 같은 씬의 새 대표 이미지로 저장한다
const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {}
}))

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-censor-'))
  initDb()
})
afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

const W = 8
const H = 6
/** 회색 그림 (알파는 줄마다 다르게 — NAI 숨김 메타데이터가 알파에 있다) + 프롬프트 글자 청크 */
async function grayPng(): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * 4)
  for (let p = 0; p < W * H; p++) raw.set([100, 110, 120, 254 + (p % 2)], p * 4)
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer()
  // IHDR 뒤에 tEXt 청크를 끼운다 (CRC는 읽는 쪽이 보지 않는다)
  const text = Buffer.from('Comment\0{"prompt":"1girl, censored"}', 'latin1')
  const chunk = Buffer.alloc(12 + text.length)
  chunk.writeUInt32BE(text.length, 0)
  chunk.write('tEXt', 4, 'latin1')
  text.copy(chunk, 8)
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)])
}
/** 왼쪽 위 (x<3, y<2)만 칠한 마스크 — 화면이 보내는 꼴 (흰색 + 알파) */
async function maskPng(columns = 3): Promise<string> {
  const raw = Buffer.alloc(W * H * 4)
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < columns; x++) raw.set([255, 255, 255, 255], (y * W + x) * 4)
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer()
  return png.toString('base64')
}
const pixels = async (file: string | Buffer): Promise<Buffer> =>
  sharp(file).ensureAlpha().raw().toBuffer()
const at = (data: Buffer, x: number, y: number): number[] => [
  ...data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)
]

async function sceneWithImage(
  favorite = false
): Promise<{ preset: number; scene: number; file: string }> {
  const preset = createPreset('p')
  const scene = createScene(preset, '1')
  const dir = join(environment.directory, 'images')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, '1.png')
  writeFileSync(file, await grayPng())
  getDb()
    .prepare(
      `INSERT INTO images (file_path, payload_json, kind, seed, scene_id, favorite, created_at)
       VALUES (?, '{"prompt":"x"}', 'scene', 7, ?, ?, '2026-01-02 03:04:05')`
    )
    .run(file, scene, favorite ? 1 : 0)
  return { preset, scene, file }
}

describe('custom: censor paint', () => {
  it('paints only the masked pixels white and keeps alpha and the prompt text chunk', async () => {
    const base = await grayPng()
    const result = await paintWhite(base, Buffer.from(await maskPng(), 'base64'), 'png')
    expect(result.painted).toBe(true)
    const data = await pixels(result.image)
    expect(at(data, 0, 0)).toEqual([255, 255, 255, 254])
    expect(at(data, 1, 1)).toEqual([255, 255, 255, 255])
    expect(at(data, 3, 0)).toEqual([100, 110, 120, 255]) // 칠하지 않은 곳
    expect(at(data, 0, 2)).toEqual([100, 110, 120, 254])
    expect(result.image.includes(Buffer.from('1girl, censored', 'latin1'))).toBe(true)
    expect(copyPngMeta(Buffer.from('not a png'), result.image)).toBe(result.image)
  })

  it('reports an empty mask as nothing painted', async () => {
    const empty = await maskPng(0)
    const result = await paintWhite(await grayPng(), Buffer.from(empty, 'base64'), 'png')
    expect(result.painted).toBe(false)
  })
})

describe('custom: censor save', () => {
  it('saves a painted copy as the new cover, keeps the original, and leaves the pending mark alone', async () => {
    const { preset: presetId, scene, file } = await sceneWithImage(true)
    updateScene(scene, { prompt: 'changed' }) // 미생성 표시가 붙는다
    expect(listScenes(presetId)[0]).toMatchObject({ pending: true, thumbnailPath: file })
    const original = readFileSync(file)

    expect(await openCensor(file)).toEqual({
      basePath: file,
      width: W,
      height: H,
      maskBase64: null
    })
    const saved = await saveCensor(file, await maskPng())
    expect(saved).toMatchObject({ sceneId: scene, created: true })
    expect(saved.filePath).not.toBe(file)
    expect(readFileSync(file).equals(original)).toBe(true) // 원본은 그대로
    expect(at(await pixels(saved.filePath), 0, 0)).toEqual([255, 255, 255, 254])

    const listed = listScenes(presetId)[0]
    expect(listed).toMatchObject({
      thumbnailPath: saved.filePath, // 즐겨찾기를 물려받아 대표 이미지가 된다
      hasFavorite: true,
      imageCount: 2,
      pending: true // 칠한 그림은 새로 뽑은 그림이 아니다
    })
    const copy = getDb()
      .prepare('SELECT kind, seed, payload_json, created_at FROM images WHERE file_path = ?')
      .get(saved.filePath)
    expect(copy).toEqual({
      kind: 'scene',
      seed: 7,
      payload_json: '{"prompt":"x"}',
      created_at: '2026-01-02 03:04:05'
    })
  })

  it('reopens a painted copy on its original and rewrites that copy instead of adding another', async () => {
    const { scene, file } = await sceneWithImage()
    const first = await saveCensor(file, await maskPng())
    const opened = await openCensor(first.filePath)
    expect(opened.basePath).toBe(file) // 지우개가 원본을 되살릴 수 있게
    expect(opened.maskBase64).not.toBeNull()
    const mask = await sharp(Buffer.from(opened.maskBase64!, 'base64'))
      .raw()
      .toBuffer({ resolveWithObject: true })
    const n = mask.info.channels
    expect([mask.data[0], mask.data[2 * n], mask.data[3 * n]]).toEqual([255, 255, 0])

    // 한 칸만 남기고 지움 — 지운 자리는 원본으로 돌아온다
    const again = await saveCensor(first.filePath, await maskPng(1))
    expect(again).toEqual({ filePath: first.filePath, sceneId: scene, created: false })
    const data = await pixels(first.filePath)
    expect(at(data, 0, 0).slice(0, 3)).toEqual([255, 255, 255])
    expect(at(data, 2, 0).slice(0, 3)).toEqual([100, 110, 120])
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM images').get() as { n: number }).n).toBe(2)
  })

  it('makes no copy when nothing was painted, and forgets a record whose image id was reused', async () => {
    const { file } = await sceneWithImage()
    expect(await saveCensor(file, await maskPng(0))).toMatchObject({
      filePath: file,
      created: false
    })
    const saved = await saveCensor(file, await maskPng())
    // 칠한 그림을 지운 뒤 그 id를 다른 그림이 다시 쓴 경우
    const db = getDb()
    const id = (
      db.prepare('SELECT id FROM images WHERE file_path = ?').get(saved.filePath) as { id: number }
    ).id
    const other = join(environment.directory, 'images', 'other.png')
    writeFileSync(other, await grayPng())
    db.prepare('UPDATE images SET file_path = ? WHERE id = ?').run(other, id)
    expect(await openCensor(other)).toMatchObject({ basePath: other, maskBase64: null })
    expect(existsSync(saved.filePath)).toBe(true)
  })

  it('rejects an image that has no record', async () => {
    await expect(
      saveCensor(join(environment.directory, 'nope.png'), await maskPng())
    ).rejects.toThrow()
  })
})
