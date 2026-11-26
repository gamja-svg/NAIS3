import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, normalize, resolve, sep } from 'path'
import type { WatchFolderEvent, WatchGenerationReport } from '../../shared/types'
import { getScene } from '../scenes/repo'

/**
 * [custom] 감시 폴더의 씬 JSON 결과 파일 — `이름.json` 옆에 `이름.result.json`을 남긴다.
 * 불러오기 결과(프리셋·추가·수정 수, 다시 뽑을 씬)를 먼저 쓰고, 자동 생성이 돌면 씬마다
 * 뽑힘/실패/막힘과 이유를 `generation`에 채운다 — 화면을 못 보는 Claude가 읽고 확인할 수 있게.
 */
const RESULT_SUFFIX = '.result.json'

/** 결과 파일 경로 — 감시 폴더 밖으로 나가는 이름은 null */
function resultPath(dir: string, file: string): string | null {
  if (!file.toLowerCase().endsWith('.json')) return null
  const root = resolve(dir)
  const out = normalize(join(root, file.slice(0, -'.json'.length) + RESULT_SUFFIX))
  return out.startsWith(root + sep) ? out : null
}

function write(path: string, body: Record<string, unknown>): void {
  try {
    writeFileSync(path, JSON.stringify(body, null, 2) + '\n', 'utf8')
  } catch {
    // 결과 파일을 못 써도 불러오기·생성은 그대로다
  }
}

/** 불러오기 직후 — 결과 파일을 새로 쓴다 (전의 generation은 지운다) */
export function writeWatchImportResult(dir: string, event: WatchFolderEvent): void {
  // 씬 JSON이 아닌 파일(다른 프로그램의 JSON)에는 결과 파일을 남기지 않는다
  if (!event.ok && event.reason === 'unrecognized') return
  const path = resultPath(dir, event.file)
  if (!path) return
  const { sceneIds, ...rest } = event
  write(path, {
    ...rest,
    // 다시 뽑을 씬 (새로 들어왔거나 내용이 바뀐 씬) — 자동 생성이 켜져 있으면 이 씬들을 뽑는다
    ...(sceneIds ? { changedScenes: sceneIds.map((id) => getScene(id)?.name ?? `#${id}`) } : {}),
    finishedAt: new Date().toISOString()
  })
}

/** 자동 생성의 진행·결과를 결과 파일의 `generation`에 적는다 */
export function writeWatchGenerationReport(
  dir: string,
  file: string,
  report: WatchGenerationReport
): void {
  const path = dir ? resultPath(dir, file) : null
  if (!path) return
  let body: Record<string, unknown> = { file }
  try {
    if (existsSync(path)) body = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    // 깨진 결과 파일은 새로 쓴다
  }
  write(path, { ...body, generation: { ...report, updatedAt: new Date().toISOString() } })
}
