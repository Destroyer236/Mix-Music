<template>
  <div class="ui-platform-accounts">
    <div class="ui-platform-toolbar"><router-link to="/list?id=love"><UiIcon name="heart" filled /><span>红心音乐 <strong>{{ platformSnapshot.favorites.length }}</strong></span><UiIcon name="chevronRight" /></router-link><button type="button" class="studio-settings-button" :disabled="platformLoading || platformBusy.size > 0 || !syncableAccounts.length" @click="syncPlatforms()"><UiIcon name="refresh" />同步全部</button></div>
    <p v-if="platformLoading" class="ui-platform-status" role="status">正在检查账号…</p>
    <div v-if="platformError" class="ui-platform-error" role="alert">{{ platformError }}</div>
    <article v-for="account in accounts" :key="account.platform" class="ui-platform-account">
      <div class="ui-platform-avatar" :class="account.platform"><img v-if="account.profile?.avatar" :src="account.profile.avatar" alt="" referrerpolicy="no-referrer" @error="hideAvatar"><UiIcon v-else name="music" /></div>
      <div class="ui-platform-info"><h3>{{ account.name }}<span :class="{ connected: account.connected }">{{ account.connected ? '已连接' : account.profile ? '登录已过期' : '未连接' }}</span></h3><p>{{ account.profile?.nickname || '尚未登录' }}<span v-if="account.profile?.extra?.phone" class="ui-platform-phone">{{ maskPhone(account.profile.extra.phone) }}</span><span v-if="account.profile?.vip" class="ui-platform-vip">{{ vipText(account.profile.vip) }}</span></p><small v-if="account.lastSync">{{ account.count }} 首红心 · {{ playlistCount(account.platform) }} 份歌单 · {{ formatTime(account.lastSync) }}{{ account.connected ? '' : ' · 离线记录' }}</small><small v-else-if="account.connected">尚未同步音乐库</small><p v-if="account.notice" class="ui-platform-account-notice">{{ account.notice }}</p><p v-if="account.error" class="ui-platform-account-error" role="status">{{ account.error }}</p><p v-if="account.platform === 'kugouConcept' && vipNotice" class="ui-platform-account-notice" role="status">{{ vipNotice }}</p></div>
      <div class="ui-platform-actions"><button v-if="account.connected" type="button" class="studio-settings-button" :disabled="account.canSync === false || platformBusy.has(account.platform)" @click="syncPlatforms(account.platform)"><UiIcon name="refresh" />{{ platformBusy.has(account.platform) ? '处理中…' : account.canSync === false ? '不支持云同步' : '同步音乐库' }}</button><button v-if="account.connected && account.platform === 'kugouConcept'" type="button" class="studio-settings-button" :disabled="vipBusy" :title="'领取酷狗概念版每日畅听会员，并升级为概念会员'" @click="claimVip"><UiIcon name="check" />{{ vipBusy ? '领取中…' : '领取会员' }}</button><button v-else-if="!account.connected" type="button" class="studio-settings-button primary" :disabled="platformLoading || platformBusy.has(account.platform)" @click="loginPlatform(account.platform)"><UiIcon name="arrowUpRight" />{{ platformBusy.has(account.platform) ? '正在打开…' : account.canSync === false ? '打开官网登录' : account.profile ? '重新登录' : '登录' }}</button><button v-if="!account.connected && (account.platform === 'qq' || account.platform === 'migu')" type="button" class="studio-settings-button" :disabled="platformLoading || platformBusy.has(account.platform)" :title="account.platform === 'qq' ? '打开 QQ 音乐官方登录页，支持账号密码或微信扫码' : '打开咪咕官网登录页'" @click="loginPlatformWeb(account.platform)"><UiIcon name="arrowUpRight" />官网登录</button><button v-if="account.profile" type="button" class="studio-settings-button" :disabled="platformBusy.has(account.platform)" @click="confirmLogout(account)">退出</button></div>
    </article>
    <UiModal :show="Boolean(logoutAccount)" title="退出平台账号" @close="logoutAccount = null"><p class="ui-dialog-note">退出 {{ logoutAccount?.name }} 后，此平台的同步红心将从聚合列表移除。你主动保存的本地收藏会继续保留。</p><template #footer><button type="button" class="ui-dialog-button" @click="logoutAccount = null">取消</button><button type="button" class="ui-dialog-button ui-dialog-button-primary" @click="logout">退出账号</button></template></UiModal>
    <QishuiLogin />
    <BodianLogin />
    <NativePlatformLogin />
    <MiguPhoneLogin />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PlatformAccount } from '@common/platformAccounts'
import { platformNames } from '@common/platformAccounts'
import { claimKugouVip, connectedPlatforms, loginPlatform, loginPlatformWeb, logoutPlatform, platformBusy, platformError, platformLoading, platformSnapshot, syncPlatforms } from '../services/platformAccounts'
import UiIcon from './UiIcon.vue'
import UiModal from './UiModal.vue'
import QishuiLogin from './QishuiLogin.vue'
import BodianLogin from './BodianLogin.vue'
import NativePlatformLogin from './NativePlatformLogin.vue'
import MiguPhoneLogin from './MiguPhoneLogin.vue'

const fallback: PlatformAccount[] = (Object.keys(platformNames) as Array<PlatformAccount['platform']>).map(platform => ({ platform, name: platformNames[platform], connected: false, profile: null, lastSync: null, count: 0, error: '' }))
const accounts = computed(() => {
  const remote = platformSnapshot.value.accounts
  return [...fallback.map(account => remote.find(item => item.platform === account.platform) ?? account), ...remote.filter(account => !(account.platform in platformNames))]
})
const playlistCount = (platform: PlatformAccount['platform']) => platformSnapshot.value.playlists?.filter(playlist => playlist.platform === platform).length ?? 0
const syncableAccounts = computed(() => connectedPlatforms.value.filter(account => account.canSync !== false))
const logoutAccount = ref<PlatformAccount | null>(null)
const vipBusy = ref(false)
const vipNotice = ref('')
async function claimVip() {
  if (vipBusy.value) return
  vipBusy.value = true
  vipNotice.value = ''
  try {
    const result = await claimKugouVip(true)
    const parts: string[] = []
    // 领取与升级各自可能因「今日已领」「条件未满足」而不生效，分开陈述。
    parts.push(result.received ? (result.rewardedHours > 0 ? `已领取 ${result.rewardedHours} 小时畅听会员` : '已领取畅听会员') : result.message)
    if (result.upgraded) parts.push('已升级为概念会员')
    else if (result.upgradeMessage) parts.push(result.upgradeMessage)
    vipNotice.value = parts.filter(Boolean).join(' · ')
    if (result.received || result.upgraded) await syncPlatforms('kugouConcept')
  } catch (error) {
    vipNotice.value = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '领取失败，请稍后重试'
  } finally { vipBusy.value = false }
}
// 平台返回的时间可能是秒级、字符串或无效值；统一兜底，避免一条脏数据让整个卡片渲染失败。
const toDate = (value: unknown): Date | null => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  // 秒级时间戳（< 1e12）先换算成毫秒。
  const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric)
  return Number.isNaN(date.getTime()) ? null : date
}
const formatTime = (time: unknown) => {
  const date = toDate(time)
  if (!date) return '时间未知'
  try { return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return date.toISOString().slice(5, 16).replace('T', ' ') }
}
const vipText = (vip: NonNullable<PlatformAccount['profile']>['vip']) => {
  if (!vip) return ''
  const date = toDate(vip.dueDate)
  if (!date) return vip.label
  try { return `${vip.label} · ${date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })}到期` } catch { return `${vip.label} · ${date.toISOString().slice(0, 10)}到期` }
}
// 平台已脱敏的（如波点 187******24）原样展示；完整号码遮中间四位。
const maskPhone = (phone: string) => phone.includes('*') ? phone : phone.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2')
const hideAvatar = (event: Event) => { (event.target as HTMLImageElement).style.visibility = 'hidden' }
const confirmLogout = (account: PlatformAccount) => { logoutAccount.value = account }
async function logout() { const account = logoutAccount.value; logoutAccount.value = null; if (account) await logoutPlatform(account.platform) }
</script>

<style lang="less">
.ui-platform-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 17px; border-bottom: 1px solid var(--modern-border); > a { display: flex; align-items: center; gap: 9px; color: var(--modern-accent-ink); text-decoration: none; font-size: 12px; svg { width: 17px; height: 17px; } strong { font-weight: 500; margin-left: 6px; } } }
.ui-platform-account { display: flex; align-items: center; gap: 15px; padding: 24px 0; border-bottom: 1px solid var(--modern-border); }
.ui-platform-avatar { width: 46px; height: 46px; display: grid; place-items: center; flex: none; background: var(--modern-hover); color: var(--modern-accent-ink); border-radius: 8px; overflow: hidden; img { width: 100%; height: 100%; object-fit: cover; } > svg { width: 23px; height: 23px; } }
.ui-platform-info { min-width: 0; flex: 1; h3 { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; line-height: 1.7; span { font-size: 10px; font-weight: 400; color: var(--modern-muted); &.connected { color: var(--modern-accent-ink); } } } > p { font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; color: var(--modern-muted); } > small { display: block; margin-top: 3px; font-size: 10px; line-height: 1.8; color: var(--modern-muted); } > .ui-platform-account-notice { margin-top: 5px; font-size: 10px; } > .ui-platform-account-error { color: #c66666; font-size: 11px; margin-top: 5px; } }
.ui-platform-vip { display: inline-block; margin-left: 8px; padding: 1px 6px; border-radius: 4px; font-size: 10px; line-height: 1.5; color: #a87614; background: rgba(212, 160, 23, .13); border: 1px solid rgba(212, 160, 23, .32); white-space: nowrap; }
.ui-platform-phone { margin-left: 7px; font-size: 11px; color: var(--modern-muted); opacity: .85; }
.ui-platform-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; justify-content: flex-end; flex: none; }
.ui-platform-status { font-size: 11px; color: var(--modern-muted); margin-top: 15px; }
.ui-platform-error { font-size: 11px; line-height: 1.8; color: #c66666; padding: 12px 0; }
@media (max-width: 850px) { .ui-platform-account { flex-wrap: wrap; gap: 12px; } .ui-platform-actions { width: 100%; padding-left: 58px; box-sizing: border-box; justify-content: flex-start; } }
</style>
