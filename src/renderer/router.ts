import { createRouter, createWebHashHistory } from 'vue-router'
import Discover from './ui/views/Discover.vue'
import Search from './ui/views/Search.vue'
import SongLists from './ui/views/SongLists.vue'
import SongListDetail from './ui/views/SongListDetail.vue'
import Charts from './ui/views/Charts.vue'
import Library from './ui/views/Library.vue'
import Downloads from './ui/views/Downloads.vue'
import Settings from './ui/views/Settings.vue'
import { LOCAL_LIBRARY_ID } from '@common/localMusic'
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/discover', name: 'Discover', component: Discover, meta: { name: 'Discover' } },
    { path: '/search', name: 'Search', component: Search, meta: { name: 'Search' } },
    { path: '/comment', name: 'Comments', component: async() => import('./ui/views/Comments.vue'), meta: { name: 'Comments' } },
    { path: '/songList', redirect: '/songList/list' },
    { path: '/songList/list', name: 'SongList', component: SongLists, meta: { name: 'SongList' } },
    { path: '/songList/detail', name: 'SongListDetail', component: SongListDetail, meta: { name: 'SongList' } },
    { path: '/leaderboard', name: 'Leaderboard', component: Charts, meta: { name: 'Leaderboard' } },
    { path: '/local', name: 'LocalMusic', component: async() => import('./ui/views/LocalMusic.vue'), meta: { name: 'LocalMusic' } },
    { path: '/list', name: 'List', component: Library, meta: { name: 'List' }, beforeEnter: to => to.query.id === LOCAL_LIBRARY_ID ? { path: '/local', replace: true } : undefined },
    { path: '/download', name: 'Download', component: Downloads, meta: { name: 'Download' } },
    { path: '/setting', name: 'Setting', component: Settings, meta: { name: 'Setting' } },
    { path: '/:pathMatch(.*)*', redirect: '/discover' },
  ],
  linkActiveClass: 'active-link',
  linkExactActiveClass: 'exact-active-link',
})
