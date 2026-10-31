import { RigConfig } from './RigConfig.ts'
import {
  BoneNamingStructure,
  ExportContents,
  ExportFormat,
  FbxExportPreset
} from './processes/export-to-file/DownloadSettings.ts'

interface RangeSettingConfig {
  min: string
  max: string
  value: string
  step: string
}

interface SettingsDefaultsConfig {
  light_intensity: RangeSettingConfig
  turntable_speed: RangeSettingConfig
  floor_grid_enabled: boolean
  solid_background_enabled: boolean
}

interface TopNavLinksConfig {
  support_href: string
  github_href: string
  github_icon_src: string
}

interface DownloadControlConfig {
  export_button_id: string
  download_icon_src: string
  tooltip: string
}

export class DOMUtilities {
  static readonly top_nav_links: TopNavLinksConfig = {
    support_href: 'https://support.mesh2motion.org',
    github_href: 'https://github.com/scottpetrovic/mesh2motion-app',
    github_icon_src: '../images/github-white-icon.png'
  }

  static readonly settings_defaults: SettingsDefaultsConfig = {
    light_intensity: {
      min: '0.1',
      max: '2.0',
      value: '1.0',
      step: '0.01'
    },
    turntable_speed: {
      min: '0',
      max: '8',
      value: '0',
      step: '0.1'
    },
    floor_grid_enabled: true,
    solid_background_enabled: true
  }

  static readonly download_control_defaults: DownloadControlConfig = {
    export_button_id: 'export-button',
    download_icon_src: 'images/icons/download.svg',
    tooltip: 'Exporting will combine all selected animations into a single downloadable file.'
  }

  /**
   * Render shared top-right navigation links into the provided mount element.
   */
  static populate_top_nav_links (mount: HTMLElement): void {
    const nav_links = DOMUtilities.top_nav_links

    // Keep mount behavior consistent with original inline nav structure.
    mount.style.display = 'inline-flex'
    mount.style.alignItems = 'center'

    mount.innerHTML = `
      <a href="#" id="learn-link">Learn</a>
      <a href="#" id="attribution-link">Contributors</a>
      <a href="${nav_links.support_href}" id="nav-support-mesh2motion" target="_blank">💗</a>
      <a href="${nav_links.github_href}" id="nav-github" target="_blank">
        <img src="${nav_links.github_icon_src}" width="24" height="24" alt="GitHub" />
      </a>
      <span id="settings-dropdown-mount"></span>
    `
  }

  /**
   * Render shared viewport mouse control hints into the provided mount element.
   */
  static populate_header_controls (mount: HTMLElement): void {
    mount.innerHTML = `
      <div id="header-ui">
        <div>
          <img class="nav-icon" src="/images/mouse-left.svg" style="vertical-align: middle" />
          Rotate
        </div>

        <div>
          <img class="nav-icon" src="/images/mouse-right.svg" style="vertical-align: middle" />
          Pan
        </div>

        <div>
          <img class="nav-icon" src="/images/mouse-middle.svg" style="vertical-align: middle" />
          Zoom
        </div>
      </div>
    `
  }

  /**
   * Render shared animation player controls into the provided mount element.
   */
  static populate_animation_player (mount: HTMLElement): void {
    mount.innerHTML = `
      <div id="animation-player">
        <div id="current-animation-container">
          <span id="current-animation-name">No animation selected</span>
        </div>

        <div id="play-controls">
          <button id="play-pause-button" class="animation-control-button" disabled>
             <img src="../images/icons/play.svg" alt="Play" width="14" height="14" />
          </button>

          <span>
            <span id="current-time">0f</span> /
            <span id="total-time">0f</span>
          </span>

          <input type="range" id="animation-scrubber" min="0" max="100" step="any" value="0" disabled />

          <div id="skeleton-toggle" class="styled-checkbox icon-toggle">
            <input type="checkbox" id="show-skeleton-checkbox" name="show-skeleton" value="show" style="display: none" />
            <label for="show-skeleton-checkbox" data-tippy-content="Show skeleton" tabindex="0" style="border-radius: 0; padding: 0.4rem;">
              <img src="../images/icons/bone-display.svg" class="action-icon" alt="Show skeleton" style="user-select: none" />
            </label>
          </div>

          <div id="wireframe-toggle" class="styled-checkbox icon-toggle">
            <input type="checkbox" id="wireframe-checkbox" name="wireframe" value="wireframe" style="display: none" />
            <label for="wireframe-checkbox" data-tippy-content="Toggle wireframe" tabindex="0" style="border-radius: 0; padding: 0.4rem;">
              <img src="../images/icons/wireframe.svg" class="action-icon" alt="Toggle wireframe" style="user-select: none" />
            </label>
          </div>
        </div>
      </div>
    `
  }

  /**
   * Render the shared "Expand / Contract Arms" controls into the provided mount element.
   * Shared by the create workflow and the retarget workflow, so icon paths are
   * root-absolute to work from both /create.html and /retarget/index.html.
   */
  static populate_arm_extension_controls (mount: HTMLElement): void {
    mount.innerHTML = `
      <div id="arm-extension-options">
        <div style="display: flex; flex-direction: row; align-items: center; gap: 1rem; justify-content: center;">
          <label style="display: inline-flex">Expand / Contract Arms</label>

          <img src="/images/icons/help.svg" alt="Help" width="20" height="20"
            data-tippy-content="Fine-tune arm spread across all animations for heavier or skinnier characters." />

          <button class="secondary-button" id="reset-arm-extension-button"
            aria-label="Reset arm extension" data-tippy-content="Reset">
            <img src="/images/icons/reset.svg" alt="Reset Arm Extension" width="20" height="20" />
          </button>
        </div>

        <div style="display: flex; flex-direction: row; gap: 1rem; justify-content: flex-start; align-items: center;">
          <input type="number" id="extend-arm-numeric-input" name="arm-extend-input"
            value="0" step="1" />
          <span class="suffix-unit">%</span>
          <input id="extend-arm-range-input" style="flex-grow: 1" type="range"
            min="-120" max="20" value="0" />
        </div>

        <hr />
      </div>
    `
  }

  /**
   * Render the shared export/download button, settings split toggle, and hidden link.
   * Page-specific button IDs and icon paths are resolved from the current route.
   */
  static populate_download_control (mount: HTMLElement): void {
    const control_config = DOMUtilities.get_download_control_config()

    mount.innerHTML = `
      <div class="download-combo">
        <button id="${control_config.export_button_id}" data-tippy-content="${control_config.tooltip}">
          <span class="button-icon-group">
            <img src="${control_config.download_icon_src}" alt="Download" width="16" height="16" />
            <span>Download <span id="animation-selection-count">0</span></span>
          </span>
        </button>

        ${DOMUtilities.get_download_settings_markup()}
      </div>

      <a id="download-hidden-link" href="#" style="display:none"></a>
    `
  }

  private static get_download_settings_markup (): string {
    const dropdown_icon_src = DOMUtilities.get_download_settings_icon_src()

    return `
      <div id="download-settings-popup" class="download-settings-popup-container">
        <button
          id="download-settings-toggle"
          class="download-split-toggle"
          type="button"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-controls="download-settings"
          data-tippy-content="Download options"
          aria-label="Open download options"
        >
          <img src="${dropdown_icon_src}" alt="dropdown" width="16" height="16" />
        </button>

        <div id="download-settings" class="download-settings-panel" role="dialog" aria-label="Download settings" hidden>
          <span class="download-settings-header">Download Options</span>

          <div id="download-bone-naming-section" class="options-container">
            <span class="download-settings-label">Bone Naming Pattern</span>
            <fieldset id="download-bone-naming-group" class="toggle" aria-label="Bone naming structure">
              ${DOMUtilities.get_bone_naming_options_markup()}
            </fieldset>
          </div>

          <div class="options-container">
            <span class="download-settings-label">File Format</span>
            <fieldset id="download-export-format-group" class="toggle" aria-label="Export format">
              ${DOMUtilities.get_export_format_options_markup()}
            </fieldset>
          </div>

          <div id="download-fbx-preset-section" class="options-container" hidden>
            <span class="download-settings-label">FBX Preset</span>
            <fieldset id="download-fbx-preset-group" class="toggle" aria-label="FBX export preset">
              ${DOMUtilities.get_fbx_preset_options_markup()}
            </fieldset>
          </div>

          <div class="options-container">
            <span class="download-settings-label">Contents</span>
            <fieldset id="download-export-contents-group" class="toggle" aria-label="Export contents">
              ${DOMUtilities.get_export_contents_options_markup()}
            </fieldset>
          </div>
        </div>
      </div>
    `
  }

  private static get_download_control_config (): DownloadControlConfig {
    const defaults = DOMUtilities.download_control_defaults

    if (DOMUtilities.is_retarget_page()) {
      return {
        export_button_id: 'export-retargeting-button',
        download_icon_src: '../images/icons/download.svg',
        tooltip: defaults.tooltip
      }
    }

    return defaults
  }

  private static get_download_settings_icon_src (): string {
    if (DOMUtilities.is_retarget_page()) {
      return '../images/icons/arrow-dropdown.svg'
    }

    return 'images/icons/arrow-dropdown.svg'
  }

  private static get_fbx_preset_options_markup (): string {
    const default_fbx_preset = DOMUtilities.get_default_fbx_preset()

    return Object.values(FbxExportPreset).map((fbx_preset) => {
      const preset_id = `fbx-preset-${fbx_preset}`
      const preset_label = DOMUtilities.get_download_option_label(fbx_preset)
      const is_checked = fbx_preset === default_fbx_preset ? ' checked' : ''

      return `
              <input type="radio" id="${preset_id}" name="fbx-export-preset" value="${fbx_preset}"${is_checked}>
              <label for="${preset_id}">${preset_label}</label>
      `
    }).join('')
  }

  private static get_bone_naming_options_markup (): string {
    const default_bone_naming_structure = DOMUtilities.get_default_bone_naming_structure()

    return Object.values(BoneNamingStructure).map((bone_naming_structure) => {
      const option_id = `bone-naming-${bone_naming_structure}`
      const option_label = DOMUtilities.get_download_option_label(bone_naming_structure)
      const is_checked = bone_naming_structure === default_bone_naming_structure ? ' checked' : ''

      return `
              <input type="radio" id="${option_id}" name="bone-naming-structure" value="${bone_naming_structure}"${is_checked}>
              <label for="${option_id}">${option_label}</label>
      `
    }).join('')
  }

  private static get_export_format_options_markup (): string {
    const default_export_format = DOMUtilities.get_default_export_format()

    return Object.values(ExportFormat).map((export_format) => {
      const option_id = `export-format-${export_format}`
      const option_label = DOMUtilities.get_download_option_label(export_format)
      const is_checked = export_format === default_export_format ? ' checked' : ''

      return `
              <input type="radio" id="${option_id}" name="export-format" value="${export_format}"${is_checked}>
              <label for="${option_id}">${option_label}</label>
      `
    }).join('')
  }

  private static get_export_contents_options_markup (): string {
    const default_export_contents = DOMUtilities.get_default_export_contents()

    return Object.values(ExportContents).map((export_contents) => {
      const option_id = `export-contents-${export_contents}`
      const option_label = DOMUtilities.get_download_option_label(export_contents)
      const is_checked = export_contents === default_export_contents ? ' checked' : ''

      return `
              <input type="radio" id="${option_id}" name="export-contents" value="${export_contents}"${is_checked}>
              <label for="${option_id}">${option_label}</label>
      `
    }).join('')
  }

  private static get_default_bone_naming_structure (): BoneNamingStructure {
    return DOMUtilities.get_first_enum_value(BoneNamingStructure)
  }

  private static get_default_export_format (): ExportFormat {
    return DOMUtilities.get_first_enum_value(ExportFormat)
  }

  private static get_default_export_contents (): ExportContents {
    return DOMUtilities.get_first_enum_value(ExportContents)
  }

  private static get_default_fbx_preset (): FbxExportPreset {
    return DOMUtilities.get_first_enum_value(FbxExportPreset)
  }

  private static get_first_enum_value<T extends string> (enum_object: Record<string, T>): T {
    const enum_values = Object.values(enum_object)
    if (enum_values.length === 0) {
      throw new Error('Enum has no values')
    }

    return enum_values[0]
  }

  private static get_download_option_label (value: string): string {
    const custom_labels: Partial<Record<string, string>> = {
      threejs: 'Three.js',
      fbx: 'FBX 7.4',
      glb: 'GLB',
      full: 'Default',
      skeleton: 'Skeleton + Animations'
    }

    const custom_label = custom_labels[value]
    if (custom_label !== undefined) {
      return custom_label
    }

    return value
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase())
  }

  private static is_retarget_page (): boolean {
    const path_name = window.location.pathname.toLowerCase()
    return path_name.includes('/retarget/')
  }

  /**
   * Render shared nav settings dropdown markup into the provided mount element.
   */
  static populate_settings_dropdown (mount: HTMLElement): void {
    const defaults = DOMUtilities.settings_defaults

    // Nested settings mount should not introduce block-flow wrapping.
    mount.style.display = 'inline-flex'
    mount.style.alignItems = 'center'

    mount.innerHTML = `
      <div id="settings-dropdown-container" class="nav-dropdown">
        <button id="settings-toggle" class="nav-icon-button" aria-expanded="false" aria-controls="settings-dropdown-content" aria-haspopup="true" aria-label="Open settings">
          
        <img src="/images/icons/settings.svg" alt="Settings" width="30" height="30" />
        
        </button>

        <div id="settings-dropdown-content" class="nav-dropdown-content" hidden>
          <button id="theme-toggle" class="settings-dropdown-row">
            <span class="theme-icon"></span>
            <span class="theme-label"></span>
          </button>

          <div class="settings-dropdown-row light-intensity-setting">
            <label for="light-intensity-input">Light intensity</label>
            <input type="range" id="light-intensity-input" min="${defaults.light_intensity.min}" max="${defaults.light_intensity.max}" value="${defaults.light_intensity.value}" step="${defaults.light_intensity.step}" />
          </div>

          <div class="settings-dropdown-row">
            <label for="turntable-speed-input">Turntable</label>
            <input type="range" id="turntable-speed-input" min="${defaults.turntable_speed.min}" max="${defaults.turntable_speed.max}" value="${defaults.turntable_speed.value}" step="${defaults.turntable_speed.step}" />
          </div>

          <div class="settings-dropdown-row">
            <label for="floor-grid-toggle">Show floor grid</label>
            <input type="checkbox" id="floor-grid-toggle" ${defaults.floor_grid_enabled ? 'checked' : ''} />
          </div>

          <div class="settings-dropdown-row">
            <label for="solid-background-toggle">Solid background</label>
            <input type="checkbox" id="solid-background-toggle" ${defaults.solid_background_enabled ? 'checked' : ''} />
          </div>
        </div>
      </div>
    `
  }

  /**
   * Populate a <select> with one <option> per rig using model display names.
   * Existing options are replaced.
   */
  static populate_model_select (select: HTMLSelectElement): void {
    select.innerHTML = ''

    // also import some custom models that are not the default models for a rig like an A-pose version of human
    const custom_models = [
      {
        model_file: 'test-files/bone-correction-tests/human-a-pose.glb',
        display_name: 'Human (A-Pose)'
      }
    ]

    // combine all the rigs with the custom models needed
    const model_options = [
      ...RigConfig.all.map((rig) => {
        return {
          model_file: rig.model_file,
          display_name: rig.rig_display_name
        }
      }),
      ...custom_models
    ]

    // build out HTML options
    for (const custom of model_options) {
      const option = document.createElement('option')
      option.value = custom.model_file
      option.textContent = custom.display_name
      select.appendChild(option)
    }
  }

  /**
   * Populate a <select> with one <option> per rig using skeleton display names.
   * Pass `include_placeholder = false` to omit the "Select a skeleton" entry.
   * Existing options are replaced.
   */
  static populate_skeleton_select (select: HTMLSelectElement, include_placeholder = true): void {
    select.innerHTML = ''
    if (include_placeholder) {
      const placeholder = document.createElement('option')
      placeholder.value = 'select-skeleton'
      placeholder.textContent = 'Select a skeleton'
      select.appendChild(placeholder)
    }
    for (const rig of RigConfig.all) {
      const option = document.createElement('option')
      option.value = rig.skeleton_type
      option.textContent = rig.rig_display_name
      select.appendChild(option)
    }
  }

  /** Video Preview HTML generation for Rig selection
   * Populate a <select> with one <option> per rig. Previews are generated for every animation of the selected rig.
   * A placeholder option is always inserted first.
   */
  static populate_animation_rig_select (select: HTMLSelectElement): void {
    // configure the select
    select.innerHTML = ''
    const placeholder = document.createElement('option')
    placeholder.value = ''

    // create first default option as placeholder/instructions
    placeholder.textContent = 'Pick a rig to generate animation previews'
    select.appendChild(placeholder)

    for (const rig of RigConfig.all) {
      const option = document.createElement('option')
      option.value = rig.skeleton_type
      option.textContent = `${rig.rig_display_name} (${rig.animations.length} animations)`
      select.appendChild(option)
    }
  }
}
