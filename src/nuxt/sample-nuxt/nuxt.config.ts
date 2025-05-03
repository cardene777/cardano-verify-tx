// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  runtimeConfig: {
    BLOCKFROST_PROJECT_ID: process.env.BLOCKFROST_PROJECT_ID,
    MNEMONIC: process.env.MNEMONIC,
    API_URL: process.env.API_URL
  }
})
