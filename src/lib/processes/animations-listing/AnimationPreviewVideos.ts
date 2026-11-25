import { type SkeletonType } from '../../enums/SkeletonType'
import { RigConfig } from '../../RigConfig'

/**
 * Looping MP4 previews for library animations. Lists can hold hundreds of animations and only so many
 * videos can play at once, so placeholders are only turned into videos once they scroll into view.
 */
export class AnimationPreviewVideos {
  private observer: IntersectionObserver | null = null

  /**
   * URL of the preview video for a library animation. Custom imports have no preview.
   * @returns null if the rig is not in RigConfig
   */
  static preview_src (skeleton_type: SkeletonType, theme_name: string, animation_name: string): string | null {
    const preview_folder: string | undefined = RigConfig.by_skeleton_type(skeleton_type)?.animation_preview_folder
    if (preview_folder === undefined) {
      console.error('Unknown skeleton type for animation previews. Add the rig to RigConfig.ts.')
      return null
    }
    return `../animpreviews/${preview_folder}/${theme_name}_${animation_name}.mp4`
  }

  static create_video (src: string, width: number = 100, height: number = 120): HTMLVideoElement {
    const video = document.createElement('video')
    video.className = 'anim-preview'
    video.width = width
    video.height = height
    video.loop = true
    video.muted = true
    video.playsInline = true // tells mobile browsers to play inline instead of going fullscreen
    video.autoplay = true
    void AnimationPreviewVideos.assign_src(video, src)
    return video
  }

  /**
   * WebKitGTK on Linux refuses to load `<video>` from a custom URI scheme (such as
   * Tauri's `tauri://` protocol) at all, independent of headers - a confirmed WebKitGTK
   * bug (https://bugs.webkit.org/show_bug.cgi?id=328909), not something fixable from
   * the app or Tauri side. Fetching the bytes ourselves and handing the element a
   * blob: URL works around it, and behaves the same as a direct src everywhere else.
   */
  private static async assign_src (video: HTMLVideoElement, src: string): Promise<void> {
    try {
      const response = await fetch(src)
      const blob = await response.blob()
      video.src = URL.createObjectURL(blob)
    } catch (error) {
      console.error('Failed to load animation preview video:', src, error)
    }
  }

  /**
   * Watches every '.anim-preview-placeholder' with a data-src in the container and swaps in a
   * video once it comes into view. Stops watching any placeholders from a previous call.
   */
  public observe_placeholders (container: HTMLElement): void {
    this.disconnect()

    this.observer = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        const placeholder = entry.target as HTMLElement

        // abort if animation entry is outside active viewing area (but don't unload - causes popping)
        if (!entry.isIntersecting || placeholder.querySelector('video') !== null) {
          return
        }

        const src = placeholder.getAttribute('data-src')
        if (src === null || src === '') {
          return
        }

        placeholder.innerHTML = ''
        placeholder.appendChild(AnimationPreviewVideos.create_video(src))
      })
    }, { rootMargin: '300px' }) // rootMargin pre-loads videos before they scroll into view to reduce popping

    container.querySelectorAll('.anim-preview-placeholder').forEach((placeholder) => {
      this.observer?.observe(placeholder)
    })
  }

  public disconnect (): void {
    this.observer?.disconnect()
    this.observer = null
  }
}
