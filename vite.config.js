const isCodeSandbox = 'SANDBOX_URL' in process.env || 'CODESANDBOX_HOST' in process.env

import { resolve } from 'path'
import { customBaseUrlToHtml } from './src/lib/BaseUrl'

// allows us to use external shaders files to be imported into our materials
import glsl from 'vite-plugin-glsl'

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
      customBaseUrlToHtml(base),
      glsl(),
    ]
}
