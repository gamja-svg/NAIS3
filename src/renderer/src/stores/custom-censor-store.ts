import { create } from 'zustand'

/**
 * [custom] 검열(흰칠) 화면 상태.
 * - revs: 칠한 그림은 같은 파일을 다시 쓰므로, 저장할 때마다 번호를 올려 화면이 새 그림을 다시 읽게 한다.
 * - modelPercent: 콕 찍기 모델을 받는 정도 (null = 받는 중 아님)
 * - on: 검수 모드에서 검열을 켰는지 — 씬·프리셋을 넘겨도, 검수를 닫았다 열어도 유지된다 (앱을 끄면 꺼진다)
 */
interface CensorState {
  on: boolean
  toggle: () => void
  revs: Record<string, number>
  modelPercent: number | null
  bump: (filePath: string) => void
  setModelPercent: (percent: number) => void
}

export const useCensorStore = create<CensorState>((set) => ({
  on: false,
  toggle: () => set((s) => ({ on: !s.on })),
  revs: {},
  modelPercent: null,
  bump: (filePath) =>
    set((s) => ({ revs: { ...s.revs, [filePath]: (s.revs[filePath] ?? 0) + 1 } })),
  setModelPercent: (percent) => set({ modelPercent: percent >= 100 ? null : percent })
}))

/** 칠한 그림을 다시 읽게 주소 끝에 번호를 붙인다 (번호가 없으면 주소 그대로) */
export function withCensorRev(url: string, rev: number | undefined): string {
  return rev ? `${url}&v=${rev}` : url
}

/** 모델 받는 정도 알림을 받는다 */
export function bindCensorEvents(): () => void {
  return window.nais.on('custom:censorModel', ({ percent }) =>
    useCensorStore.getState().setModelPercent(percent)
  )
}
