import { RigConfig } from './RigConfig.ts'

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
    solid_background_enabled: false
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
      <a href="${nav_links.support_href}" target="_blank">💗</a>
      <a href="${nav_links.github_href}" target="_blank">
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
            <span class="material-symbols-outlined">play_arrow</span>
          </button>

          <span>
            <span id="current-time">0f</span> /
            <span id="total-time">0f</span>
          </span>

          <input type="range" id="animation-scrubber" min="0" max="100" step="any" value="0" disabled />

          <div id="skeleton-toggle" class="styled-checkbox icon-toggle">
            <input type="checkbox" id="show-skeleton-checkbox" name="show-skeleton" value="show" style="display: none" />
            <label for="show-skeleton-checkbox" data-tippy-content="Show skeleton" tabindex="0" style="border-radius: 0">
              <img src="../images/icons/bone-display.svg" class="action-icon" alt="Show skeleton" style="user-select: none" />
            </label>
          </div>
        </div>
      </div>
    `
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
          <span class="material-symbols-outlined">settings</span>
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
   * Populate a <select> with one <option> per animation file across all rigs.
   * A placeholder option is always inserted first.
   */
  static populate_animation_file_select (select: HTMLSelectElement): void {
    // configure the select
    select.innerHTML = ''
    const placeholder = document.createElement('option')
    placeholder.value = ''

    // create first default option as placeholder/instructions
    placeholder.textContent = 'Pick a 3d animation to generate previews'
    select.appendChild(placeholder)

    // create all available animation options from GLB files in rig config
    for (const rig of RigConfig.all) {
      for (const file of rig.animation_files) {
        const option = document.createElement('option')
        option.value = file
        // derive a readable label from the filename, e.g. 'human-base-animations.glb' -> 'Human Base Animations'
        const label = file
          .replace(/\.\.\/animations\//i, '')
          .replace(/\.glb$/i, '')
          .split('-')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
        option.textContent = label
        select.appendChild(option)
      }
    }
  }
}
