/**
 * [custom] 조각 창에서 누른 조각을 "마지막으로 커서를 둔 프롬프트 칸"에 넣는다.
 * 프롬프트 칸(PromptEditor)이 포커스를 받을 때 자기를 등록하고, 조각 창이 여기로 넣어 달라고 한다.
 */

/** 커서 자리(start~end)에 넣은 글과 넣은 뒤의 커서 자리 — 앞뒤 쉼표는 필요할 때만 붙인다 */
export function insertAtCaret(
  value: string,
  start: number,
  end: number,
  text: string
): { next: string; caret: number } {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const head = before.trimEnd()
  // 앞: 줄 처음·쉼표 뒤가 아니면 쉼표로 띄운다
  let lead = ''
  if (head !== '' && !head.endsWith(',') && !before.endsWith('\n')) lead = ', '
  else if (before.endsWith(',')) lead = ' '
  // 뒤: 바로 이어 쓸 수 있게 ", " (이미 쉼표가 오면 생략)
  const tail = after.trimStart().startsWith(',') ? '' : ', '
  const keep = lead === ', ' ? head : before
  const inserted = keep + lead + text + tail
  return { next: inserted + after, caret: inserted.length }
}

export interface PromptTarget {
  /** 커서 자리에 넣는다 */
  insert: (text: string) => void
}

let current: PromptTarget | null = null

export function setPromptTarget(target: PromptTarget): void {
  current = target
}

/** 그 칸이 사라질 때 — 지금 등록된 칸이 자기일 때만 비운다 */
export function clearPromptTarget(target: PromptTarget): void {
  if (current === target) current = null
}

/** 마지막으로 커서를 둔 프롬프트 칸에 넣는다. 그런 칸이 없으면 false */
export function insertIntoPrompt(text: string): boolean {
  if (!current) return false
  current.insert(text)
  return true
}
