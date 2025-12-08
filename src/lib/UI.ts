export class UI {
  private static instance: UI

  dom_current_step_index: HTMLElement | null = null
  dom_current_step_element: HTMLElement | null = null
  dom_load_model_tools: HTMLElement | null = null
  dom_upload_model_button: HTMLButtonElement | null = null
  dom_load_model_button: HTMLButtonElement | null = null
  dom_load_model_debug_checkbox: HTMLInputElement | null = null

  // load skeleton UI
  dom_rotate_model_x_button: HTMLButtonElement | null = null
  dom_rotate_model_y_button: HTMLButtonElement | null = null
  dom_rotate_model_z_button: HTMLButtonElement | null = null
  dom_move_model_to_floor_button: HTMLButtonElement | null = null

  dom_load_skeleton_tools: HTMLElement | null = null
  dom_load_skeleton_button: HTMLButtonElement | null = null
  dom_skeleton_edit_tools: HTMLElement | null = null
  dom_skeleton_drop_type: HTMLSelectElement | null = null
  dom_hand_skeleton_options: HTMLElement | null = null
  dom_hand_skeleton_selection: HTMLSelectElement | null = null
  dom_mirror_skeleton_checkbox: HTMLElement | null = null
  dom_scale_skeleton_button: HTMLButtonElement | null = null
  dom_undo_button: HTMLButtonElement | null = null
  dom_redo_button: HTMLButtonElement | null = null
  dom_bind_pose_button: HTMLButtonElement | null = null
  dom_scale_skeleton_input_box: HTMLElement | null = null
  dom_move_to_origin_button: HTMLButtonElement | null = null

  // scale skeleton contols
  dom_scale_skeleton_input: HTMLInputElement | null = null
  dom_scale_skeleton_percentage_display: HTMLElement | null = null
  dom_scale_skeleton_controls: HTMLElement | null = null
  dom_reset_skeleton_scale_button: HTMLButtonElement | null = null

  // edit skeleton UI step controls
  dom_selected_bone_label: HTMLElement | null = null
  dom_transform_type_radio_group: HTMLElement | null = null
  dom_transform_space_radio_group: HTMLElement | null = null

  // preview plane controls
  dom_use_head_weight_correction_container: HTMLElement | null = null
  dom_preview_plane_checkbox: HTMLInputElement | null = null
  dom_preview_plane_height_input: HTMLInputElement | null = null
  dom_preview_plane_height_label: HTMLElement | null = null
  dom_preview_plane_setting_container: HTMLElement | null = null

  dom_skinning_algorithm_selection: HTMLElement | null = null
  dom_skinned_mesh_tools: HTMLElement | null = null
  dom_skinned_mesh_animation_tools: HTMLElement | null = null
  dom_show_skeleton_checkbox: HTMLInputElement | null = null
  dom_back_to_edit_skeleton_button: HTMLButtonElement | null = null
  dom_back_to_load_skeleton_button: HTMLButtonElement | null = null
  dom_back_to_load_model_button: HTMLButtonElement | null = null
  dom_enable_skin_debugging: HTMLInputElement | null = null

  dom_mesh_preview_group: HTMLElement | null = null

  // animations listing UI controls
  dom_animation_clip_list: HTMLElement | null = null
  dom_export_button: HTMLButtonElement | null = null

  dom_mirror_animations_checkbox: HTMLInputElement | null = null
  dom_reset_a_pose_button: HTMLButtonElement | null = null

  // loading progress UI controls for animations
  dom_animation_progress_loader_container: HTMLElement | null = null
  dom_loading_progress_bar: HTMLElement | null = null
  dom_current_file_progress_bar: HTMLElement | null = null
  dom_loading_status_text: HTMLElement | null = null

  // Animation player controls
  dom_animation_player: HTMLElement | null = null
  dom_current_animation_name: HTMLElement | null = null
  dom_play_pause_button: HTMLButtonElement | null = null
  dom_animation_scrubber: HTMLInputElement | null = null
  dom_current_time: HTMLElement | null = null
  dom_total_time: HTMLElement | null = null

  dom_import_animations_button: HTMLButtonElement | null = null
  dom_extend_arm_range_input: HTMLInputElement | null = null
  dom_extend_arm_numeric_input: HTMLInputElement | null = null
  dom_a_pose_correction_options: HTMLElement | null = null
  dom_export_button_hidden_link: HTMLElement | null = null
  dom_animation_count: HTMLElement | null = null
  dom_animations_listing_count: HTMLElement | null = null

  dom_build_version: HTMLElement | null = null
  dom_attribution_link: HTMLAnchorElement | null = null

  private constructor () {
    this.initialize_dom_elements()
  }

  public static getInstance (): UI {
    if (UI.instance === undefined) {
      UI.instance = new UI()
    }
    return UI.instance
  }

  private initialize_dom_elements (): void {
    // grab all UI Elements from page that we need to interact with
    this.dom_current_step_index = document.querySelector('#current-step-index')
    this.dom_current_step_element = document.querySelector('#current-step-label')

    // UI controls for loading the model
    this.dom_load_model_tools = document.querySelector('#load-model-tools')
    this.dom_upload_model_button = document.querySelector('#model-upload')
    this.dom_load_model_button = document.querySelector('#load-model-button')
    this.dom_load_model_debug_checkbox = document.querySelector('#load-model-debug-checkbox')

    // UI controls with load skeleton step
    this.dom_rotate_model_x_button = document.querySelector('#rotate-model-x-button')
    this.dom_rotate_model_y_button = document.querySelector('#rotate-model-y-button')
    this.dom_rotate_model_z_button = document.querySelector('#rotate-model-z-button')
    this.dom_move_model_to_floor_button = document.querySelector('#move-model-to-floor-button')

    // UI controls for loading/working with skeleton
    this.dom_load_skeleton_tools = document.querySelector('#load-skeleton-tools')
    this.dom_load_skeleton_button = document.querySelector('#load-skeleton-button')
    this.dom_skeleton_edit_tools = document.querySelector('#skeleton-step-actions')
    this.dom_skeleton_drop_type = document.querySelector('#skeleton-selection')
    this.dom_hand_skeleton_options = document.querySelector('#hand-skeleton-options')
    this.dom_hand_skeleton_selection = document.querySelector('#hand-skeleton-selection')
    this.dom_mirror_skeleton_checkbox = document.querySelector('#mirror-skeleton')
    this.dom_scale_skeleton_button = document.querySelector('#scale-skeleton-button')
    this.dom_reset_skeleton_scale_button = document.querySelector('#reset-skeleton-scale-button')

    this.dom_undo_button = document.querySelector('#undo-button')
    this.dom_redo_button = document.querySelector('#redo-button')

    this.dom_selected_bone_label = document.querySelector('#edit-selected-bone-label')

    this.dom_transform_type_radio_group = document.querySelector('#transform-control-type-group')
    this.dom_transform_space_radio_group = document.querySelector('#transform-space-group')

    // preview plane controls
    this.dom_use_head_weight_correction_container = document.querySelector('#use-head-weight-correction-container')
    this.dom_preview_plane_checkbox = document.querySelector('#preview-plane-checkbox')
    this.dom_preview_plane_height_input = document.querySelector('#preview-plane-height-input')
    this.dom_preview_plane_height_label = document.querySelector('#preview-plane-height-label')
    this.dom_preview_plane_setting_container = document.querySelector('#preview-plane-setting-container')

    this.dom_bind_pose_button = document.querySelector('#action_bind_pose')
    // this.dom_scale_skeleton_input_box = document.querySelector('#scale-input')
    this.dom_move_to_origin_button = document.querySelector('#action_move_to_origin')
    this.dom_skinning_algorithm_selection = document.querySelector('#skinning-algorithm-options')

    this.dom_mesh_preview_group = document.querySelector('#mesh-preview-group')

    // scaling the skeleton option
    this.dom_scale_skeleton_input = document.querySelector('#scale-skeleton-input')
    this.dom_scale_skeleton_percentage_display = document.querySelector('#scale-skeleton-percentage-display')
    this.dom_scale_skeleton_controls = document.querySelector('#scale-skeleton-controls')

    // UI controls for working with skinned mesh
    this.dom_skinned_mesh_tools = document.querySelector('#skinned-step-tools')
    this.dom_skinned_mesh_animation_tools = document.querySelector('#skinned-step-animation-export-options')
    this.dom_show_skeleton_checkbox = document.querySelector('#show-skeleton-checkbox')
    this.dom_back_to_edit_skeleton_button = document.querySelector('#action_back_to_edit_skeleton')
    this.dom_back_to_load_skeleton_button = document.querySelector('#action_back_to_load_skeleton')
    this.dom_back_to_load_model_button = document.querySelector('#action_back_to_load_model')

    this.dom_enable_skin_debugging = document.querySelector('#debug-skinning-checkbox')

    // UI Controls for working with animation list/selection and export
    this.dom_animation_clip_list = document.querySelector('#animations-items')
    this.dom_export_button = document.querySelector('#export-button')
    this.dom_import_animations_button = document.querySelector('#mirror-animations-checkbox')
    this.dom_mirror_animations_checkbox = document.querySelector('#mirror-animations-checkbox')
    this.dom_reset_a_pose_button = document.querySelector('#reset-a-pose-button')

    // loading progress UI controls for animations
    this.dom_animation_progress_loader_container = document.querySelector('#animation-progress-loader-container')
    this.dom_loading_progress_bar = document.querySelector('#loading-progress-bar')
    this.dom_current_file_progress_bar = document.querySelector('#current-file-progress-bar')
    this.dom_loading_status_text = document.querySelector('#loading-status-text')

    // Animation player controls
    this.dom_animation_player = document.querySelector('#animation-player')
    this.dom_current_animation_name = document.querySelector('#current-animation-name')
    this.dom_play_pause_button = document.querySelector('#play-pause-button')
    this.dom_animation_scrubber = document.querySelector('#animation-scrubber')
    this.dom_current_time = document.querySelector('#current-time')
    this.dom_total_time = document.querySelector('#total-time')

    this.dom_extend_arm_range_input = document.querySelector('#extend-arm-range-input')
    this.dom_extend_arm_numeric_input = document.querySelector('#extend-arm-numeric-input')
    this.dom_a_pose_correction_options = document.querySelector('#a-pose-correction-options')

    this.dom_build_version = document.querySelector('#build-version')

    this.dom_attribution_link = document.querySelector('#attribution-link')

    // UI for exporting the animation
    this.dom_export_button_hidden_link = document.querySelector('#download-hidden-link')
    this.dom_animation_count = document.querySelector('#animation-selection-count')
    this.dom_animations_listing_count = document.querySelector('#animation-listing-count')
  }

  public hide_all_elements (): void {
    if (this.dom_load_model_tools != null) {
      this.dom_load_model_tools.style.display = 'none'
    }
    if (this.dom_load_skeleton_tools != null) {
      this.dom_load_skeleton_tools.style.display = 'none'
    }
    if (this.dom_skeleton_edit_tools != null) {
      this.dom_skeleton_edit_tools.style.display = 'none'
    }
    if (this.dom_skinned_mesh_tools != null) {
      this.dom_skinned_mesh_tools.style.display = 'none'
    }
    if (this.dom_skinned_mesh_animation_tools != null) {
      this.dom_skinned_mesh_animation_tools.style.display = 'none'
    }
  }
}
