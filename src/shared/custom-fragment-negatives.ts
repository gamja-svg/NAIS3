import { normalizeFragmentPath } from './fragment-path'
import { removeComments } from './nai-presets'

/**
 * [custom] 조각의 네거 짝 — 프롬프트에 `<인물 조각>`이 있으면, 짝으로 지정한 네거 조각이 뽑는 순간
 * 네거티브에 자동으로 붙는다 (네거티브 칸에는 적히지 않는다).
 */
export interface PairFragment {
  id: number
  name: string
  content: string
  folderId: number | null
}

/** 프롬프트에 적을 참조 — 같은 이름이 둘이면 폴더까지 적는다 */
export function fragmentRef(
  fragment: PairFragment,
  fragments: PairFragment[],
  folders: { id: number; name: string }[]
): string {
  const same = fragments.filter(
    (f) => normalizeFragmentPath(f.name) === normalizeFragmentPath(fragment.name)
  )
  const folder = folders.find((f) => f.id === fragment.folderId)?.name
  return `<${same.length > 1 && folder ? `${folder}/${fragment.name}` : fragment.name}>`
}

function resolver(
  fragments: PairFragment[],
  folders: { id: number; name: string }[]
): (text: string) => PairFragment[] {
  const folderName = new Map(folders.map((f) => [f.id, f.name]))
  // 뒤의 조각이 이긴다 (생성 때의 조회 규칙과 같음)
  const byPath = new Map<string, PairFragment>()
  for (const f of fragments) {
    byPath.set(normalizeFragmentPath(f.name), f)
    const folder = f.folderId == null ? undefined : folderName.get(f.folderId)
    if (folder) byPath.set(normalizeFragmentPath(`${folder}/${f.name}`), f)
  }
  return (text) =>
    [...removeComments(text).matchAll(/<([^<>\n]+)>/g)].flatMap((match) => {
      if (match[1].includes('|')) return []
      const found = byPath.get(normalizeFragmentPath(match[1].trim().replace(/^\*/, '')))
      return found ? [found] : []
    })
}

/**
 * 이 프롬프트들에 자동으로 붙을 네거 조각 — 프롬프트(와 그 안의 조각 내용, 3단계까지)에서 쓰인 조각의
 * 네거 짝 가운데, 네거티브에 이미 적혀 있지 않은 것. 처음 나온 순서, 겹치면 한 번만.
 */
export function pairedNegatives(
  prompts: string[],
  negative: string,
  fragments: PairFragment[],
  folders: { id: number; name: string }[],
  pairs: Record<number, number>
): PairFragment[] {
  if (Object.keys(pairs).length === 0) return []
  const refs = resolver(fragments, folders)
  const byId = new Map(fragments.map((f) => [f.id, f]))
  const used = new Map<number, PairFragment>()
  const visit = (text: string, depth: number): void => {
    for (const fragment of refs(text)) {
      if (used.has(fragment.id)) continue
      used.set(fragment.id, fragment)
      if (depth < 3) visit(fragment.content, depth + 1)
    }
  }
  for (const prompt of prompts) visit(prompt, 0)
  const already = new Set(refs(negative).map((f) => f.id))
  const out = new Map<number, PairFragment>()
  for (const fragment of used.values()) {
    const negativeFragment = byId.get(pairs[fragment.id])
    if (negativeFragment && !already.has(negativeFragment.id))
      out.set(negativeFragment.id, negativeFragment)
  }
  return [...out.values()]
}

/** 네거티브 뒤에 네거 짝 참조를 붙인 글 */
export function withPairedNegatives(
  negative: string,
  paired: PairFragment[],
  fragments: PairFragment[],
  folders: { id: number; name: string }[]
): string {
  if (paired.length === 0) return negative
  const refs = paired.map((f) => fragmentRef(f, fragments, folders)).join(', ')
  const head = negative.trimEnd()
  return head === '' ? refs : `${head}${head.endsWith(',') ? ' ' : ', '}${refs}`
}
