import { computed, ref, onBeforeUnmount } from '@common/utils/vueTools'
import { setting } from '@lyric/store/state'
import { onMouseEnterLeave } from '@lyric/utils/ipc'

export default () => {
  const isMouseEnter = ref(false)

  const isHoverHide = computed(() => {
    return setting['desktopLyric.isHoverHide'] && isMouseEnter.value
  })

  const handleMouseMove = (event: MouseEvent) => {
    // Locked windows use native cursor coordinates, since transparent areas
    // need not receive DOM hover events and toggling click-through emits leave.
    if (setting['desktopLyric.isLock']) return
    const card = document.querySelector('.lyric-window-card')
    if (!card) return
    const { left, top, right, bottom } = card.getBoundingClientRect()
    isMouseEnter.value = event.clientX >= left && event.clientX < right && event.clientY >= top && event.clientY < bottom
  }
  const handleMouseLeave = () => {
    if (setting['desktopLyric.isLock']) return
    isMouseEnter.value = false
  }

  const removeMouseEnterLeaveListener = onMouseEnterLeave(({ params: isEnter }) => {
    isMouseEnter.value = isEnter
  })
  document.body.addEventListener('mousemove', handleMouseMove)
  document.body.addEventListener('mouseleave', handleMouseLeave)

  onBeforeUnmount(() => {
    removeMouseEnterLeaveListener()
    document.body.removeEventListener('mousemove', handleMouseMove)
    document.body.removeEventListener('mouseleave', handleMouseLeave)
  })

  return { isHoverHide, isMouseEnter }
}
