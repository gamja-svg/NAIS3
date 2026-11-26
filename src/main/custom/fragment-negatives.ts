import { pairedNegatives, withPairedNegatives } from '../../shared/custom-fragment-negatives'
import type { GenerationRequest } from '../../shared/types'
import { getDb } from '../db'
import { listFragments } from '../fragments/repo'

/**
 * [custom] 조각의 네거 짝 — 조각마다 "같이 붙을 네거 조각" 하나.
 * 뽑을 때 프롬프트에 그 조각이 있으면 네거 짝이 네거티브에 자동으로 붙는다.
 * 씬마다 끌 수 있다 (custom_scene_negative_off).
 */
let ready: object | null = null
function db(): ReturnType<typeof getDb> {
  const database = getDb()
  if (ready !== database) {
    database.exec(
      'CREATE TABLE IF NOT EXISTS custom_fragment_negatives (fragment_id INTEGER PRIMARY KEY, negative_id INTEGER NOT NULL)'
    )
    database.exec(
      'CREATE TABLE IF NOT EXISTS custom_scene_negative_off (scene_id INTEGER PRIMARY KEY)'
    )
    ready = database
  }
  return database
}

/** 조각 id → 네거 짝 조각 id. 사라진 조각의 줄은 치운다 */
export function getFragmentNegatives(): Record<number, number> {
  const database = db()
  database
    .prepare(
      `DELETE FROM custom_fragment_negatives
       WHERE fragment_id NOT IN (SELECT id FROM fragments)
          OR negative_id NOT IN (SELECT id FROM fragments)`
    )
    .run()
  const rows = database
    .prepare('SELECT fragment_id AS f, negative_id AS n FROM custom_fragment_negatives')
    .all() as { f: number; n: number }[]
  return Object.fromEntries(rows.map((r) => [r.f, r.n]))
}

/** 네거 짝 지정 (null = 없애기). 자기 자신은 짝이 될 수 없다 */
export function setFragmentNegative(fragmentId: number, negativeId: number | null): void {
  const database = db()
  if (negativeId == null || negativeId === fragmentId)
    database.prepare('DELETE FROM custom_fragment_negatives WHERE fragment_id = ?').run(fragmentId)
  else
    database
      .prepare(
        `INSERT INTO custom_fragment_negatives (fragment_id, negative_id) VALUES (?, ?)
         ON CONFLICT(fragment_id) DO UPDATE SET negative_id = excluded.negative_id`
      )
      .run(fragmentId, negativeId)
}

/** 이 씬은 네거 짝을 자동으로 붙이지 않는다 */
export function isSceneNegativeOff(sceneId: number): boolean {
  return (
    db().prepare('SELECT 1 FROM custom_scene_negative_off WHERE scene_id = ?').get(sceneId) !==
    undefined
  )
}

/** 값이 실제로 바뀌었으면 true */
export function setSceneNegativeOff(sceneId: number, off: boolean): boolean {
  if (isSceneNegativeOff(sceneId) === off) return false
  if (off)
    db()
      .prepare('INSERT OR IGNORE INTO custom_scene_negative_off (scene_id) VALUES (?)')
      .run(sceneId)
  else db().prepare('DELETE FROM custom_scene_negative_off WHERE scene_id = ?').run(sceneId)
  return true
}

export function listSceneNegativeOff(): number[] {
  db()
    .prepare(
      'DELETE FROM custom_scene_negative_off WHERE scene_id NOT IN (SELECT id FROM gen_scenes)'
    )
    .run()
  return (
    db().prepare('SELECT scene_id AS id FROM custom_scene_negative_off').all() as { id: number }[]
  ).map((r) => r.id)
}

/** 뽑기 직전 — 프롬프트에 쓰인 조각의 네거 짝을 네거티브에 붙인 요청 (조각 치환 전에 부른다) */
export function withFragmentNegatives(request: GenerationRequest): GenerationRequest {
  if (request.sceneId !== undefined && isSceneNegativeOff(request.sceneId)) return request
  const pairs = getFragmentNegatives()
  if (Object.keys(pairs).length === 0) return request
  const { folders, items } = listFragments()
  const prompts = [
    ...(request.promptParts
      ? [request.promptParts.base, request.promptParts.additional, request.promptParts.detail]
      : [request.prompt]),
    ...request.characterPrompts.map((c) => c.prompt)
  ]
  const paired = pairedNegatives(prompts, request.negativePrompt, items, folders, pairs)
  if (paired.length === 0) return request
  return {
    ...request,
    negativePrompt: withPairedNegatives(request.negativePrompt, paired, items, folders)
  }
}
