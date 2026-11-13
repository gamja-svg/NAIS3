import { useSyncExternalStore } from 'react'
import { TOUCH_MOVE_TOLERANCE_PX, TOUCH_REORDER_HOLD_MS, dragIntent } from '@shared/custom-touch'

/**
 * [custom] 터치·원격 모드 — 휠이 없는 환경(원격 접속·터치)에서 목록을 넘길 수 있게 한다.
 * 켜면: ① 원본이 숨긴 스크롤바를 잡아 끌 수 있는 굵기로 보여 주고, ② 그냥 끌면 목록이 스크롤되며,
 * ③ 자리 이동(재정렬)은 3초 이상 누른 뒤 끌 때만 시작한다. 끄면 원본 동작 그대로.
 */
export const TOUCH_MODE_KEY = 'custom_show_scrollbars'

let enabled = false
const listeners = new Set<() => void>()

export function applyTouchMode(on: boolean): void {
  enabled = on
  document.documentElement.dataset.customScrollbars = on ? 'on' : 'off'
  for (const listener of listeners) listener()
}

export async function hydrateTouchMode(): Promise<void> {
  const { value } = await window.nais.invoke('settings:get', { key: TOUCH_MODE_KEY })
  applyTouchMode(value === '1')
}

export function useTouchMode(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => enabled
  )
}

type Activation = { distance: number } | { delay: number; tolerance: number }

/** 목록 재정렬(dnd-kit) 시작 조건 — 평소엔 원본대로 조금 끌면 시작, 터치·원격 모드에선 길게 누른 뒤 */
export function useSortActivation(distance: number): Activation {
  return useTouchMode()
    ? { delay: TOUCH_REORDER_HOLD_MS, tolerance: TOUCH_MOVE_TOLERANCE_PX }
    : { distance }
}

/** 끌어서 스크롤하면 안 되는 곳 — 글자 입력, 슬라이더, 그리기 캔버스 */
const NO_DRAG_SCROLL =
  'input,textarea,select,canvas,[contenteditable="true"],[role="slider"],[data-no-drag-scroll]'

function scrollableAncestor(start: Element | null): HTMLElement | null {
  for (let el = start; el instanceof HTMLElement; el = el.parentElement) {
    const style = getComputedStyle(el)
    const y = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
    const x = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1
    if (x || y) return el
  }
  return null
}

/** 스크롤바 위를 누른 것인지 (스크롤바는 브라우저가 직접 끈다) */
function onScrollbar(el: HTMLElement, e: PointerEvent): boolean {
  const rect = el.getBoundingClientRect()
  return (
    e.clientX > rect.left + el.clientLeft + el.clientWidth ||
    e.clientY > rect.top + el.clientTop + el.clientHeight
  )
}

/**
 * 끌어서 스크롤 — 마우스(원격 접속의 터치는 마우스로 들어온다)로 목록을 누른 채 끌면 그 목록을 넘긴다.
 * 길게 누른 뒤의 드래그는 건드리지 않는다(자리 이동). 모드가 꺼져 있으면 아무것도 하지 않는다.
 */
export function bindDragScroll(): () => void {
  let session: {
    el: HTMLElement
    id: number
    x: number
    y: number
    left: number
    top: number
    at: number
    mode: 'wait' | 'scroll' | 'reorder'
  } | null = null
  let swallowClick = false

  const onDown = (e: PointerEvent): void => {
    session = null
    swallowClick = false
    if (!enabled || e.button !== 0 || e.pointerType === 'touch') return
    const target = e.target instanceof Element ? e.target : null
    if (!target || target.closest(NO_DRAG_SCROLL)) return
    const el = scrollableAncestor(target)
    if (!el || onScrollbar(el, e)) return
    session = {
      el,
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
      at: e.timeStamp,
      mode: 'wait'
    }
  }
  const onMove = (e: PointerEvent): void => {
    if (!session || e.pointerId !== session.id) return
    const dx = e.clientX - session.x
    const dy = e.clientY - session.y
    if (session.mode === 'wait') {
      session.mode = dragIntent(e.timeStamp - session.at, Math.hypot(dx, dy))
    }
    if (session.mode !== 'scroll') return
    session.el.scrollLeft = session.left - dx
    session.el.scrollTop = session.top - dy
  }
  const onUp = (e: PointerEvent): void => {
    if (!session || e.pointerId !== session.id) return
    // 스크롤하다 뗀 자리의 항목이 눌리지 않게 — 이어지는 클릭 한 번을 삼킨다
    swallowClick = session.mode === 'scroll'
    session = null
  }
  const onClick = (e: MouseEvent): void => {
    if (!swallowClick) return
    swallowClick = false
    e.preventDefault()
    e.stopPropagation()
  }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onUp, true)
  window.addEventListener('click', onClick, true)
  return () => {
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onUp, true)
    window.removeEventListener('click', onClick, true)
  }
}
