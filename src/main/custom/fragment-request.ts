import { normalizeFragmentPath } from '../../shared/fragment-path'
import type { FragmentRequestItem, FragmentRequestOutcome } from '../../shared/types'
import {
  createFragment,
  createFragmentFolder,
  listFragments,
  updateFragment
} from '../fragments/repo'
import { t } from '../i18n'
import { getFragmentNegatives, setFragmentNegative } from './fragment-negatives'

/**
 * [custom] 감시 폴더의 `조각 고치기` 요청 — Claude가 조각(프롬프트의 `<이름>`)을 읽고 고친다.
 *
 * ```json
 * { "action": "fragments",
 *   "set": [{ "name": "초아 얼굴", "content": "blue eyes, ...", "folder": "윤초아" }],
 *   "read": true }
 * ```
 * - set: 같은 이름(대소문자 무시)의 조각이 있으면 내용을 바꾸고, 없으면 새로 만든다.
 *   content는 글자 또는 줄 배열. folder는 새로 만들 때 넣을 폴더 이름(없으면 만든다) — 있는 조각의
 *   폴더는 옮기지 않는다. 조각을 지우거나 이름을 바꾸지는 않는다.
 *   negative: 네거 짝으로 삼을 조각 이름 (null이면 짝을 없앤다, 칸이 없으면 그대로) — 프롬프트에
 *   이 조각이 있으면 뽑을 때 네거 짝이 네거티브에 자동으로 붙는다.
 * - read: true = 조각 전부, ["이름", ...] = 그 조각만, 없으면 set에 적은 조각만 — 결과 파일의
 *   `fragmentItems`에 지금 내용이 담긴다 (고친 뒤의 내용).
 */
export interface FragmentRequest {
  /** negative: undefined = 그대로, null = 짝 없애기, 이름 = 그 조각을 네거 짝으로 */
  set: { name: string; content: string; folder: string | null; negative?: string | null }[]
  read: true | string[] | null
}

/** 이 요청이 아니면 null, 잘못 적혔으면 알림 문구 */
export function parseFragmentRequest(
  body: Record<string, unknown>
): FragmentRequest | string | null {
  if (body.action !== 'fragments') return null
  const set: FragmentRequest['set'] = []
  if (body.set !== undefined) {
    if (!Array.isArray(body.set)) return t('ui.customRequestFragmentsBadSet')
    for (const raw of body.set as unknown[]) {
      const item = raw as Record<string, unknown> | null
      const name = typeof item?.name === 'string' ? item.name.trim() : ''
      const content = Array.isArray(item?.content)
        ? item.content.filter((l): l is string => typeof l === 'string').join('\n')
        : item?.content
      if (!name || typeof content !== 'string') return t('ui.customRequestFragmentsBadSet')
      set.push({
        name,
        content,
        folder: typeof item?.folder === 'string' && item.folder.trim() ? item.folder.trim() : null,
        ...(item?.negative === null
          ? { negative: null }
          : typeof item?.negative === 'string' && item.negative.trim()
            ? { negative: item.negative.trim() }
            : {})
      })
    }
  }
  const read =
    body.read === true
      ? true
      : Array.isArray(body.read)
        ? body.read.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        : null
  if (set.length === 0 && read === null) return t('ui.customRequestFragmentsEmpty')
  return { set, read }
}

/** 요청대로 조각을 고치고, 읽어 달라는 조각의 지금 내용을 돌려준다 */
export function runFragmentRequest(request: FragmentRequest): {
  outcome: FragmentRequestOutcome
  items: FragmentRequestItem[]
} {
  const outcome: FragmentRequestOutcome = { created: 0, updated: 0, unchanged: 0, missing: [] }
  const key = normalizeFragmentPath
  const before = listFragments()
  const byName = new Map(before.items.map((f) => [key(f.name), f]))
  const folderIds = new Map(before.folders.map((f) => [key(f.name), f.id]))
  for (const item of request.set) {
    const existing = byName.get(key(item.name))
    if (existing) {
      if (existing.content === item.content) outcome.unchanged++
      else {
        updateFragment(existing.id, { content: item.content })
        existing.content = item.content
        outcome.updated++
      }
      continue
    }
    let folderId: number | null = null
    if (item.folder) {
      folderId = folderIds.get(key(item.folder)) ?? createFragmentFolder(item.folder)
      folderIds.set(key(item.folder), folderId)
    }
    const id = createFragment(item.name, folderId, item.content)
    byName.set(key(item.name), { id, name: item.name, content: item.content, folderId })
    outcome.created++
  }

  // 네거 짝 — 조각을 다 만든 뒤에 맞춘다 (같은 요청에서 만든 네거 조각을 짝으로 삼을 수 있게)
  for (const item of request.set) {
    if (item.negative === undefined) continue
    const self = byName.get(key(item.name))
    const pair = item.negative === null ? null : byName.get(key(item.negative))
    if (!self) continue
    if (item.negative !== null && !pair) outcome.missing.push(item.negative)
    else setFragmentNegative(self.id, pair?.id ?? null)
  }

  const after = listFragments()
  const pairs = getFragmentNegatives()
  const nameById = new Map(after.items.map((f) => [f.id, f.name]))
  const folderName = new Map(after.folders.map((f) => [f.id, f.name]))
  const all = new Map(after.items.map((f) => [key(f.name), f]))
  const wanted =
    request.read === true
      ? after.items
      : (request.read ?? request.set.map((s) => s.name)).flatMap((name) => {
          const found = all.get(key(name))
          if (!found) outcome.missing.push(name)
          return found ? [found] : []
        })
  const items = [...new Set(wanted)].map((f) => ({
    name: f.name,
    content: f.content,
    ...(f.folderId != null && folderName.has(f.folderId)
      ? { folder: folderName.get(f.folderId) as string }
      : {}),
    ...(nameById.has(pairs[f.id]) ? { negative: nameById.get(pairs[f.id]) as string } : {})
  }))
  return { outcome, items }
}
