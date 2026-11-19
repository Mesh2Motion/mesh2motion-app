import { type PropId } from '../PropId'
import { type PropSide } from '../PropSide'
import { type SkeletonType } from '../../../../enums/SkeletonType'
import { type PropMountOffset } from './PropMountOffset'

export interface PropDefinition {
  id: PropId
  display_name: string
  category: string // group shown in the prop picker, e.g. 'Swords'
  asset_path: string // relative to the static root
  preview_path: string // relative to the static root
  model_offset_y: number
  default_mount_offsets: Record<PropSide, PropMountOffset>
  rig_mount_offsets: Partial<Record<SkeletonType, Record<PropSide, PropMountOffset>>>
}
