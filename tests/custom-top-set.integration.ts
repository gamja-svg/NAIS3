import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import { getSetting } from '../src/main/db/settings'
import sharp from '../src/main/sharp'
import { WATCH_AUTOGEN_KEY } from '../src/shared/custom-watch'
import {
  defaultTopSetDest,
  exportTopSet,
  getTopSetFormat,
  parseAutoGenerateRequest,
  parseTopSetRequest,
  runWatchRequest,
  safeFileName,
  setTopSetDir,
  setTopSetFormat,
  shrinkImage
} from '../src/main/custom/top-set'
import {
  scanWatchFolder,
  setWatchFolderDir,
  setWatchFolderEnabled,
  setWatchRequestHandler,
  stopWatchFolder
} from '../src/main/custom/watch-folder'
import { createPreset, createScene, listScenes } from '../src/main/scenes/repo'

// [custom] 대표 세트 받기: 씬마다 대표 이미지 1장, 같은 그림은 건너뛰고 바뀐 그림은 옛 것을 휴지통으로
const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {}
}))

let trashed: string[] = []
/** 휴지통 대신 옆 폴더로 옮긴다 (실제 휴지통을 쓰지 않게) */
const trash = async (path: string): Promise<void> => {
  const bin = join(environment.directory, 'bin')
  mkdirSync(bin, { recursive: true })
  renameSync(path, join(bin, `${trashed.length}-${path.split(/[\\/]/).pop()}`))
  trashed.push(path)
}

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-topset-'))
  trashed = []
  initDb()
})
afterEach(() => {
  setWatchRequestHandler()
  stopWatchFolder()
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

let imageSeq = 0
/** 씬에 이미지 한 장 (파일 내용 = body) */
function addImage(sceneId: number, body: string, favorite = false, ext = '.png'): string {
  const path = join(environment.directory, 'images', `img-${++imageSeq}${ext}`)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
  getDb()
    .prepare(
      `INSERT INTO images (file_path, payload_json, kind, scene_id, favorite)
       VALUES (?, '{}', 'scene', ?, ?)`
    )
    .run(path, sceneId, favorite ? 1 : 0)
  return path
}
const read = (dir: string, name: string): string => readFileSync(join(dir, name), 'utf-8')
const names = (dir: string): string[] => readdirSync(dir).sort()

describe('custom: cover set export', () => {
  it('saves covers as smaller WebP when asked, and clears the PNG it replaces', async () => {
    const preset = createPreset('줄이기')
    const a = createScene(preset, 'a')
    const b = createScene(preset, 'b')
    // 부드러운 바탕 + 잔무늬 — 무손실로는 크고 손실로는 작아지는 그림
    let seed = 7
    const noise = Buffer.from(
      Array.from({ length: 64 * 64 * 3 }, (_, i) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return ((i % 192) + (seed % 24)) & 255
      })
    )
    const raw = sharp(noise, { raw: { width: 64, height: 64, channels: 3 } })
    const png = await raw.clone().png({ compressionLevel: 0 }).toBuffer()
    const lossless = await raw.clone().webp({ lossless: true }).toBuffer()
    const pngPath = addImage(a, '')
    writeFileSync(pngPath, png)
    const webpPath = addImage(b, '', false, '.webp')
    writeFileSync(webpPath, lossless)
    const dest = join(environment.directory, 'out')
    const bytes = (name: string): Buffer => readFileSync(join(dest, name))

    expect(getTopSetFormat()).toBe('original')
    await exportTopSet(preset, dest, { trash })
    expect(names(dest)).toEqual(['a.png', 'b.webp'])
    expect(bytes('b.webp').equals(lossless)).toBe(true)

    setTopSetFormat('webp')
    expect(getTopSetFormat()).toBe('webp')
    const small = await exportTopSet(preset, dest, { trash })
    expect(small).toMatchObject({ written: 0, replaced: 2, same: 0, failed: 0 })
    expect(names(dest)).toEqual(['a.webp', 'b.webp'])
    expect(trashed.sort()).toEqual([join(dest, 'a.png'), join(dest, 'b.webp')])
    expect((await sharp(bytes('a.webp')).metadata()).format).toBe('webp')
    expect(bytes('a.webp').length).toBeLessThan(png.length)
    expect(bytes('b.webp').length).toBeLessThan(lossless.length) // 크게 저장된 WebP도 줄인다
    expect(readFileSync(pngPath).equals(png)).toBe(true) // 원본은 그대로
    expect(readFileSync(webpPath).equals(lossless)).toBe(true)

    // 다시 받으면 똑같아서 건너뛴다
    const again = await exportTopSet(preset, dest, { trash })
    expect(again).toMatchObject({ written: 0, replaced: 0, same: 2 })

    // 이미 줄인 WebP는 다시 줄여도 작아지지 않으면 그대로 둔다
    const tiny = bytes('a.webp')
    expect((await shrinkImage(tiny)).length).toBeLessThanOrEqual(tiny.length)

    // 원본 형식으로 되돌려도 줄여 받은 a.webp는 건드리지 않는다
    const back = await exportTopSet(preset, dest, { trash, format: 'original' })
    expect(back).toMatchObject({ written: 1, replaced: 1, same: 0 })
    expect(names(dest)).toEqual(['a.png', 'a.webp', 'b.webp'])
  })

  it('takes the format from a request file', () => {
    expect(
      parseTopSetRequest('{"action":"exportTopSet","preset":"a","format":"webp"}')
    ).toMatchObject({
      format: 'webp'
    })
    expect(
      parseTopSetRequest('{"action":"exportTopSet","preset":"a","format":"gif"}')
    ).toMatchObject({
      format: null
    })
  })

  it('copies the cover of each scene — latest favorite, else latest — named after the scene', async () => {
    const preset = createPreset('루나_교복_01')
    const a = createScene(preset, '01 인사')
    const b = createScene(preset, '02 웃음')
    createScene(preset, '03 빈 씬') // 그림 없음
    addImage(a, 'a-old')
    addImage(a, 'a-fav', true)
    addImage(a, 'a-new') // 즐겨찾기가 있으면 최신이어도 대표가 아니다
    addImage(b, 'b-1')
    addImage(b, 'b-2', false, '.webp')
    const dest = join(environment.directory, 'out')

    const result = await exportTopSet(preset, dest, { trash })
    expect(result).toMatchObject({
      presetName: '루나_교복_01',
      dir: dest,
      total: 2,
      written: 2,
      replaced: 0,
      same: 0,
      failed: 0,
      noImage: 1
    })
    expect(names(dest)).toEqual(['01 인사.png', '02 웃음.webp'])
    expect(read(dest, '01 인사.png')).toBe('a-fav')
    expect(read(dest, '02 웃음.webp')).toBe('b-2')
  })

  it('skips identical files, trashes a different old file before replacing it, and leaves other files', async () => {
    const preset = createPreset('p')
    const a = createScene(preset, 'a')
    const b = createScene(preset, 'b')
    addImage(a, 'a-1')
    addImage(b, 'b-1')
    const dest = join(environment.directory, 'out')
    await exportTopSet(preset, dest, { trash })
    writeFileSync(join(dest, 'memo.txt'), 'keep')

    addImage(b, 'b-2') // b만 다시 뽑음
    const again = await exportTopSet(preset, dest, { trash })
    expect(again).toMatchObject({ total: 2, written: 0, replaced: 1, same: 1, failed: 0 })
    expect(read(dest, 'b.png')).toBe('b-2')
    expect(trashed).toEqual([join(dest, 'b.png')])
    expect(read(join(environment.directory, 'bin'), '0-b.png')).toBe('b-1') // 옛 그림은 휴지통에
    expect(read(dest, 'memo.txt')).toBe('keep')
  })

  it('keeps the old file when the cover image is missing, and counts it as failed', async () => {
    const preset = createPreset('p')
    const a = createScene(preset, 'a')
    addImage(a, 'a-1')
    const dest = join(environment.directory, 'out')
    await exportTopSet(preset, dest, { trash })
    addImage(a, 'a-2')
    const latest = listScenes(preset)[0].thumbnailPath
    rmSync(latest) // 원본이 옮겨짐
    const result = await exportTopSet(preset, dest, { trash })
    expect(result).toMatchObject({ total: 1, failed: 1, replaced: 0 })
    expect(read(dest, 'a.png')).toBe('a-1')
    expect(trashed).toEqual([])
  })

  it('makes names safe for Windows and numbers scenes with the same name', async () => {
    const preset = createPreset('p')
    for (const name of ['a/b:c', 'A/B:C', 'con', '  .  ']) addImage(createScene(preset, name), name)
    const dest = join(environment.directory, 'out')
    const result = await exportTopSet(preset, dest, { trash })
    expect(result.written).toBe(4)
    const files = names(dest)
    expect(files).toContain('a_b_c.png')
    expect(files).toContain('A_B_C (2).png') // Windows는 대소문자를 가리지 않는다
    expect(files).toContain('_con.png')
    expect(files.some((f) => f.startsWith('scene-'))).toBe(true) // 이름이 비면 씬 번호
    expect(safeFileName('하나. ', 'x')).toBe('하나')
  })

  it('puts the one-click set in a folder named after the preset inside the default folder', () => {
    const preset = createPreset('루나:교복')
    expect(defaultTopSetDest(preset)).toBeNull() // 기본 폴더를 아직 고르지 않음
    setTopSetDir(join(environment.directory, 'sets'))
    expect(defaultTopSetDest(preset)).toBe(join(environment.directory, 'sets', '루나_교복'))
  })
})

describe('custom: cover set request files', () => {
  const watchDir = (): string => join(environment.directory, 'watch')
  const request = (name: string, body: unknown): string => {
    const path = join(watchDir(), name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body))
    return path
  }
  const result = (name: string): { ok: boolean; exports: unknown[]; errors: string[] } =>
    JSON.parse(readFileSync(join(watchDir(), name), 'utf-8'))

  it('reads the request format', () => {
    expect(parseTopSetRequest('{"action":"exportTopSet","preset":"a","to":"C:\\\\x"}')).toEqual({
      presets: ['a'],
      to: 'C:\\x',
      subfolders: null,
      format: null
    })
    expect(
      parseTopSetRequest(
        JSON.stringify({ action: 'exportTopSet', presets: ['a', 'b', 'a'], subfolders: false })
      )
    ).toEqual({ presets: ['a', 'b'], to: null, subfolders: false, format: null })
    expect(typeof parseTopSetRequest('{"preset":"a"}')).toBe('string') // action 없음
    expect(typeof parseTopSetRequest('{"action":"exportTopSet"}')).toBe('string')
    expect(typeof parseTopSetRequest('not json')).toBe('string')
  })

  it('exports one preset straight into "to" and writes a result file next to the request', async () => {
    const preset = createPreset('루나_교복_01')
    addImage(createScene(preset, 'a'), 'a-1')
    const to = join(environment.directory, '에셋', '루나')
    request('요청/대표세트.request.json', { action: 'exportTopSet', preset: '루나_교복_01', to })

    const event = await runWatchRequest(watchDir(), '요청/대표세트.request.json', { trash })
    expect(event.ok).toBe(true)
    expect(event.exports).toHaveLength(1)
    expect(read(to, 'a.png')).toBe('a-1')
    const saved = result('요청/대표세트.result.json')
    expect(saved.ok).toBe(true)
    expect(saved.exports).toHaveLength(1)
  })

  it('puts several presets in their own folders, resolves relative paths from the request, and reports unknown presets', async () => {
    const one = createPreset('A')
    const two = createPreset('B')
    addImage(createScene(one, 's'), 'a')
    addImage(createScene(two, 's'), 'b')
    request('r.request.json', { action: 'exportTopSet', presets: ['A', 'b', '없음'], to: 'sets' })

    const event = await runWatchRequest(watchDir(), 'r.request.json', { trash })
    expect(event.ok).toBe(false)
    expect(event.exports.map((r) => r.presetName)).toEqual(['A', 'B']) // 이름은 대소문자 무시
    expect(event.errors).toHaveLength(1)
    expect(read(join(watchDir(), 'sets', 'A'), 's.png')).toBe('a')
    expect(read(join(watchDir(), 'sets', 'B'), 's.png')).toBe('b')
  })

  it('uses the default folder when "to" is missing, and says so when there is none', async () => {
    const preset = createPreset('P')
    addImage(createScene(preset, 's'), 'p')
    request('r.request.json', { action: 'exportTopSet', preset: 'P' })
    const missing = await runWatchRequest(watchDir(), 'r.request.json', { trash })
    expect(missing.ok).toBe(false)
    expect(missing.exports).toEqual([])

    setTopSetDir(join(environment.directory, 'sets'))
    const done = await runWatchRequest(watchDir(), 'r.request.json', { trash })
    expect(done.ok).toBe(true)
    expect(read(join(environment.directory, 'sets', 'P'), 's.png')).toBe('p')
  })

  it('turns auto-generation of imported scenes on and off, and keeps it when "enabled" is not a boolean', async () => {
    expect(parseAutoGenerateRequest('{"action":"autoGenerate","enabled":true}')).toBe(true)
    expect(parseAutoGenerateRequest('{"action":"exportTopSet","preset":"a"}')).toBeNull()
    expect(parseAutoGenerateRequest('not json')).toBeNull()

    request('자동생성.request.json', { action: 'autoGenerate', enabled: true })
    const on = await runWatchRequest(watchDir(), '자동생성.request.json', { trash })
    expect(on).toMatchObject({ ok: true, autoGenerate: true, exports: [], errors: [] })
    expect(getSetting(WATCH_AUTOGEN_KEY)).toBe('1')
    expect(result('자동생성.result.json')).toMatchObject({ ok: true, autoGenerate: true })

    request('자동생성.request.json', { action: 'autoGenerate', enabled: false })
    expect(
      (await runWatchRequest(watchDir(), '자동생성.request.json', { trash })).autoGenerate
    ).toBe(false)
    expect(getSetting(WATCH_AUTOGEN_KEY)).toBe('0')

    request('잘못.request.json', { action: 'autoGenerate', enabled: 'on' })
    const bad = await runWatchRequest(watchDir(), '잘못.request.json', { trash })
    expect(bad.ok).toBe(false)
    expect(bad.autoGenerate).toBeUndefined()
    expect(bad.errors).toHaveLength(1)
    expect(getSetting(WATCH_AUTOGEN_KEY)).toBe('0') // 그대로

    request('모름.request.json', { action: 'deleteEverything' })
    expect((await runWatchRequest(watchDir(), '모름.request.json', { trash })).errors).toHaveLength(
      1
    )
  })

  it('hands request files to the handler, ignores result files, and never imports either as scenes', () => {
    const since = Date.now() - 60_000
    setWatchFolderDir(watchDir(), since)
    setWatchFolderEnabled(true, since)
    const handled: string[] = []
    setWatchRequestHandler((_dir, file) => handled.push(file))
    const stamp = (path: string): void => {
      const at = new Date(since + 10_000)
      utimesSync(path, at, at)
    }
    stamp(request('a.request.json', { action: 'exportTopSet', preset: 'P' }))
    stamp(request('a.result.json', { ok: true, exports: [], errors: [] }))

    expect(scanWatchFolder()).toEqual([]) // 다 써졌는지 보려고 첫 확인은 건너뛴다
    expect(scanWatchFolder()).toEqual([]) // 씬 불러오기 결과가 없다
    expect(handled).toEqual(['a.request.json'])
    expect(scanWatchFolder()).toEqual([])
    expect(handled).toEqual(['a.request.json']) // 바뀌기 전에는 다시 하지 않는다
    expect(existsSync(join(watchDir(), 'a.request.json'))).toBe(true) // 요청 파일은 그대로 둔다
  })

  it('edits and reads fragments from a request file', async () => {
    const { listFragments } = await import('../src/main/fragments/repo')
    request('f.request.json', {
      action: 'fragments',
      set: [
        { name: '초아 얼굴', content: 'blue eyes', folder: '윤초아' },
        { name: '배경', content: ['room', 'park'] }
      ]
    })
    const made = await runWatchRequest(watchDir(), 'f.request.json', { trash })
    expect(made.ok).toBe(true)
    expect(made.fragments).toEqual({ created: 2, updated: 0, unchanged: 0, missing: [] })
    expect(made.exports).toEqual([])
    const state = listFragments()
    expect(state.folders.map((f) => f.name)).toContain('윤초아')
    const mine = state.items.filter((f) => ['초아 얼굴', '배경'].includes(f.name))
    expect(mine.map((f) => [f.name, f.content, f.folderId != null])).toEqual([
      ['초아 얼굴', 'blue eyes', true],
      ['배경', 'room\npark', false]
    ])
    expect(result('f.result.json').fragmentItems).toEqual([
      { name: '초아 얼굴', content: 'blue eyes', folder: '윤초아' },
      { name: '배경', content: 'room\npark' }
    ])

    // 같은 이름(대소문자 무시)은 내용만 바꾸고, 같으면 그대로. 폴더는 옮기지 않는다
    request('f.request.json', {
      action: 'fragments',
      set: [
        { name: '초아 얼굴', content: 'green eyes', folder: '다른 폴더' },
        { name: '배경', content: 'room\npark' }
      ],
      read: ['초아 얼굴', '없는 조각']
    })
    const changed = await runWatchRequest(watchDir(), 'f.request.json', { trash })
    expect(changed.fragments).toEqual({
      created: 0,
      updated: 1,
      unchanged: 1,
      missing: ['없는 조각']
    })
    expect(listFragments().folders.map((f) => f.name)).not.toContain('다른 폴더')
    expect(result('f.result.json').fragmentItems).toEqual([
      { name: '초아 얼굴', content: 'green eyes', folder: '윤초아' }
    ])

    // 읽기만: 전부
    request('f.request.json', { action: 'fragments', read: true })
    const all = await runWatchRequest(watchDir(), 'f.request.json', { trash })
    expect(all.fragments).toEqual({ created: 0, updated: 0, unchanged: 0, missing: [] })
    expect(result('f.result.json').fragmentItems).toHaveLength(state.items.length)

    // 잘못 적은 요청은 아무것도 바꾸지 않는다
    request('f.request.json', { action: 'fragments', set: [{ name: '', content: 'x' }] })
    const bad = await runWatchRequest(watchDir(), 'f.request.json', { trash })
    expect(bad.ok).toBe(false)
    expect(bad.fragments).toBeUndefined()
    request('f.request.json', { action: 'fragments' })
    expect((await runWatchRequest(watchDir(), 'f.request.json', { trash })).ok).toBe(false)
    expect(listFragments().items).toHaveLength(state.items.length)
  })

  it('sorts a preset by scene number from a request file', async () => {
    const preset = createPreset('정렬')
    for (const name of ['10', '2', '메모용', '1']) createScene(preset, name)
    request('s.request.json', { action: 'sortScenes', preset: '정렬' })
    const done = await runWatchRequest(watchDir(), 's.request.json', { trash })
    expect(done.ok).toBe(true)
    expect(done.sorted).toEqual([{ presetId: preset, preset: '정렬', scenes: 4, moved: 3 }])
    expect(listScenes(preset).map((s) => s.name)).toEqual(['1', '2', '10', '메모용'])
    const again = await runWatchRequest(watchDir(), 's.request.json', { trash })
    expect(again.sorted?.[0].moved).toBe(0)

    request('s.request.json', { action: 'sortScenes', preset: '없는 프리셋' })
    expect((await runWatchRequest(watchDir(), 's.request.json', { trash })).ok).toBe(false)
    request('s.request.json', { action: 'sortScenes' })
    expect((await runWatchRequest(watchDir(), 's.request.json', { trash })).ok).toBe(false)
  })
})
