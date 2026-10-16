import { createApp } from 'vue'

import App from './App.vue'

import '@root/common/error'
import { initializeExternal } from './core/externalState'

window.ELECTRON_DISABLE_SECURITY_WARNINGS = process.env.ELECTRON_DISABLE_SECURITY_WARNINGS

void initializeExternal().then(() => { createApp(App).mount('#root') })
