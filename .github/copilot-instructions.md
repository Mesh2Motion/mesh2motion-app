# GitHub Copilot Instructions for Mesh2Motion

## Project Overview
Mesh2Motion is a web-based 3D animation skinning tool that allows users to:
1. Import 3D models (GLTF/GLB, FBX, DAE formats)
2. Load or create skeletons for those models
3. Edit skeletons to fit the model geometry
4. Test and preview animations
5. Export animated models

The application uses **Three.js** for 3D graphics and **TypeScript** for development.

## Technology Stack
- **Language**: TypeScript (strict mode)
- **Build Tool**: Vite
- **3D Library**: Three.js (try to use latest stable version)
- **Version Control**: Git (hosted on GitHub)
- **Package Manager**: npm / Node.js 24+
- **Format Support**: GLTF, GLB, FBX, DAE, ZIP archives
- **Utilities**: JSZip, FileSaver, Tippy.js

## Project Structure

### Core Directories
- `src/lib/` - Main application logic
  - `processes/` - Multi-step workflow modules (Step* classes)
  - `enums/` - Enumeration types (ProcessStep, SkeletonType, TransformSpace, etc.)
  - `interfaces/` - TypeScript interfaces for data structures
  - `solvers/` - Auto-skinning algorithms
  - `geometry/` - Custom geometry utilities
  - Other utilities: UI, ModalDialog, ThemeManager, EventListeners, Generators, Utilities

- `src/lib/processes/` - Workflow steps
  - `load-model/` - Model loading and parsing (FBX, GLTF, DAE, ZIP)
  - `load-skeleton/` - Skeleton loading and initialization
  - `edit-skeleton/` - Skeleton manipulation and undo/redo
  - `weight-skin/` - Bone weight calculation and skinning
  - `animations-listing/` - Animation browsing and playback
  - `export-to-file/` - Model and animation export

- `src/` - Entry points
  - `index.html` - Main application
  - `create.html` - Model creation
  - `Mesh2MotionEngine.ts` - Central orchestration
  - `CustomModelUploadBootstrap.ts` - Upload handling
  - `environment.js` - Configuration

### Static Resources
- `static/models/` - Sample 3D models
- `static/rigs/` - Sample skeleton definitions
- `static/animations/` - Sample animation files
- `static/animpreviews/` - Animation preview assets

## Code Architecture & Patterns

### Step Classes (Process Pattern)
Each workflow step is a class extending `EventTarget`:
```typescript
export class StepLoadModel extends EventTarget {
  private readonly ui: UI = UI.getInstance()
  // Step-specific logic
  
  private dispatch_event(step: ProcessStep): void {
    this.dispatchEvent(new CustomEvent('event-name', { detail }))
  }
}
```

**Key Points:**
- All steps inherit from `EventTarget` for event-driven communication
- Use `UI.getInstance()` to access singleton UI instance
- Dispatch events to notify other parts of the application
- Private properties for encapsulation
- Clear getter/setter methods for data access

### Singleton Pattern
- `UI` class uses singleton pattern: `UI.getInstance()`
- Used for centralized UI state and DOM element references
- Store all HTML element references as properties

### Enums & Interfaces
- Located in `src/lib/enums/` and `src/lib/interfaces/`
- Use strong typing: `type ProcessStep = 'load-model' | 'load-skeleton' | ...`
- Interfaces define data structures for algorithm inputs/outputs

### Three.js Conventions
- Import specific classes from Three.js: `import { Vector3 } from 'three'`
- Use scene graphs for hierarchical objects
- `SkinnedMesh` for models with skeletal animation
- `Skeleton` and `Bone` for armatures
- Material management: store materials in lists for later access

### Event System
- Events propagate using `dispatchEvent(new CustomEvent(...))`
- UI listeners subscribe to specific event names
- Detail objects pass complex data through events

## Naming Conventions

### Variables & Properties
- Use snake_case for properties: `vertex_count`, `final_mesh_data`, `debug_model_loading`
- Private properties: `private readonly property_name`
- Booleans prefixed with descriptive verbs: `added_event_listeners`, `mesh_has_broken_material`

### Methods
- camelCase for public methods: `getFinalMeshData()`, `loadModelFromFile()`
- camelCase for private methods
- Getter pattern: `get_property_name()` returns data
- Setter pattern: `set_property_name(value)`

### Classes
- PascalCase: `StepLoadModel`, `CustomFBXLoader`, `ModalDialog`
- Prefix with "Step" for workflow steps: `StepLoadModel`, `StepEditSkeleton`
- Prefix with "Custom" for extended/modified Three.js classes: `CustomFBXLoader`
- Manager classes: `PreviewSkeletonManager`, `OriginMarkerManager`

### Files
- Named after main exported class: `StepLoadModel.ts` contains class `StepLoadModel`
- Use .ts extension, not .js (TypeScript)
- Subdirectories use kebab-case: `load-model/`, `edit-skeleton/`

## Common Operations

### Accessing UI Elements
```typescript
const ui = UI.getInstance()
const button = ui.dom_load_model_button
// All UI element references stored as properties on UI instance
```

### Working with Three.js Objects
```typescript
import { Scene, Group, Mesh, Vector3 } from 'three'

const scene = new Scene()
const geometry = new BufferGeometry()
const material = new MeshPhongMaterial({ color: 0x00ff00 })
const mesh = new Mesh(geometry, material)
scene.add(mesh)
```

### Data Structure Patterns
- **Geometry lists**: `geometry_list: BufferGeometry[] = []` - Store all geometries
- **Material lists**: `material_list: Material[] = []` - Store all materials
- **Scene data**: Store both `original_model_data` and `final_mesh_data` (processed)
- **Metadata counters**: `vertex_count`, `triangle_count`, `objects_count`

### Model Loading Flow
1. Load model file (FBX/GLTF/DAE/ZIP) using appropriate loader
2. Extract geometries and materials into separate lists
3. Create final mesh data in clean scene
4. Preserve or strip non-mesh objects based on requirements
5. Calculate bounding box and center model

## Testing & Debugging

### Debug Mode
- Many classes support debug flags: `debug_model_loading: boolean = false`
- Use these flags to enable verbose logging during development

### Performance Metrics
- Track `vertex_count` and `triangle_count` for performance testing
- Monitor `objects_count` for scene complexity

## ESLint & TypeScript Configuration
- Project uses strict TypeScript mode
- ESLint with TypeScript plugin for code quality
- Follow standard conventions: no semicolons required (Vite default)

## Development Commands
```bash
npm install          # Install dependencies
npm run dev          # Start development server (Vite)
npm run build        # Create production build
```

## File Encoding & Format
- Use UTF-8 encoding for all files
- Import from Three.js examples for loaders: `import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'`
- Use ES6 modules: `import`/`export` syntax

## Feature development
- Try to keep features isolated to specific step classes where possible
- try to keep features modular and isolated when possible
- Try to keep associated event listeners and UI elements with the associated steps or feature associated with it.

## Important Considerations

1. **Memory Management**: 3D models can be large; be mindful of storing multiple copies
2. **Event Listeners**: Always track `added_event_listeners` to prevent duplicate subscriptions
3. **Material Handling**: Some textures may fail to load - check `mesh_has_broken_material` flag
4. **Scene Organization**: Keep original model data separate from processed final data
5. **Skeleton Preservation**: Different skeleton types require different handling (Biped, Quadruped, Hand, etc.)
6. **Undo/Redo**: StepEditSkeleton uses UndoRedoSystem - important for user experience
7. **Mesh2MotionEngine**: Central orchestrator. This file has gotten too large, so consider refactoring and separating concerns when making any changes to this.

## Related Documentation
- Main README: Workflow instructions and building/deployment info
- Preview Generator: [src/preview-generator/README.md](../../src/preview-generator/README.md)
- GitHub: https://github.com/Mesh2Motion/mesh2motion
- Website: https://mesh2motion.org/
- Live Demo: https://app.mesh2motion.org/
- Source Assets: https://github.com/Mesh2Motion/mesh2motion-assets (Blender files)

## Licenses
- **Code**: MIT License
- **Art Assets**: CC0 License

## Coding Standards
- Do not use semicolons (Vite default)
- Add types wherever possible
- Use `const` and `let` appropriately
- Keep functions small and focused
- Comment complex logic for clarity
- naming events with 'event-name' format (kebab-case with hyphens)
- variables names should always use snake_case