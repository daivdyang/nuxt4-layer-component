export default defineNuxtConfig({
    extends: [
        '..'
    ],
    // 只放「測試時才需要」的設定，例如 devtools、eslint
    devtools: { enabled: true }
})