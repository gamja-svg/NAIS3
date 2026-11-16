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
import {
  defaultTopSetDest,
  exportTopSet,
  parseTopSetRequest,
  runWatchRequest,
  safeFileName,
  setTopSetDir
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
      subfolders: null
    })
    expect(
      parseTopSetRequest(
        JSON.stringify({ action: 'exportTopSet', presets: ['a', 'b', 'a'], subfolders: false })
      )
    ).toEqual({ presets: ['a', 'b'], to: null, subfolders: false })
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
})
