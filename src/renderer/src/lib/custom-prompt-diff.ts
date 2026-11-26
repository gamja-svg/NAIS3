/**
 * [custom] 미생성 씬에서 바뀐 태그 찾기 — 쉼표·줄바꿈으로 나눈 조각 단위로 기준과 비교한다.
 * 가중치 묶음(`1.2::a, b::`)·괄호 강조는 조각 글자 그대로 비교하므로 숫자·괄호만 바뀌어도 바뀐 조각이 된다.
 * 앞뒤·사이 공백 차이는 같은 것으로 본다.
 */

/** 바뀐 태그 칠 — 반투명 노랑 + 밑줄 (가중치 배경 위에 겹쳐도 보이게) */
export const CHANGED_TAG_STYLE: React.CSSProperties = {
  background: 'rgb(234 179 8 / 0.3)',
  boxShadow: 'inset 0 -2px 0 rgb(234 179 8)',
  borderRadius: 3,
  boxDecorationBreak: 'clone',
  WebkitBoxDecorationBreak: 'clone'
}

export interface TextRange {
  start: number
  end: number
}

interface Piece extends TextRange {
  text: string
  key: string
}

/** 쉼표·줄바꿈으로 나눈 태그 조각 (앞뒤 공백을 뺀 위치) */
export function tagPieces(text: string): Piece[] {
  const pieces: Piece[] = []
  for (const m of text.matchAll(/[^,\n]+/g)) {
    const trimmed = m[0].trim()
    if (!trimmed) continue
    const start = m.index + (m[0].length - m[0].trimStart().length)
    pieces.push({
      start,
      end: start + trimmed.length,
      text: trimmed,
      key: trimmed.replace(/\s+/g, ' ')
    })
  }
  return pieces
}

function countKeys(pieces: Piece[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const p of pieces) counts.set(p.key, (counts.get(p.key) ?? 0) + 1)
  return counts
}

/** 기준(base)에 없던 조각의 위치 — 같은 태그가 여러 번이면 기준에 있던 개수만큼은 그대로 본다 */
export function changedTagRanges(current: string, base: string): TextRange[] {
  const left = countKeys(tagPieces(base))
  const ranges: TextRange[] = []
  for (const p of tagPieces(current)) {
    const n = left.get(p.key) ?? 0
    if (n > 0) left.set(p.key, n - 1)
    else ranges.push({ start: p.start, end: p.end })
  }
  return ranges
}

/** 기준에는 있었는데 지금은 없는 조각 (빠진 태그) */
export function removedTags(current: string, base: string): string[] {
  const left = countKeys(tagPieces(current))
  const removed: string[] = []
  for (const p of tagPieces(base)) {
    const n = left.get(p.key) ?? 0
    if (n > 0) left.set(p.key, n - 1)
    else removed.push(p.text)
  }
  return removed
}

/** 글을 칠할 구간과 아닌 구간으로 나눈다 (구간은 순서대로이고 겹치지 않는다) */
export function markedSegments(
  text: string,
  ranges: TextRange[]
): (TextRange & { marked: boolean })[] {
  const segments: (TextRange & { marked: boolean })[] = []
  let at = 0
  for (const r of ranges) {
    if (r.start > at) segments.push({ start: at, end: r.start, marked: false })
    segments.push({ start: r.start, end: r.end, marked: true })
    at = r.end
  }
  if (at < text.length) segments.push({ start: at, end: text.length, marked: false })
  return segments
}
