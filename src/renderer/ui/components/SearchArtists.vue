<template>
  <div class="ui-search-artists-results" :class="{ 'is-single': groups.length === 1 }">
    <article v-for="group in groups" :key="group.key" class="ui-search-artist-card">
      <button type="button" class="ui-search-artist-identity" :aria-label="`查看歌手 ${group.name} 的作品`" @click="emit('open', activeEntry(group))">
        <span class="ui-search-artist-portrait"><TrackArtwork :src="activeEntry(group).img" /></span>
        <span class="ui-search-artist-description"><small>歌手</small><strong>{{ group.name }}</strong><span>{{ platformCount(group) }} 个平台的结果</span></span>
        <UiIcon name="arrowRight" />
      </button>
      <div class="ui-search-artist-sources" role="group" :aria-label="`${group.name} 的平台作品`">
        <button v-for="entry in group.entries" :key="`${entry.source}:${entry.id}`" type="button" :class="{ active: selected?.source === entry.source && selected?.id === entry.id }" :aria-pressed="selected?.source === entry.source && selected?.id === entry.id" :aria-label="`查看 ${group.name} 在${platformLabel(entry.source)}的作品${duplicateLabel(group, entry)}`" @click="emit('open', entry)"><UiIcon v-if="selected?.source === entry.source && selected?.id === entry.id" name="check" />{{ platformLabel(entry.source) }}{{ duplicateLabel(group, entry) }}</button>
      </div>
    </article>
  </div>
</template>
<script setup lang="ts">
import { sourceNames } from '@renderer/store'
import UiIcon from './UiIcon.vue'
import TrackArtwork from './TrackArtwork.vue'
import type { CatalogEntry } from '../services/catalogSearch'
import type { ArtistGroup } from '../artistResults'
const props = defineProps<{ groups: Array<ArtistGroup<CatalogEntry>>, selected: CatalogEntry | null }>()
const emit = defineEmits<{ open: [entry: CatalogEntry] }>()
const activeEntry = (group: ArtistGroup<CatalogEntry>) => group.entries.find(item => item.id === props.selected?.id && item.source === props.selected.source) ?? group.entries[0]
const platformLabel = (source: LX.OnlineSource) => sourceNames.value[source]
const platformCount = (group: ArtistGroup<CatalogEntry>) => new Set(group.entries.map(item => item.source)).size
const duplicateLabel = (group: ArtistGroup<CatalogEntry>, entry: CatalogEntry) => {
  const entries = group.entries.filter(item => item.source === entry.source)
  return entries.length > 1 ? ` ${entries.indexOf(entry) + 1}` : ''
}
</script>
