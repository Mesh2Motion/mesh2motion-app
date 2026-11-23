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
      // bundled JS/CSS go here instead of the default 'assets', which is the asset library folder in static/
      assetsDir: 'bundle',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'src/index.html'),
          create: resolve(import.meta.dirname, 'src/create.html'),
          retarget: resolve(import.meta.dirname, 'src/retarget/index.html'),
          composer: resolve(import.meta.dirname, 'src/composer/index.html'),
          'new-animation': resolve(import.meta.dirname, 'src/newAnimation/index.html'),
          // Developer-only internal camera harness; deliberately not linked in the UI.
          'pose-inspect': resolve(import.meta.dirname, 'src/authoringObservation/inspect.html')
        }
      }
    },
  plugins:
    [
      glsl()
    ]
})
