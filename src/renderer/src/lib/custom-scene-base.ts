import { useEffect, useState } from 'react'
import type { Scene } from '@shared/types'

type SceneBase = { prompt: string; negativePrompt: string }

/**
 * [custom] 미생성인 씬이 바뀌기 전 내용 — 바뀐 태그를 노랗게 칠하는 기준. 미생성이 아니면 null.
 * 내용을 고친 직후에는 메인이 기준을 적어 둔 뒤에 묻도록 조금 기다린다.
 */
export function useSceneBase(
  scene: Pick<Scene, 'id' | 'pending' | 'prompt' | 'negativePrompt'>
): SceneBase | null {
  const [base, setBase] = useState<{ id: number; value: SceneBase | null } | null>(null)
  useEffect(() => {
    if (!scene.pending || window.nais.runtime === 'browser') return
    let cancelled = false
    const timer = setTimeout(() => {
      window.nais
        .invoke('custom:sceneBase', { id: scene.id })
        .then((value) => {
          if (!cancelled) setBase({ id: scene.id, value })
        })
        .catch(() => {})
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [scene.id, scene.pending, scene.prompt, scene.negativePrompt])
  return scene.pending && base?.id === scene.id ? base.value : null
}
