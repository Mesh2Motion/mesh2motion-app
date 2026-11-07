# Preview Generator

The goal of this preview generator is to create small animated clip previews to use in the animation listing. It is fully done in the web browser. So that is the only "tool" needed. It needs a browser with WebCodecs H.264 encoding (Chrome or Edge).


## Workflow

1. Go to the URL manually for the preview generator once the web server is started (command: npm run dev): http://localhost:5173/preview-generator/index.html
2. Select a 3d model that you want to generate animations from the drop-down.
3. The camera is automatically fit so every pose of every animation stays in view (backflips, jumps, etc.). Rotate or zoom to adjust it if needed. "Fit camera" re-runs the fit from the current viewing angle. The same camera is used for every animation so the previews stay uniform.
4. Press the record button
5. Wait for the status line to say it is done. A ZIP file will be downloaded with a light and dark preview for every animation
6. Place the animation preview mp4 files in the static/animpreviews folder. Each skeleton type has its own folder.

## Tech talk
In step 1 of the workflow, the model/animation selection pulls the GLB files from the static/animations folder. These files have all the animations as well as a skinned mesh, so we can focus on recording and not skinning.

Animations are not recorded in real time. For every frame, the animation is posed with `mixer.setTime()`, rendered to an off-screen canvas for each theme, and encoded with the WebCodecs `VideoEncoder` using exact timestamps. The `mediabunny` package writes the MP4 file and JSZip does the zipping. Because of this:

- Every preview has exactly the frames of its animation at a constant 24 fps, no matter how fast the computer is or whether the tab is in the background.
- Looping animations leave out their last frame (it matches the first) so the loop is seamless. One-shot animations keep it.
- The light and dark previews show the same pose on the same frame.
- The whole human library (230+ animations, both themes) takes around 20 seconds instead of several minutes.

Implementation notes:

- `PreviewFrameCapture.ts` renders at 2x the preview size and box-filters down for anti-aliasing. Pixels are read back in batches through pixel buffer objects. A plain `readPixels` call waits on the GPU every frame and creating a `VideoFrame` straight from the canvas is limited to the display refresh rate. Both are many times slower.
- `PreviewClipEncoder.ts` encodes H.264 Constrained Baseline, which plays on every OS and browser.

The canvas size on the preview-generator is hard-coded in the preview-generator.ts file. The display on the preview generator is larger than the result will be, but it is easier to position when the canvas size is larger. The UI in the application expects a certain size the previews will be in. This helps with the lazy loading and the preview sizes are hard-coded in the Mesh2Motion app itself in CSS.
