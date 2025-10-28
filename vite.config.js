const isCodeSandbox = 'SANDBOX_URL' in process.env || 'CODESANDBOX_HOST' in process.env

import { resolve } from 'path'
import { customBaseUrlToHtml } from './src/lib/BaseUrl'

// allows us to use external shaders files to be imported into our materials
import glsl from 'vite-plugin-glsl'

//~ import { loadEnv } from 'vite' //for BASE_URL to be loaded in customBaseUrltoHtml
// Plugin to replace custom variable in static HTML files
//~ const customBaseUrlToHtml = (base) => ({
    //~ name: 'custom-base-url-to-html',
    //~ transformIndexHtml: {
        //~ order: 'pre',
        //~ handler(html) {
            //~ return html.replace(
                //~ /%BASE_URL_NO_TRAILING_SLASH%/g,
                //~ base.replace(/\/+$/g, '')
            //~ );
        //~ }
    //~ }
//~ });


export default {
  root: 'src/',
  publicDir: '../static/',
  base: './',
  server:
    {
      host: true,
      open: !isCodeSandbox // Open if it's not a CodeSandbox
    },
  build:
    {
      outDir: '../dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/index.html'),
          create: resolve(__dirname, 'src/create.html')
        }
      }
    },
  plugins:
    [
      customBaseUrlToHtml(),
      glsl(),
    ]
}
