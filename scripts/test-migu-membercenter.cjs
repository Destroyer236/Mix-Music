const { app, session } = require('electron')
const path = require('node:path')
app.setPath('userData', path.join(__dirname, '..', 'artifacts', 'user-test-data'))
app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition('persist:linkline-account-migu')
    const cookies = Object.fromEntries((await ses.cookies.get({ url: 'https://music.migu.cn/' })).map(c => [c.name, c.value]))
    const headers = new Headers({
      Referer: 'https://music.migu.cn/', Origin: 'https://music.migu.cn',
      channel: '014X031', subchannel: '014X031', appId: 'h5', platform: 'H5',
      ua: 'Android_migu', version: '6.8.8', IMEI: 'h5page', IMSI: 'h5page',
      uid: cookies.mg_auth_uid ?? '', pacmtoken: cookies.mg_auth_pacmtoken ?? '',
      timestamp: String(Date.now()), 'Content-Type': 'application/json;charset=UTF-8',
    })
    const response = await ses.fetch('https://c.musicapp.migu.cn/user/member/center/v3.0', { headers, credentials: 'include', signal: AbortSignal.timeout(20000) })
    const json = await response.json()
    console.log('HTTP', response.status, 'code:', json.code)
    const cards = json.data?.memberCards ?? []
    for (const card of cards) {
      console.log('card:', card.cardMemberIdentity?.name, '|', card.cardMemberIdentity?.identityFullPinYin)
      for (const item of card.identityItems ?? []) {
        console.log('  identity:', item.name, item.identityFullPinYin)
        for (const mi of item.memberItems ?? []) {
          console.log('    memberItem:', JSON.stringify({ name: mi.name, notInForce: mi.notInForce, payType: mi.payType, validTime: mi.validTime }))
        }
      }
    }
    if (!cards.length) console.log('memberCards 为空，原始 data 键:', Object.keys(json.data ?? {}))
  } catch (error) { console.error('失败:', error.message) } finally { app.quit() }
})
