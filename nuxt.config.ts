// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite"
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  modules:[
    '@tresjs/nuxt',
  ],

  css: [
    '~/assets/css/main.css'
  ],

  vite:{
    plugins: [
      tailwindcss(),
    ]
  },
  devtools: { enabled: true }
})
