
// Store descriptors rather than bundling third-party executable code.
// These links are fetched through the existing isolated script loading path.
const source = (key: string, name: string, version: string, author = ''): LX.UserApi.UserApiInfoFull => ({
  id: `user_api_default_${key}`,
  name,
  description: '默认音源，首次使用时下载并缓存脚本',
  version,
  author,
  homepage: 'https://github.com/pdone/lx-music-source',
  script: '',
  scriptUrl: `https://raw.githubusercontent.com/pdone/lx-music-source/main/${key}/latest.js`,
  allowShowUpdateAlert: false,
})

export const userApis: LX.UserApi.UserApiInfoFull[] = [
  source('qdy', '全豆要聚合音源', '9.3'),
  source('sixyin', '六音音源', 'v1.2.1', '六音'),
  source('lx', '独家音源', '6', 'w'),
  source('flower', '野花🌷', '1'),
  source('huibq', 'Huibq_lxmusic源', 'v1.2.0'),
  source('juhe', '聚合API接口 (CF)', '3'),
]
