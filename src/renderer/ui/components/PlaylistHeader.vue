<template>
  <header class="ui-playlist-header" :class="{ 'ui-playlist-header--compact': compact }">
    <div class="ui-playlist-header__cover"><slot name="cover"><UiIcon name="music" /></slot></div>
    <div class="ui-playlist-header__body">
      <div class="ui-playlist-header__title"><h1 :title="title">{{ title }}</h1><slot name="extra" /></div>
      <div class="ui-playlist-header__details" :aria-hidden="compact"><div><slot name="details" /></div></div>
      <div class="ui-playlist-header__bottom">
        <div class="ui-playlist-header__actions"><slot name="actions" /></div>
        <div v-if="$slots.tools" class="ui-playlist-header__tools"><slot name="tools" /></div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import UiIcon from './UiIcon.vue'
defineProps<{ title: string, compact: boolean }>()
</script>

<style lang="less">
.ui-shell .ui-playlist-header {
  --playlist-cover-size: 164px;
  --playlist-cover-compact: 80px;
  flex: none;
  display: flex;
  align-items: stretch;
  gap: 22px;
  padding-bottom: 20px;
  min-width: 0;
  .ui-playlist-header__cover {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--playlist-cover-size);
    height: var(--playlist-cover-size);
    overflow: hidden;
    border-radius: var(--ui-radius-cover, var(--modern-radius-small));
    color: var(--modern-accent-ink);
    background: var(--modern-accent-soft);
    box-shadow: var(--modern-shadow);
    transition: width .32s cubic-bezier(.22, 1, .36, 1), height .32s cubic-bezier(.22, 1, .36, 1);
    > img { width: 100%; height: 100%; object-fit: cover; }
    > svg { width: 48%; height: 48%; }
  }
  .ui-playlist-header__body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .ui-playlist-header__title { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .ui-playlist-header__title h1 {
    flex: 1;
    min-width: 0;
    margin: 2px 0 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--modern-text);
    font-size: 30px;
    font-weight: var(--ui-weight-page, 600);
    letter-spacing: 0;
    line-height: 1.4;
    transition: font-size .32s cubic-bezier(.22, 1, .36, 1);
  }
  .ui-playlist-header__details {
    display: grid;
    grid-template-rows: 1fr;
    opacity: 1;
    transform: translateY(0);
    transition: grid-template-rows .32s cubic-bezier(.22, 1, .36, 1), opacity .2s ease, transform .32s cubic-bezier(.22, 1, .36, 1);
    > div { min-height: 0; overflow: hidden; }
    p { margin: 9px 0 0; color: var(--modern-muted); font-size: 12px; line-height: 1.6; }
  }
  .ui-playlist-header__bottom { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 16px; margin-top: auto; padding-top: 18px; transition: padding-top .32s cubic-bezier(.22, 1, .36, 1); }
  .ui-playlist-header__actions, .ui-playlist-header__tools { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .ui-playlist-header__tools { flex: 1; justify-content: flex-end; }
  .ui-playlist-header__actions > button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 34px;
    padding: 8px 12px;
    border: 1px solid var(--modern-border);
    border-radius: var(--ui-radius-control, var(--modern-radius-small));
    color: var(--modern-text);
    background: var(--modern-panel);
    font: inherit;
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
    > svg { width: 15px; height: 15px; }
    &:hover { background: var(--modern-hover); }
    &:disabled { opacity: .4; cursor: default; }
    &.ui-playlist-header__primary { border-color: transparent; color: var(--modern-accent-contrast); background: var(--modern-accent); }
  }
  .ui-playlist-header__tools .ui-select { width: 124px; flex: none; }
  .ui-playlist-header__tools .ui-library-search { margin-left: 0; }
  &.ui-playlist-header--compact {
    .ui-playlist-header__cover { width: var(--playlist-cover-compact); height: var(--playlist-cover-compact); }
    .ui-playlist-header__title h1 { font-size: 21px; }
    .ui-playlist-header__details { grid-template-rows: 0fr; opacity: 0; transform: translateY(-6px); pointer-events: none; }
    .ui-playlist-header__bottom { padding-top: 8px; }
  }
}
@media (max-width: 1050px) {
  .ui-shell .ui-playlist-header { --playlist-cover-size: 148px; gap: 18px; }
  .ui-shell .ui-playlist-header__tools .ui-library-search { flex: 1; }
}
@media (max-width: 760px), (max-height: 650px) {
  .ui-shell .ui-playlist-header { --playlist-cover-size: 124px; --playlist-cover-compact: 68px; gap: 14px; padding-bottom: 15px; }
  .ui-shell .ui-playlist-header .ui-playlist-header__title h1 { font-size: 23px; }
  .ui-shell .ui-playlist-header.ui-playlist-header--compact .ui-playlist-header__title h1 { font-size: 19px; }
  .ui-shell .ui-playlist-header .ui-playlist-header__bottom { padding-top: 12px; gap: 8px; }
  .ui-shell .ui-playlist-header .ui-playlist-header__actions { gap: 6px; }
  .ui-shell .ui-playlist-header .ui-playlist-header__actions > button { padding: 7px 9px; min-height: 32px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-shell .ui-playlist-header :is(.ui-playlist-header__cover, .ui-playlist-header__title h1, .ui-playlist-header__details, .ui-playlist-header__bottom) { transition: none; }
}
</style>
