import { useEffect } from 'react'
import type { Scene } from '@shared/types'
import { useScenesStore } from '../stores/scenes-store'

/** 같은 자리를 이 시간·거리 안에 다시 누르면 더블클릭 — 원격 접속의 더블탭은 조금 늦고 어긋나게 들어온다 */
const DOUBLE_MS = 450
const DOUBLE_PX = 40
/** 두 번째 누름에 딸린 이벤트(떼기·클릭)를 이만큼 삼킨다 */
const SWALLOW_MS = 1000

let lastClick: { sceneId: number; x: number; y: number; at: number } | null = null

/** 씬 카드 클릭(상세 열기)을 기억한다. 대표 이미지가 없는 씬은 검수 모드로 열 것이 없어 기억하지 않는다 */
export function noteSceneCardClick(scene: Scene, e: { clientX: number; clientY: number }): void {
  lastClick = scene.thumbnailPath
    ? { sceneId: scene.id, x: e.clientX, y: e.clientY, at: performance.now() }
    : null
}

/**
 * [custom] 씬 카드 더블클릭(더블탭) = 그 씬부터 검수 모드.
 * 첫 클릭은 평소처럼 바로 상세를 연다 (한 번 누르기가 늦어지지 않게). 곧바로 같은 자리를 다시 누르면
 * 그 누름은 상세 화면에 넘기지 않고, 상세를 닫고 그 씬부터 검수 모드를 연다.
 */
export function useSceneCardDoubleClick(): void {
  useEffect(() => {
    let swallowUntil = 0
    const swallow = (e: Event): void => {
      if (performance.now() > swallowUntil) return
      e.preventDefault()
      e.stopPropagation()
    }
    const onDown = (e: PointerEvent): void => {
      swallowUntil = 0
      const prev = lastClick
      lastClick = null
      if (!prev || e.button !== 0 || !e.isPrimary) return
      const now = performance.now()
      if (now - prev.at > DOUBLE_MS) return
      if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > DOUBLE_PX) return
      swallowUntil = now + SWALLOW_MS
      e.preventDefault()
      e.stopPropagation()
      // 상세를 닫는다 — 열자마자 닫는 것이라 뒤로 가기 기록은 남기지 않는다
      useScenesStore.setState({
        selectedId: null,
        images: [],
        imagesTotal: 0,
        imagesLoading: false,
        reviewSceneId: prev.sceneId
      })
    }
    const swallowed = ['mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'] as const
    window.addEventListener('pointerdown', onDown, true)
    for (const type of swallowed) window.addEventListener(type, swallow, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      for (const type of swallowed) window.removeEventListener(type, swallow, true)
    }
  }, [])
}
