import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function emitted_imports (source_path: string): string[] {
  const source = readFileSync(resolve(process.cwd(), source_path), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText

  return Array.from(output.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g), match => match[1])
}

describe('type-only dependency edges', () => {
  it('keeps engine-facing step and listener contracts out of runtime imports', () => {
    expect(emitted_imports('src/lib/processes/weight-painting/StepWeightPainting.ts')).toContain('../../UI.ts')
    expect(emitted_imports('src/lib/processes/weight-painting/StepWeightPainting.ts'))
      .not.toContain('../../../Mesh2MotionEngine.ts')
    expect(emitted_imports('src/lib/EventListeners.ts')).toContain('./enums/ModelPreviewDisplay')
    expect(emitted_imports('src/lib/EventListeners.ts'))
      .not.toContain('../Mesh2MotionEngine')
  })

  it('keeps retargeter/additive type references out of runtime imports', () => {
    expect(emitted_imports('src/retarget/human-retargeting/Retargeter.ts')).toContain('three')
    expect(emitted_imports('src/retarget/human-retargeting/Retargeter.ts'))
      .not.toContain('./ChainTwistAdditive')
    expect(emitted_imports('src/retarget/human-retargeting/ChainTwistAdditive.ts')).toContain('./Quat')
    expect(emitted_imports('src/retarget/human-retargeting/ChainTwistAdditive.ts'))
      .not.toContain('./Retargeter')
  })
})
