import { create } from 'zustand'
import { WATCH_AUTOGEN_KEY } from '@shared/custom-watch'

/**
 * [custom] 불러온 씬 자동 생성 — 켜면 감시 폴더가 추가하거나 바꾼 씬을 바로 1장씩 생성한다.
 * 값은 settings에 있고, 설정 > 저장의 스위치·타이틀바 `자동 생성` 버튼·요청 파일
 * (`{"action": "autoGenerate", "enabled": true}`)이 함께 바꾼다. 요청 파일로 바뀌면 알림을 받아 맞춘다.
 */
interface AutoGenState {
  enabled: boolean
  /** 감시 폴더가 켜져 있는지 — 꺼져 있으면 자동 생성은 쓰이지 않아 타이틀바 버튼을 숨긴다 */
  watching: boolean
  /** 켜고 끄고 저장 (설정 스위치·타이틀바 버튼) */
  setEnabled: (enabled: boolean) => void
  toggle: () => void
  /** 다른 곳에서 이미 저장한 값을 화면에만 맞춘다 (요청 파일) */
  sync: (enabled: boolean) => void
  setWatching: (watching: boolean) => void
  hydrate: () => Promise<void>
}

export const useAutoGenStore = create<AutoGenState>((set, get) => ({
  enabled: false,
  watching: false,
  setEnabled: (enabled) => {
    set({ enabled })
    void window.nais.invoke('settings:set', { key: WATCH_AUTOGEN_KEY, value: enabled ? '1' : '0' })
  },
  toggle: () => get().setEnabled(!get().enabled),
  sync: (enabled) => set({ enabled }),
  setWatching: (watching) => set({ watching }),
  hydrate: async () => {
    const [setting, watch] = await Promise.all([
      window.nais.invoke('settings:get', { key: WATCH_AUTOGEN_KEY }),
      window.nais.invoke('custom:watchGet', undefined)
    ])
    set({ enabled: setting.value === '1', watching: watch.enabled })
  }
}))
