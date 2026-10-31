# API Guide

Mesh2Motion has a small, read-only JSON API under `/api`. It lets other tools and sites find out which rigs are available and which 3D model variations exist for each rig, along with direct URLs to the GLB files and preview images.

The API is public, needs no authentication, and only supports `GET` requests.


## Using the API

All examples use the production site, `https://app.mesh2motion.org`. When running locally, replace it with your local address (for example `http://localhost:8787`).

### List all rigs

    GET /api/rigs

    curl https://app.mesh2motion.org/api/rigs

Returns an array of rigs:

```json
[
  {
    "id": "human",
    "display_name": "Human",
    "model_url": "https://app.mesh2motion.org/models/model-human.glb",
    "rig_url": "https://app.mesh2motion.org/rigs/rig-human.glb",
    "skeleton_template_image_url": "https://app.mesh2motion.org/rigs/reference/human.png",
    "variation_count": 29,
    "variations_url": "https://app.mesh2motion.org/api/rigs/human/variations"
  }
]
```

| Field | Description |
|---|---|
| `id` | Rig identifier. Use this in the other endpoints. |
| `display_name` | Name shown in the app |
| `model_url` | Default model GLB for the rig |
| `rig_url` | Skeleton/rig GLB |
| `skeleton_template_image_url` | Reference image of the skeleton layout |
| `variation_count` | Number of model variations (can be `0`) |
| `variations_url` | Full URL for this rig's variations endpoint |

Current rig ids: `human`, `fox`, `bird`, `dragon`, `kaiju`, `spider`, `snake`, `fish`, `horse`.

### Get a single rig

    GET /api/rigs/:rig_id

    curl https://app.mesh2motion.org/api/rigs/fox

Returns one rig object with the same fields as above.

### List model variations for a rig

    GET /api/rigs/:rig_id/variations

    curl https://app.mesh2motion.org/api/rigs/fox/variations

Returns an array of variations:

```json
[
  {
    "id": "cat",
    "display_name": "Carrot",
    "model_url": "https://app.mesh2motion.org/models-variation/fox/cat.glb",
    "preview_image_url": "https://app.mesh2motion.org/models-variation/fox/preview/cat.png",
    "license": "CC-BY",
    "attribution": "David Revoy"
  }
]
```

| Field | Description |
|---|---|
| `id` | Variation identifier (the model's file name without `.glb`) |
| `display_name` | Name shown in the app |
| `model_url` | Variation model GLB |
| `preview_image_url` | Thumbnail image |
| `license` | License of the model, for example `CC0` or `CC-BY` |
| `attribution` | Credit for the model's creator. Empty when not required. Show this whenever the license is not `CC0`. |

Rigs without variations (for example `horse`) return an empty array `[]`.

### Errors

Unknown rigs or routes return HTTP `404` with a JSON message:

```json
{ "error": "Unknown rig: nope" }
```

### CORS

Every response includes `Access-Control-Allow-Origin: *`, so the API can be called from JavaScript on any website:

```js
const rigs = await fetch('https://app.mesh2motion.org/api/rigs').then(r => r.json())
```


## How it works

Mesh2Motion is deployed as a Cloudflare Worker with static assets (see `wrangler.jsonc`):

1. Cloudflare first checks whether the request matches a file in the built `dist` folder (the app pages, GLB files, images). If it does, that file is returned directly.
2. Anything that doesn't match a file goes to the worker in `src/survey-worker.js`. The worker handles the survey endpoints and sends every `GET /api/...` request to `handleApiRequest()` in `src/api/ApiRoutes.ts`.
3. `ApiRoutes.ts` splits the path into parts (`rigs` / `:rig_id` / `variations`) and builds the response from `RigConfig.all` (`src/lib/RigConfig.ts`) and the variation lists in `src/lib/RigModelVariations.ts`.
4. The file paths in the config are relative to the `static` folder, which becomes the site root after a build. The API adds the request's origin to them, which is why the returned URLs work on production, preview deployments and locally.

`RigConfig` is also what the app itself uses, so the API never needs its own data. Adding a rig or variation to the config makes it show up in the API automatically.

Only fields that are useful to outside callers are returned. Values used inside the app, such as `pelvis_position_scale`, `expandArms` and the position tracking bone, are left out on purpose.

### Adding a new endpoint

Add a new case to `handleApiRequest()` in `src/api/ApiRoutes.ts`. For example, a future animation config could be served at `/api/rigs/:rig_id/animations` by checking for `sub_resource === 'animations'`, next to the existing `variations` check. Keep the files in `ApiRoutes.ts` free of three.js and browser-only imports, because they run inside the worker.


## Building and running locally

The API only runs inside the Cloudflare worker. `npm run dev` (Vite) serves the app but **does not** serve `/api`.

To run the app and the API together:

    npm install
    npm run build
    npx wrangler dev

`wrangler dev` serves the `dist` folder and runs the worker, so you need to run `npm run build` first and again whenever static files or the config change. By default it listens on `http://localhost:8787`. Wrangler compiles the TypeScript in `src/api` itself, so no separate build step is needed for the API.

Quick check:

    curl http://localhost:8787/api/rigs

The survey endpoints in the same worker use a D1 database. The `/api` routes don't touch it, so they work locally without any database setup.

To check that the worker bundles correctly without deploying:

    npx wrangler deploy --dry-run


## Deploying

The API is part of the worker, so it goes out with a normal deploy:

    npm run build
    npx wrangler deploy
