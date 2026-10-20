<template>
  <div class="ui-search-artists-results" :class="{ 'is-single': groups.length === 1 }">
    <article v-for="group in groups" :key="group.key" class="ui-search-artist-card" :class="{ 'is-selected': isSelected(group) }">
      <div class="ui-search-artist-header">
        <button type="button" class="ui-search-artist-identity" :aria-label="`查看歌手 ${group.name} 的作品`" @click="emit('open', activeEntry(group))">
          <span class="ui-search-artist-portrait"><TrackArtwork :src="activeEntry(group).img"><template #fallback><UiIcon name="micVocal" /></template></TrackArtwork></span>
          <span class="ui-search-artist-description"><span class="ui-search-artist-meta">歌手<span aria-hidden="true">·</span>{{ platforms(group).length }} 个平台</span><strong>{{ group.name }}</strong><span class="ui-search-artist-caption">{{ platformLabel(activeEntry(group).source) }}<template v-if="activeEntry(group).count"> · {{ activeEntry(group).count?.toLocaleString() }} 首作品</template></span></span>
        </button>
        <div class="ui-search-artist-platforms">
          <div class="ui-search-artist-source-heading">
            <span class="ui-search-artist-source-label">选择作品来源</span>
            <UiSelect v-if="variants(group).length > 1" class="ui-search-artist-versions" :model-value="entryKey(activeEntry(group))" :options="variants(group).map((entry, index) => ({ value: entryKey(entry), label: `同名条目 ${index + 1}` }))" :aria-label="`${group.name}在${platformLabel(activeEntry(group).source)}的同名条目`" @change="selectVariant(group, $event)" />
            <button v-else-if="!isSelected(group)" type="button" class="ui-search-artist-open" :aria-label="`查看 ${group.name} 的作品列表`" @click="emit('open', activeEntry(group))">查看作品<UiIcon name="arrowRight" /></button>
          </div>
          <div class="ui-search-artist-sources" role="group" :aria-label="`${group.name} 的平台作品`">
            <button v-for="platform in platforms(group)" :key="platform.source" type="button" :class="{ active: isSelected(group) && selected?.source === platform.source }" :aria-pressed="isSelected(group) && selected?.source === platform.source" :aria-label="`查看 ${group.name} 在${platformLabel(platform.source)}的作品`" @click="emit('open', platform.entries.find(entry => entry.id === selected?.id && entry.source === selected?.source) ?? platform.entries[0])">{{ platformLabel(platform.source) }}</button>
          </div>
        </div>
      </div>
    </article>
  </div>
</template>
<script setup lang="ts">
import { sourceNames } from '@renderer/store'
import UiIcon from './UiIcon.vue'
import TrackArtwork from './TrackArtwork.vue'
import UiSelect from './UiSelect.vue'
import type { CatalogEntry } from '../services/catalogSearch'
import type { ArtistGroup } from '../artistResults'
const props = defineProps<{ groups: Array<ArtistGroup<CatalogEntry>>, selected: CatalogEntry | null }>()
const emit = defineEmits<{ open: [entry: CatalogEntry] }>()
const activeEntry = (group: ArtistGroup<CatalogEntry>) => group.entries.find(item => item.id === props.selected?.id && item.source === props.selected.source) ?? group.entries[0]
const isSelected = (group: ArtistGroup<CatalogEntry>) => group.entries.some(item => item.id === props.selected?.id && item.source === props.selected.source)
const platformLabel = (source: LX.OnlineSource) => sourceNames.value[source]
const entryKey = (entry: CatalogEntry) => `${entry.source}:${entry.id}`
const platforms = (group: ArtistGroup<CatalogEntry>) => [...new Set(group.entries.map(entry => entry.source))].map(source => ({ source, entries: group.entries.filter(entry => entry.source === source) }))
const variants = (group: ArtistGroup<CatalogEntry>) => group.entries.filter(entry => entry.source === activeEntry(group).source)
function selectVariant(group: ArtistGroup<CatalogEntry>, key: string | number) {
  const entry = group.entries.find(entry => entryKey(entry) === key)
  if (entry) emit('open', entry)
}
</script>
