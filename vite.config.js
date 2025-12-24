import { resolve } from 'path'
import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl' // allows us to use external shaders files to be imported into our materials

const is_code_sandbox = 'SANDBOX_URL' in process.env || 'CODESANDBOX_HOST' in process.env

export default defineConfig({
  root: 'src/',
  publicDir: '../static/',
  base: './',
  define: {
    // expose all Cloudflare environment variables to client from window object
    PROCESS_ENV: JSON.stringify(process.env || 'unknown')
  },
  server:
    {
      host: true,
      open: !is_code_sandbox // Open window if it's not a CodeSandbox
    },
  build:
    {
      outDir: '../dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/index.html'),
          create: resolve(__dirname, 'src/create.html'),
          retarget: resolve(__dirname, 'src/retarget/index.html')
        }
      }
    },
  plugins:
    [
      glsl()
    ]
})
