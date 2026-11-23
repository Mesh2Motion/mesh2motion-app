/// <reference types="vite/client" />
import { mark_error } from '../lib/StartupDiagnostics.ts'
import { display_fatal_startup_error } from '../lib/WebGLStartup.ts'
import { NewAnimationWorkspace } from './newAnimationWorkspace.ts'

try {
  const workspace = new NewAnimationWorkspace()
  void workspace.start()
} catch (error) {
  mark_error('new-animation-startup', error instanceof Error ? error.message : String(error))
  display_fatal_startup_error(error instanceof Error ? error : new Error(String(error)))
}
