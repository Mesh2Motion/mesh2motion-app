import { Mesh2MotionEngine } from './Mesh2MotionEngine'
import { mark, mark_error } from './lib/StartupDiagnostics.ts'
import { display_fatal_startup_error } from './lib/WebGLStartup.ts'
import { maybe_attach_desktop_control } from './control/attachControl.ts'

export class CustomModelUploadBootstrap {
  private readonly mesh2motion_engine: Mesh2MotionEngine

  constructor () {
    this.mesh2motion_engine = new Mesh2MotionEngine()
    maybe_attach_desktop_control(this.mesh2motion_engine, { page: 'create' })
  }
}

// instantiate the class to setup event listeners
try {
  const app = new CustomModelUploadBootstrap()
  mark('bootstrap:custom-model:ok')
} catch (error) {
  mark_error('bootstrap:custom-model', error)
  display_fatal_startup_error(error)
}
