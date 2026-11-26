import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { processCharRefImage } from '../src/main/refs/prepare'
import sharp from '../src/main/sharp'

// [custom] V5 정밀 레퍼런스 그림 손질: 검정 여백 없이 버킷 크기로 덮어 자른다 (V4.5는 전처럼 여백)
let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nais3-custom-refv5-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function picture(width: number, height: number): Promise<string> {
  const file = join(dir, `${width}x${height}.png`)
  writeFileSync(
    file,
    await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
      .png()
      .toBuffer()
  )
  return file
}
const sizeOf = async (base64: string): Promise<[number, number]> => {
  const meta = await sharp(Buffer.from(base64, 'base64')).metadata()
  return [meta.width ?? 0, meta.height ?? 0]
}

describe('custom: V5 reference image', () => {
  it('crops to the closest bucket without black bars', async () => {
    const out = await processCharRefImage(await picture(600, 900), true)
    expect(await sizeOf(out)).toEqual([832, 1216])
    // 덮어 자르므로 모서리까지 그림 색 (여백이면 검정)
    const { data } = await sharp(Buffer.from(out, 'base64'))
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(150)
    expect(await sizeOf(await processCharRefImage(await picture(1300, 700), true))).toEqual([
      1344, 768
    ])
  })

  it('sends a picture that already has a bucket size as it is', async () => {
    const file = await picture(1024, 1024)
    const out = await processCharRefImage(file, true)
    expect(await sizeOf(out)).toEqual([1024, 1024])
  })

  it('keeps the padded canvases for V4.5', async () => {
    expect(await sizeOf(await processCharRefImage(await picture(600, 900), false))).toEqual([
      1024, 1536
    ])
    expect(await sizeOf(await processCharRefImage(await picture(900, 900), false))).toEqual([
      1472, 1472
    ])
  })
})
