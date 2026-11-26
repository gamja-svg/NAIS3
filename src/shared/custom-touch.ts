/** [custom] 터치·원격 모드 — 길게 누른 뒤에만 자리 이동(재정렬)을 시작한다 */
export const TOUCH_REORDER_HOLD_MS = 3000
/** 이만큼 움직이기 전까지는 '가만히 누르고 있는 것'으로 본다 (손가락 떨림·원격 지연 여유) */
export const TOUCH_MOVE_TOLERANCE_PX = 8

export type DragIntent = 'wait' | 'scroll' | 'reorder'

/**
 * 누른 뒤 지난 시간과 움직인 거리로 드래그의 뜻을 정한다.
 * - 아직 거의 안 움직임 → 기다림
 * - 길게 누르기 전에 움직임 → 스크롤
 * - 길게 누른 뒤에 움직임 → 자리 이동(목록 쪽 dnd가 맡는다)
 */
export function dragIntent(
  elapsedMs: number,
  movedPx: number,
  holdMs = TOUCH_REORDER_HOLD_MS,
  tolerancePx = TOUCH_MOVE_TOLERANCE_PX
): DragIntent {
  if (movedPx <= tolerancePx) return 'wait'
  return elapsedMs < holdMs ? 'scroll' : 'reorder'
}
