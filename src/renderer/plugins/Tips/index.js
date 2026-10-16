import tips from './Tips'
import { debounce } from '@common/utils'

let instance
let prevTips
let prevX = 0
let prevY = 0
let isDraging = false

const getTipText = el => {
  return el.getAttribute('aria-label') && el.getAttribute('ignore-tip') == null ? el.getAttribute('aria-label') : null
}

const getTips = el => {
  if (!(el instanceof window.Element)) return null
  // Song titles provide their own full-title/details popup. Keep the enclosing
  // play button's aria-label accessible without displaying another tooltip.
  if (el.closest('.ui-track-title-text')) return null
  // A title on the hovered element or its ancestor already supplies a native
  // tooltip. Keep aria-label for accessibility without showing a second tip.
  if (el.closest('[title]')?.getAttribute('title')?.trim()) return null
  for (let current = el; current && current !== document.documentElement; current = current.parentElement) {
    const text = getTipText(current)
    if (text) return text
  }
  return null
}

const showTips = debounce(event => {
  if (isDraging) return
  let msg = getTips(event.target)?.trim()
  if (!msg) return
  prevTips = msg
  instance = tips({
    message: msg,
    autoCloseTime: 10000,
    position: {
      top: event.y + 12,
      left: event.x + 8,
    },
  }, {
    beforeClose(closeInstance) {
      if (instance !== closeInstance) return
      prevTips = null
      instance = null
    },
  })
}, 400)

const hideTips = () => {
  if (!instance) return
  instance.cancel()
}

const setTips = tips => {
  if (!instance) return
  instance.setTips(tips)
}

const updateTips = event => {
  if (isDraging) return
  if (!instance) return showTips(event)
  setTimeout(() => {
    let msg = getTips(event.target)
    if (!msg) return hideTips()
    if (prevTips === msg) return
    setTips(msg)
    prevTips = msg
  })
}

setTimeout(() => {
  document.body.addEventListener('mousemove', event => {
    if ((event.x == prevX && event.y == prevY) || isDraging) return
    prevX = event.x
    prevY = event.y
    hideTips()
    showTips(event)
  })

  document.body.addEventListener('click', updateTips)

  document.body.addEventListener('contextmenu', updateTips)

  window.app_event.on('focus', () => {
    hideTips()
  })
  window.app_event.on('dragStart', () => {
    isDraging = true
    hideTips()
  })
  window.app_event.on('dragEnd', () => {
    isDraging = false
  })
})
