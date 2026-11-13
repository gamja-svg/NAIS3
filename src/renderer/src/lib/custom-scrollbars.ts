/**
 * [custom] 스크롤바 표시 — 원본은 목록의 스크롤바를 숨겨 휠로만 넘길 수 있다. 휠이 없는 환경
 * (원격 접속·터치)에서도 넘길 수 있게, 켜면 숨긴 스크롤바를 잡아 끌 수 있는 굵기로 보여 준다.
 */
export const SHOW_SCROLLBARS_KEY = 'custom_show_scrollbars'

export function applyShowScrollbars(on: boolean): void {
  document.documentElement.dataset.customScrollbars = on ? 'on' : 'off'
}

export async function hydrateShowScrollbars(): Promise<void> {
  const { value } = await window.nais.invoke('settings:get', { key: SHOW_SCROLLBARS_KEY })
  applyShowScrollbars(value === '1')
}
