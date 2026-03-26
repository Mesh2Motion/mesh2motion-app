import {
  type Bone,
  BufferGeometry,
  Object3D
} from 'three'

import { Utility } from '../Utilities.js'
import { SkeletonType } from '../enums/SkeletonType.js'
import { HeadWeightCorrector } from './HeadWeightCorrector.js'
import { WeightCalculator } from './WeightCalculator.js'
import { WeightSmoother } from './WeightSmoother.js'
import { WeightNormalizer } from './WeightNormalizer.js'

/**
 * SkinningAlgorithm
 * Orchestrates the bone weight calculation pipeline:
 * 1. Calculate initial bone weights (WeightCalculator)
 * 2. Smooth boundary weights (WeightSmoother)
 * 3. Normalize weights to sum to 1.0 (WeightNormalizer)
 * 4. Apply head weight correction if enabled (HeadWeightCorrector)
 * 5. Optionally render debug visualizations (SolverDebugVisualizer)
 */
export default class SkinningAlgorithm {
  private bones_master_data: Bone[] = []
  private geometry: BufferGeometry = new BufferGeometry()
  private show_debug: boolean = false
  private skeleton_type: SkeletonType | null = null
  private debugging_scene_object: Object3D = new Object3D()

  // Head weight correction properties
  private use_head_weight_correction: boolean = false
  private preview_plane_height: number = 1.4

  constructor (bone_hier: Object3D, skeleton_type: SkeletonType) {
    this.skeleton_type = skeleton_type
    this.bones_master_data = Utility.bone_list_from_hierarchy(bone_hier)
  }

  public set_geometry (geom: BufferGeometry): void {
    this.geometry = geom
  }

  public set_show_debug (debug_value: boolean): void {
    this.show_debug = debug_value
  }

  public set_debugging_scene_object (scene_object: Object3D): void {
    this.debugging_scene_object = scene_object
  }

  public set_head_weight_correction_enabled (enabled: boolean): void {
    this.use_head_weight_correction = enabled
  }

  public set_preview_plane_height (height: number): void {
    this.preview_plane_height = height
  }

  public calculate_indexes_and_weights (): number[][] {
    const skin_indices: number[] = []
    const skin_weights: number[] = []

    // Step 1: Calculate initial bone-to-vertex weight assignments
    const weight_calculator = new WeightCalculator(this.bones_master_data, this.geometry, this.skeleton_type)
    weight_calculator.initialize_caches()

    console.time('calculate_closest_bone_weights')
    weight_calculator.calculate_median_bone_weights(skin_indices, skin_weights)

    // Step 2: Smooth weight boundaries between adjacent bones
    const weight_smoother = new WeightSmoother(this.geometry)
    weight_smoother.smooth_bone_weight_boundaries(skin_indices, skin_weights)
    console.timeEnd('calculate_closest_bone_weights')

    // Step 4: Normalize weights so all vertices sum to 1.0
    const weight_normalizer = new WeightNormalizer(this.geometry)
    weight_normalizer.normalize_weights(skin_weights)

    // Step 5: Apply head weight correction if enabled
    if (this.use_head_weight_correction) {
      const head_weight_corrector = new HeadWeightCorrector(
        this.geometry,
        this.bones_master_data,
        this.preview_plane_height
      )
      console.log('applying the head weight correction...')
      head_weight_corrector.apply_head_weight_correction(skin_indices, skin_weights)
    }

    console.log('do we have any leftover incorrect weights ', weight_normalizer.find_vertices_with_incorrect_weight_sum(skin_weights))

    return [skin_indices, skin_weights]
  }
}
