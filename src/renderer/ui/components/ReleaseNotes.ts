import { defineComponent, h, type VNode } from 'vue'
import { openUrl } from '@common/utils/electron'
import { parseReleaseNotes, type ReleaseNoteNode } from '../services/releaseNotes'

const renderNode = (node: string | ReleaseNoteNode): string | VNode => {
  if (typeof node === 'string') return node
  const props = node.href ? {
    href: node.href,
    rel: 'noopener noreferrer',
    onClick(event: MouseEvent) {
      event.preventDefault()
      void openUrl(node.href!)
    },
  } : node.start !== undefined ? { start: node.start } : null
  return h(node.tag, props, node.children.map(renderNode))
}

export default defineComponent({
  name: 'ReleaseNotes',
  props: { text: { type: String, required: true } },
  setup(props) {
    return () => h('div', { class: 'linkline-update-release-body' }, parseReleaseNotes(props.text).map(renderNode))
  },
})
