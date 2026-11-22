import {
    AmbientLight,
    Bone,
    type BufferGeometry,
    ClampToEdgeWrapping,
    Color,
    ColorManagement,
    DirectionalLight,
    EquirectangularReflectionMapping,
    Group,
    Line,
    LineBasicMaterial,
    Loader,
    LoadingManager,
    MathUtils,
    Matrix4,
    Mesh,
    MeshLambertMaterial,
    MeshPhongMaterial,
    Object3D,
    PerspectiveCamera,
    PointLight,
    PropertyBinding,
    RepeatWrapping,
    Skeleton,
    SkinnedMesh,
    SpotLight,
    SRGBColorSpace,
    Texture,
    TextureLoader,
    Vector3
} from 'three'
import { fbxGlobals, type FBXConnectionEntry } from './fbx-globals'
import { GeometryParser } from './GeometryParser'
import { AnimationParser } from './AnimationParser'
import { generateTransform, getEulerOrder, type FBXTransformData } from './fbx-utils'
import type { FBXCameraAttributeNode, FBXConnectionRow, FBXDeformerNode, FBXDeformerResults, FBXLightAttributeNode, FBXMaterialNode, FBXMaterialProperties, FBXModelObject, FBXMorphDeformerData, FBXNodeObject, FBXNodeValue, FBXPoseDataNode, FBXRawBoneData, FBXRawMorphTargetData, FBXRawNode, FBXSkeletonData, FBXSceneDeformerResults, FBXTextureNode, FBXTransformModelNode, FBXVideoNode } from './FBXNodes'

function as_video (value: FBXRawNode): FBXVideoNode { return value as FBXVideoNode; }
function as_texture (value: FBXRawNode): FBXTextureNode { return value as FBXTextureNode; }
function is_node_object (value: FBXNodeValue): value is FBXNodeObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof ArrayBuffer) && !(value instanceof Uint8Array);
}

function is_property<T extends FBXNodeValue> (value: FBXNodeValue, isValue: (candidate: FBXNodeValue) => candidate is T): value is { value: T } {
    return is_node_object(value) && 'value' in value && isValue(value.value);
}

function is_number (value: FBXNodeValue): value is number { return typeof value === 'number'; }
function is_string (value: FBXNodeValue): value is string { return typeof value === 'string'; }
function is_number_array (value: FBXNodeValue): value is number[] { return Array.isArray(value) && value.every(is_number); }

function is_optional_property<T extends FBXNodeValue> (node: FBXNodeObject, key: string, isValue: (candidate: FBXNodeValue) => candidate is T): boolean {
    const value = node[key];
    return value === undefined || is_property(value, isValue);
}

function is_fbx_material_node (node: FBXRawNode): node is FBXMaterialNode {
    if (typeof node.id !== 'number' || typeof node.attrName !== 'string') return false;
    const shadingModel = node.ShadingModel;
    if (!(typeof shadingModel === 'string' || is_property(shadingModel, is_string))) return false;
    if (!is_optional_property(node, 'BumpFactor', is_number) || !is_optional_property(node, 'Diffuse', is_number_array) ||
        !is_optional_property(node, 'DisplacementFactor', is_number) || !is_optional_property(node, 'Emissive', is_number_array) ||
        !is_optional_property(node, 'EmissiveColor', is_number_array) || !is_optional_property(node, 'EmissiveFactor', is_number) ||
        !is_optional_property(node, 'TransparencyFactor', (value): value is number | string => is_number(value) || is_string(value)) ||
        !is_optional_property(node, 'Opacity', (value): value is number | string | null => is_number(value) || is_string(value) || value === null) ||
        !is_optional_property(node, 'ReflectionFactor', is_number) || !is_optional_property(node, 'Shininess', is_number) ||
        !is_optional_property(node, 'Specular', is_number_array)) return false;
    const diffuseColor = node.DiffuseColor;
    const specularColor = node.SpecularColor;
    const isColorProperty = (value: FBXNodeValue | undefined): boolean => value === undefined ||
        (is_node_object(value) && 'value' in value && is_number_array(value.value) &&
        (value.type === undefined || is_string(value.type)));
    return isColorProperty(diffuseColor) && isColorProperty(specularColor);
}

function is_number_array_node (value: FBXNodeValue): value is FBXNodeObject & { a: number[] } {
    return is_node_object(value) && 'a' in value && is_number_array(value.a);
}

function is_fbx_deformer_node (node: FBXRawNode): node is FBXDeformerNode {
    if (typeof node.id !== 'number' || typeof node.attrName !== 'string' || typeof node.attrType !== 'string') return false;
    if (!['TransformLink', 'Indexes', 'Weights', 'FullWeights'].every((key) => node[key] === undefined || is_number_array_node(node[key]))) return false;
    return node.DeformPercent === undefined || is_property(node.DeformPercent, is_number);
}

function is_fbx_camera_attribute (node: FBXRawNode): node is FBXCameraAttributeNode {
    return typeof node.id === 'number' &&
        ['CameraProjectionType', 'NearPlane', 'FarPlane', 'AspectWidth', 'AspectHeight', 'FieldOfView', 'FocalLength'].every((key) => is_optional_property(node, key, is_number));
}

function is_fbx_light_attribute (node: FBXRawNode): node is FBXLightAttributeNode {
    return typeof node.id === 'number' &&
        ['LightType', 'Intensity', 'CastLightOnObject', 'FarAttenuationEnd', 'EnableFarAttenuation', 'OuterAngle', 'InnerAngle', 'CastShadows'].every((key) => is_optional_property(node, key, is_number)) &&
        is_optional_property(node, 'Color', is_number_array);
}

function is_fbx_transform_model_node (node: FBXRawNode): node is FBXTransformModelNode {
    return typeof node.id === 'number' && typeof node.attrName === 'string' && typeof node.attrType === 'string' &&
        ['RotationOrder'].every((key) => is_optional_property(node, key, is_number)) &&
        ['InheritType'].every((key) => is_optional_property(node, key, (value): value is number | string => is_number(value) || is_string(value))) &&
        ['Lcl_Translation', 'PreRotation', 'Lcl_Rotation', 'PostRotation', 'Lcl_Scaling', 'ScalingOffset', 'ScalingPivot', 'RotationOffset', 'RotationPivot', 'LookAtProperty'].every((key) => is_optional_property(node, key, is_number_array));
}

function is_fbx_pose_matrix_node (value: FBXNodeValue): value is import('./FBXNodes').FBXPoseMatrixNode {
    if (!is_node_object(value) || !('Node' in value) || !(is_string(value.Node) || is_number(value.Node)) || !('Matrix' in value)) return false;
    return is_node_object(value.Matrix) && 'a' in value.Matrix && is_number_array(value.Matrix.a);
}

function is_fbx_pose_node (node: FBXRawNode): node is FBXPoseDataNode {
    if (typeof node.NbPoseNodes !== 'number' || node.NbPoseNodes <= 0 || node.PoseNode === undefined) return false;
    return Array.isArray(node.PoseNode) ? node.PoseNode.every(is_fbx_pose_matrix_node) : is_fbx_pose_matrix_node(node.PoseNode);
}

/**
 * Traverses the `FBXTree` produced by `BinaryParser` or `TextParser` and builds
 * the Three.js scene graph. Responsible for creating materials, textures, lights,
 * cameras, meshes, skeletons, morph targets, and wiring up animations.
 */
class FBXTreeParser {
    textureLoader: TextureLoader;
    manager: LoadingManager;

    constructor (textureLoader: TextureLoader, manager: LoadingManager) {
        this.textureLoader = textureLoader;
        this.manager = manager;

    }

    parse (): Group {

        fbxGlobals.connections = this.parseConnections();

        const images = this.parseImages();
        const textures = this.parseTextures(images);
        const materials = this.parseMaterials(textures);
        const deformers = this.parseDeformers();
        const geometryMap = new GeometryParser().parse(deformers);

        this.parseScene(deformers, geometryMap, materials);

        return fbxGlobals.sceneGraph;

    }

    // Parses FBXTree.Connections which holds parent-child connections between objects (e.g. material -> texture, model->geometry )
    // and details the connection type
    parseConnections (): Map<number, FBXConnectionEntry> {

        const connectionMap = new Map();

        if ('Connections' in fbxGlobals.fbxTree) {

            const rawConnections = fbxGlobals.fbxTree.Connections.connections;

            (rawConnections as FBXConnectionRow[]).forEach(function (rawConnection: FBXConnectionRow) {

                const fromID = rawConnection[0];
                const toID = rawConnection[1];
                const relationship = rawConnection[2];

                if (!connectionMap.has(fromID)) {

                    connectionMap.set(fromID, {
                        parents: [],
                        children: []
                    });

                }

                const parentRelationship = { ID: toID, relationship: relationship };
                connectionMap.get(fromID).parents.push(parentRelationship);

                if (!connectionMap.has(toID)) {

                    connectionMap.set(toID, {
                        parents: [],
                        children: []
                    });

                }

                const childRelationship = { ID: fromID, relationship: relationship };
                connectionMap.get(toID).children.push(childRelationship);

            });

        }

        return connectionMap;

    }

    // Parse FBXTree.Objects.Video for embedded image data
    // These images are connected to textures in FBXTree.Objects.Textures
    // via FBXTree.Connections.
    parseImages (): Record<number, string> {

        const images: Record<number, string> = {};
        const blobs: Record<string, string | undefined> = {};

        if ('Video' in fbxGlobals.fbxTree.Objects) {

            const videoNodes = fbxGlobals.fbxTree.Objects.Video;

            for (const nodeID in videoNodes) {

                const videoNode: FBXVideoNode = as_video(videoNodes[nodeID]);

                const id = parseInt(nodeID);

                images[id] = videoNode.RelativeFilename || videoNode.Filename;

                // raw image data is in videoNode.Content
                if ('Content' in videoNode) {

                    const arrayBufferContent = (videoNode.Content instanceof ArrayBuffer) && (videoNode.Content.byteLength > 0);
                    const base64Content = (typeof videoNode.Content === 'string') && (videoNode.Content !== '');

                    if (arrayBufferContent || base64Content) {

                        const image = this.parseImage(as_video(videoNodes[nodeID]));

                        if (image !== undefined) blobs[videoNode.RelativeFilename || videoNode.Filename] = image;

                    }

                }

            }

        }

        for (const id in images) {

            const filename = images[id];

            const embeddedImage = blobs[filename];
            if (embeddedImage !== undefined) images[id] = embeddedImage;
            else images[id] = images[id].split('\\').pop() ?? images[id];

        }

        return images;

    }

    // Parse embedded image data in FBXTree.Video.Content
    parseImage (videoNode: FBXVideoNode): string | undefined {

        const content = videoNode.Content;
        if (content === undefined) return;
        const fileName = videoNode.RelativeFilename || videoNode.Filename;
        const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();

        let type;

        switch (extension) {

            case 'bmp':

                type = 'image/bmp';
                break;

            case 'jpg':
            case 'jpeg':

                type = 'image/jpeg';
                break;

            case 'png':

                type = 'image/png';
                break;

            case 'tif':

                type = 'image/tiff';
                break;

            case 'tga':

                if (this.manager.getHandler('.tga') === null) {

                    console.warn('FBXLoader: TGA loader not found, skipping ', fileName);

                }

                type = 'image/tga';
                break;

            case 'webp':

                type = 'image/webp';
                break;

            default:

                console.warn('FBXLoader: Image type "' + extension + '" is not supported.');
                return;

        }

        if (typeof content === 'string') { // ASCII format

            return 'data:' + type + ';base64,' + content;

        } else { // Binary Format

            const array = new Uint8Array(content);
            return window.URL.createObjectURL(new Blob([array], { type: type }));

        }

    }

    // Parse nodes in FBXTree.Objects.Texture
    // These contain details such as UV scaling, cropping, rotation etc and are connected
    // to images in FBXTree.Objects.Video
    parseTextures (images: Record<number, string>): Map<number, Texture> {

        const textureMap = new Map();

        if ('Texture' in fbxGlobals.fbxTree.Objects) {

            const textureNodes = fbxGlobals.fbxTree.Objects.Texture;
            for (const nodeID in textureNodes) {

                const texture = this.parseTexture(as_texture(textureNodes[nodeID]), images);
                textureMap.set(parseInt(nodeID), texture);

            }

        }

        return textureMap;

    }

    // Parse individual node in FBXTree.Objects.Texture
    parseTexture (textureNode: FBXTextureNode, images: Record<number, string>): Texture {

        const texture = this.loadTexture(textureNode, images);

        Object.assign(texture, { ID: textureNode.id });

        texture.name = textureNode.attrName;

        const wrapModeU = textureNode.WrapModeU;
        const wrapModeV = textureNode.WrapModeV;

        const valueU = wrapModeU !== undefined ? wrapModeU.value : 0;
        const valueV = wrapModeV !== undefined ? wrapModeV.value : 0;

        // http://download.autodesk.com/us/fbx/SDKdocs/FBX_SDK_Help/files/fbxsdkref/class_k_fbx_texture.html#889640e63e2e681259ea81061b85143a
        // 0: repeat(default), 1: clamp

        texture.wrapS = valueU === 0 ? RepeatWrapping : ClampToEdgeWrapping;
        texture.wrapT = valueV === 0 ? RepeatWrapping : ClampToEdgeWrapping;

        if (textureNode.Scaling !== undefined) {

            const values = textureNode.Scaling.value;

            texture.repeat.x = values[0];
            texture.repeat.y = values[1];

        }

        if (textureNode.Translation !== undefined) {

            const values = textureNode.Translation.value;

            texture.offset.x = values[0];
            texture.offset.y = values[1];

        }

        return texture;

    }

    // load a texture specified as a blob or data URI, or via an external URL using TextureLoader
    loadTexture (textureNode: FBXTextureNode, images: Record<number, string>): Texture {

        const extension = textureNode.FileName.split('.').pop()?.toLowerCase() ?? '';

        let loader = this.manager.getHandler(`.${extension}`);
        if (loader === null) loader = this.textureLoader;

        const loaderPath = loader.path;

        if (!loaderPath) {

            loader.setPath(this.textureLoader.path);

        }

        const children = fbxGlobals.connections.get(textureNode.id)!.children;

        let fileName;

        if (children !== undefined && children.length > 0 && images[children[0].ID] !== undefined) {

            fileName = images[children[0].ID];

            if (fileName.indexOf('blob:') === 0 || fileName.indexOf('data:') === 0) {

                loader.setPath(undefined as unknown as string);

            }

        }

        if (fileName === undefined) {

            console.warn('FBXLoader: Undefined filename, creating placeholder texture.');
            return new Texture();

        }

        const texture = (loader as TextureLoader).load(fileName);

        // revert to initial path
        loader.setPath(loaderPath as string);

        return texture;

    }

    // Parse nodes in FBXTree.Objects.Material
    parseMaterials (textureMap: Map<number, Texture>): Map<number, MeshPhongMaterial | MeshLambertMaterial> {

        const materialMap = new Map();

        if ('Material' in fbxGlobals.fbxTree.Objects) {

            const materialNodes = fbxGlobals.fbxTree.Objects.Material;

            for (const nodeID in materialNodes) {

                const materialNode = materialNodes[nodeID];
                if (!is_fbx_material_node(materialNode)) throw new Error(`Invalid FBX material node ${nodeID}`);
                const material = this.parseMaterial(materialNode, textureMap);

                if (material !== null) materialMap.set(parseInt(nodeID), material);

            }

        }

        return materialMap;

    }

    // Parse single node in FBXTree.Objects.Material
    // Materials are connected to texture maps in FBXTree.Objects.Textures
    // FBX format currently only supports Lambert and Phong shading models
    parseMaterial (materialNode: FBXMaterialNode, textureMap: Map<number, Texture>): MeshPhongMaterial | MeshLambertMaterial | null {

        const ID = materialNode.id;
        const name = materialNode.attrName;
        const type = typeof materialNode.ShadingModel === 'string' ? materialNode.ShadingModel : materialNode.ShadingModel.value;

        // Ignore unused materials which don't have any connections.
        if (!fbxGlobals.connections.has(ID)) return null;

        const parameters = this.parseParameters(materialNode, textureMap, ID);

        let material;

        switch (type.toLowerCase()) {

            case 'phong':
                material = new MeshPhongMaterial();
                break;
            case 'lambert':
                material = new MeshLambertMaterial();
                break;
            default:
                console.warn('THREE.FBXLoader: unknown material type "%s". Defaulting to MeshPhongMaterial.', type);
                material = new MeshPhongMaterial();
                break;

        }

        material.setValues(parameters);
        material.name = name;

        return material;

    }

    // Parse FBX material and return parameters suitable for a three.js material
    // Also parse the texture map and return any textures associated with the material
    parseParameters (materialNode: FBXMaterialNode, textureMap: Map<number, Texture>, ID: number): FBXMaterialProperties {

        const parameters: FBXMaterialProperties = { opacity: 1 };

        if (materialNode.BumpFactor) {

            parameters.bumpScale = materialNode.BumpFactor.value;

        }

        if (materialNode.Diffuse) {

            parameters.color = ColorManagement.colorSpaceToWorking(new Color().fromArray(materialNode.Diffuse.value), SRGBColorSpace);

        } else if (materialNode.DiffuseColor && (materialNode.DiffuseColor.type === 'Color' || materialNode.DiffuseColor.type === 'ColorRGB')) {

            // The blender exporter exports diffuse here instead of in materialNode.Diffuse
            parameters.color = ColorManagement.colorSpaceToWorking(new Color().fromArray(materialNode.DiffuseColor.value), SRGBColorSpace);

        }

        if (materialNode.DisplacementFactor) {

            parameters.displacementScale = materialNode.DisplacementFactor.value;

        }

        // Emissive is deliberately not read from the FBX (Emissive / EmissiveColor /
        // EmissiveFactor). FBX files very often carry an emissive color that was
        // never meant to light anything up, and it cannot survive a round trip:
        // the viewport dims it by EmissiveFactor, but a GLB export writes the color
        // into emissiveFactor and only keeps the intensity for standard (PBR)
        // materials - FBX loads as Phong, so the intensity is dropped and the
        // exported model glows far brighter than it did on screen. Leaving these
        // parameters unset keeps three's default of a black (no glow) emissive.
        if (materialNode.Emissive || materialNode.EmissiveColor || materialNode.EmissiveFactor) {

            console.warn('THREE.FBXLoader: ignoring the emissive settings on material "%s". Emissive from an FBX cannot be exported correctly, so it is treated as no glow.', materialNode.attrName);

        }

        // the transparency handling is implemented based on Blender's approach:
        // https://github.com/blender/blender/blob/main/scripts/addons_core/io_scene_fbx/import_fbx.py

        parameters.opacity = 1 - (materialNode.TransparencyFactor ? parseFloat(String(materialNode.TransparencyFactor.value)) : 0);

        if (parameters.opacity === 1 || parameters.opacity === 0) {

            const opacity = materialNode.Opacity ? parseFloat(String(materialNode.Opacity.value)) : null;

            if (opacity === null) {

                // Default to opaque. Some exporters (e.g. 3ds Max) define TransparentColor
                // as white (1,1,1) without intending transparency, which makes the Unity-style
                // fallback of `1 - TransparentColor.r` produce incorrect zero opacity.
                parameters.opacity = 1;

            } else {

                parameters.opacity = opacity;

            }

        }

        if (parameters.opacity < 1.0) {

            parameters.transparent = true;

        }

        if (materialNode.ReflectionFactor) {

            parameters.reflectivity = materialNode.ReflectionFactor.value;

        }

        if (materialNode.Shininess) {

            parameters.shininess = materialNode.Shininess.value;

        }

        if (materialNode.Specular) {

            parameters.specular = ColorManagement.colorSpaceToWorking(new Color().fromArray(materialNode.Specular.value), SRGBColorSpace);

        } else if (materialNode.SpecularColor && materialNode.SpecularColor.type === 'Color') {

            // The blender exporter exports specular color here instead of in materialNode.Specular
            parameters.specular = ColorManagement.colorSpaceToWorking(new Color().fromArray(materialNode.SpecularColor.value), SRGBColorSpace);

        }

        fbxGlobals.connections.get(ID)!.children.forEach((child) => {

            const type = child.relationship;

            switch (type) {

                case 'Bump':
                    parameters.bumpMap = this.getTexture(textureMap, child.ID);
                    break;

                case 'Maya|TEX_ao_map':
                    parameters.aoMap = this.getTexture(textureMap, child.ID);
                    break;

                case 'DiffuseColor':
                case 'Maya|TEX_color_map':
                    parameters.map = this.getTexture(textureMap, child.ID);
                    if (parameters.map !== undefined) {

                        parameters.map.colorSpace = SRGBColorSpace;

                    }

                    break;

                case 'DisplacementColor':
                    parameters.displacementMap = this.getTexture(textureMap, child.ID);
                    break;

                case 'EmissiveColor':
                    // skipped along with the emissive color above - an emissive map
                    // with no emissive color to tint it does nothing except add an
                    // unused texture to whatever the model is exported to

                    // parameters.emissiveMap = scope.getTexture(textureMap, child.ID);
                    // if (parameters.emissiveMap !== undefined) {
                    //     parameters.emissiveMap.colorSpace = SRGBColorSpace;
                    // }

                    break;

                case 'NormalMap':
                case 'Maya|TEX_normal_map':
                    parameters.normalMap = this.getTexture(textureMap, child.ID);
                    break;

                case 'ReflectionColor':
                    parameters.envMap = this.getTexture(textureMap, child.ID);
                    if (parameters.envMap !== undefined) {

                        parameters.envMap.mapping = EquirectangularReflectionMapping;
                        parameters.envMap.colorSpace = SRGBColorSpace;

                    }

                    break;

                case 'SpecularColor':
                    parameters.specularMap = this.getTexture(textureMap, child.ID);
                    if (parameters.specularMap !== undefined) {

                        parameters.specularMap.colorSpace = SRGBColorSpace;

                    }

                    break;

                case 'TransparentColor':
                case 'TransparencyFactor':
                    parameters.alphaMap = this.getTexture(textureMap, child.ID);
                    parameters.transparent = true;
                    break;

                case 'AmbientColor':
                case 'ShininessExponent': // AKA glossiness map
                case 'SpecularFactor': // AKA specularLevel
                case 'VectorDisplacementColor': // NOTE: Seems to be a copy of DisplacementColor
                default:
                    console.warn('THREE.FBXLoader: %s map is not supported in three.js, skipping texture.', type);
                    break;

            }

        });

        return parameters;

    }

    // get a texture from the textureMap for use by a material.
    getTexture (textureMap: Map<number, Texture>, id: number): Texture | undefined {

        // if the texture is a layered texture, just use the first layer and issue a warning
        if ('LayeredTexture' in fbxGlobals.fbxTree.Objects && id in fbxGlobals.fbxTree.Objects.LayeredTexture) {

            console.warn('THREE.FBXLoader: layered textures are not supported in three.js. Discarding all but first layer.');
            id = fbxGlobals.connections.get(id)!.children[0].ID;

        }

        return textureMap.get(id);

    }

    // Parse nodes in FBXTree.Objects.Deformer
    // Deformer node can contain skinning or Vertex Cache animation data, however only skinning is supported here
    // Generates map of Skeleton-like objects for use later when generating and binding skeletons.
    parseDeformers (): FBXSceneDeformerResults {

        const skeletons: FBXSceneDeformerResults['skeletons'] = {};
        const morphTargets: FBXSceneDeformerResults['morphTargets'] = {};

        if ('Deformer' in fbxGlobals.fbxTree.Objects) {

            const DeformerNodes: Record<string, FBXDeformerNode> = {};

            for (const [id, node] of Object.entries(fbxGlobals.fbxTree.Objects.Deformer)) {

                if (!is_fbx_deformer_node(node)) throw new Error(`Invalid FBX deformer node ${id}`);
                DeformerNodes[id] = node;

            }

            for (const nodeID in DeformerNodes) {

                const deformerNode = DeformerNodes[nodeID];

                const relationships = fbxGlobals.connections.get(parseInt(nodeID));
                if (relationships === undefined) throw new Error(`FBX deformer ${nodeID} has no connection record`);

                if (deformerNode.attrType === 'Skin') {

                    const parsedSkeleton = this.parseSkeleton(relationships, DeformerNodes);
                    const geometryParent = relationships.parents[0];
                    if (geometryParent === undefined) throw new Error(`FBX skin deformer ${nodeID} has no parent geometry`);
                    const skeleton: FBXSkeletonData = { ...parsedSkeleton, ID: nodeID, geometryID: geometryParent.ID };

                    if (relationships.parents.length > 1) console.warn('THREE.FBXLoader: skeleton attached to more than one geometry is not supported.');
                    skeletons[nodeID] = skeleton;

                } else if (deformerNode.attrType === 'BlendShape') {

                    const morphTarget: FBXMorphDeformerData = {
                        id: nodeID,
                        rawTargets: this.parseMorphTargets(relationships, DeformerNodes)
                    };

                    if (relationships.parents.length > 1) console.warn('THREE.FBXLoader: morph target attached to more than one geometry is not supported.');

                    morphTargets[nodeID] = morphTarget;

                }

            }

        }

        return {

            skeletons: skeletons,
            morphTargets: morphTargets,

        };

    }

    // Parse single nodes in FBXTree.Objects.Deformer
    // The top level skeleton node has type 'Skin' and sub nodes have type 'Cluster'
    // Each skin node represents a skeleton and each cluster node represents a bone
    parseSkeleton (relationships: FBXConnectionEntry, deformerNodes: Record<string, FBXDeformerNode>): Omit<FBXSkeletonData, 'ID' | 'geometryID'> {

        const rawBones: FBXRawBoneData[] = [];

        relationships.children.forEach(function (child) {

            const boneNode = deformerNodes[child.ID];

            if (boneNode.attrType !== 'Cluster') return;

            if (boneNode.TransformLink === undefined) throw new Error(`FBX cluster ${child.ID} has no TransformLink`);
            const rawBone: FBXRawBoneData = {

                ID: child.ID,
                indices: [],
                weights: [],
                transformLink: new Matrix4().fromArray(boneNode.TransformLink.a),

            };

            if (boneNode.Indexes !== undefined && boneNode.Weights !== undefined) {

                rawBone.indices = boneNode.Indexes.a;
                rawBone.weights = boneNode.Weights.a;

            }

            rawBones.push(rawBone);

        });

        return {

            rawBones: rawBones,
            bones: []

        };

    }

    // The top level morph deformer node has type "BlendShape" and sub nodes have type "BlendShapeChannel"
    parseMorphTargets (relationships: FBXConnectionEntry, deformerNodes: Record<string, FBXDeformerNode>): FBXDeformerResults['morphTargets'][string]['rawTargets'] {

        const rawMorphTargets: FBXRawMorphTargetData[] = [];

        for (let i = 0; i < relationships.children.length; i++) {

            const child = relationships.children[i];

            const morphTargetNode = deformerNodes[child.ID];

            if (morphTargetNode.attrType !== 'BlendShapeChannel') return rawMorphTargets;
            if (morphTargetNode.FullWeights === undefined) throw new Error(`FBX morph channel ${child.ID} has no FullWeights`);

            const rawMorphTarget: FBXRawMorphTargetData = {

                name: morphTargetNode.attrName,
                initialWeight: morphTargetNode.DeformPercent,
                id: morphTargetNode.id,
                fullWeights: morphTargetNode.FullWeights.a

            };

            const geometryRelationship = fbxGlobals.connections.get(parseInt(String(child.ID)))?.children.find(function (connection) {

                return connection.relationship === undefined;

            });
            if (geometryRelationship === undefined) throw new Error(`FBX morph channel ${child.ID} has no geometry connection`);
            rawMorphTarget.geoID = geometryRelationship.ID;

            rawMorphTargets.push(rawMorphTarget);

        }

        return rawMorphTargets;

    }

    // create the main Group() to be returned by the loader
    parseScene (deformers: FBXSceneDeformerResults, geometryMap: Map<number, BufferGeometry | undefined>, materialMap: Map<number, MeshPhongMaterial | MeshLambertMaterial>): void {

        fbxGlobals.sceneGraph = new Group();

        const modelMap = this.parseModels(deformers.skeletons, geometryMap, materialMap);

        const modelNodes = fbxGlobals.fbxTree.Objects.Model;

        modelMap.forEach((model: FBXModelObject) => {

            const modelNode = modelNodes[model.ID];
            if (modelNode === undefined || !is_fbx_transform_model_node(modelNode)) throw new Error(`Missing FBX model node ${model.ID}`);
            this.setLookAtProperties(model, modelNode);

            const parentConnections = fbxGlobals.connections.get(model.ID)!.parents;

            parentConnections.forEach((connection) => {

                const parent = modelMap.get(connection.ID);
                if (parent !== undefined) parent.add(model);

            });

            if (model.parent === null) {

                fbxGlobals.sceneGraph.add(model);

            }


        });

        this.addGlobalSceneSettings();

        fbxGlobals.sceneGraph.traverse((node) => {

            if (node.userData.transformData) {

                if (node.parent) {

                    node.userData.transformData.parentMatrix = node.parent.matrix;
                    node.userData.transformData.parentMatrixWorld = node.parent.matrixWorld;

                }

                const transform = generateTransform(node.userData.transformData);

                node.applyMatrix4(transform);
                node.updateWorldMatrix(false, false);

            }

        });

        // Like Blender's FBX importer, use the BindPose section to set the
        // rest pose for bones that are not part of a skin cluster. The BindPose
        // provides a more authoritative rest pose than the Lcl properties which
        // may represent an animation frame rather than the true rest state.
        // Bones WITH clusters will get their bind pose from TransformLink
        // (set via bindSkeleton below), which takes priority.
        const bindPoseMatrices = this.parsePoseNodes();
        const clusterBoneIDs = new Set<number>();

        for (const ID in deformers.skeletons) {

            deformers.skeletons[ID].rawBones.forEach(function (_, i: number) {

                const bone = deformers.skeletons[ID].bones[i];
                if (bone) clusterBoneIDs.add(bone.ID);

            });

        }

        const tempMatrix = new Matrix4();

        fbxGlobals.sceneGraph.traverse(function (node) {

            if (node instanceof Bone && 'ID' in node && typeof node.ID === 'number' && !clusterBoneIDs.has(node.ID)) {

                const bindPose = bindPoseMatrices[String(node.ID)];

                if (bindPose !== undefined) {

                    if (node.parent) {

                        tempMatrix.copy(node.parent.matrixWorld).invert();
                        tempMatrix.multiply(bindPose);

                    } else {

                        tempMatrix.copy(bindPose);

                    }

                    tempMatrix.decompose(node.position, node.quaternion, node.scale);
                    node.updateMatrix();
                    node.matrixWorld.copy(bindPose);

                }

            }

        });

        // Bind skeletons after transforms are applied so that bind matrices
        // are computed from the final scene state. This ensures the rest pose
        // is correct even when the FBX file's Cluster TransformLink matrices
        // differ from the reconstructed bone transforms (common in files
        // without a BindPose section).
        this.bindSkeleton(deformers.skeletons, geometryMap, modelMap);

        const animations = new AnimationParser().parse();

        // if all the models where already combined in a single group, just return that
        if (fbxGlobals.sceneGraph.children.length === 1 && fbxGlobals.sceneGraph.children[0] instanceof Group) {

            fbxGlobals.sceneGraph.children[0].animations = animations;
            fbxGlobals.sceneGraph = fbxGlobals.sceneGraph.children[0];

        }

        fbxGlobals.sceneGraph.animations = animations;

        // Apply coordinate system correction. FBX files can use different
        // up-axis conventions (Y-up or Z-up). Three.js uses Y-up, so rotate
        // the scene when the file uses Z-up (UpAxis === 2).

        if ('GlobalSettings' in fbxGlobals.fbxTree) {

            const upAxisProperty = fbxGlobals.fbxTree.GlobalSettings.UpAxis;
            const upAxis = is_property(upAxisProperty, is_number) ? upAxisProperty.value : undefined;

            if (upAxis === 2) {

                console.warn('THREE.FBXLoader: You are loading an asset with a Z-UP coordinate system. The loader just rotates the asset to transform it into Y-UP. The vertex data are not converted.');

                fbxGlobals.sceneGraph.rotation.set(- Math.PI / 2, 0, 0);

            }

        }

    }

    // parse nodes in FBXTree.Objects.Model
    parseModels (skeletons: FBXSceneDeformerResults['skeletons'], geometryMap: Map<number, BufferGeometry | undefined>, materialMap: Map<number, MeshPhongMaterial | MeshLambertMaterial>): Map<number, FBXModelObject> {

        const modelMap = new Map<number, FBXModelObject>();
        const modelNodes = fbxGlobals.fbxTree.Objects.Model;

        for (const nodeID in modelNodes) {

            const id = parseInt(nodeID);
            const rawNode = modelNodes[nodeID];
            if (!is_fbx_transform_model_node(rawNode)) throw new Error(`Invalid FBX model node ${nodeID}`);
            const node = rawNode;
            const relationships = fbxGlobals.connections.get(id);

            const skeletonBone = this.buildSkeleton(relationships, skeletons, id, node.attrName);
            let model: Object3D;

            if (skeletonBone === null) {

                switch (node.attrType) {

                    case 'Camera':
                        model = this.createCamera(relationships);
                        break;
                    case 'Light':
                        model = this.createLight(relationships);
                        break;
                    case 'Mesh':
                        model = this.createMesh(relationships, geometryMap, materialMap);
                        break;
                    case 'NurbsCurve':
                        model = this.createCurve(relationships, geometryMap);
                        break;
                    case 'LimbNode':
                    case 'Root':
                        model = new Bone();
                        break;
                    case 'Null':
                    default:
                        model = new Group();
                        break;

                }

                model.name = node.attrName ? PropertyBinding.sanitizeNodeName(node.attrName) : '';
                model.userData.originalName = node.attrName;

            } else {

                model = skeletonBone;

            }

            const taggedModel: FBXModelObject = Object.assign(model, { ID: id });
            this.getTransformData(taggedModel, node);
            modelMap.set(id, taggedModel);

        }

        return modelMap;

    }

    buildSkeleton (relationships: FBXConnectionEntry | undefined, skeletons: FBXSceneDeformerResults['skeletons'], id: number, name: string): (Bone & { ID: number }) | null {

        let bone: (Bone & { ID: number }) | null = null;

        relationships?.parents.forEach(function (parent) {

            for (const ID in skeletons) {

                const skeleton = skeletons[ID];

                skeleton.rawBones.forEach(function (rawBone, i: number) {

                    if (rawBone.ID === parent.ID) {

                        const subBone = bone;
                        bone = Object.assign(new Bone(), { ID: id });

                        bone.matrixWorld.copy(rawBone.transformLink);

                        // set name and id here - otherwise in cases where "subBone" is created it will not have a name / id

                        bone.name = name ? PropertyBinding.sanitizeNodeName(name) : '';
                        bone.userData.originalName = name;
                        skeleton.bones[i] = bone;

                        // In cases where a bone is shared between multiple meshes
                        // duplicate the bone here and add it as a child of the first bone
                        if (subBone !== null) {

                            bone.add(subBone);

                        }

                    }

                });

            }

        });

        return bone;

    }

    // create a PerspectiveCamera or OrthographicCamera
    createCamera (relationships: FBXConnectionEntry | undefined): Object3D {

        let model: Object3D;
        let cameraAttribute: FBXCameraAttributeNode | undefined;

        relationships?.children.forEach(function (child) {

            const attr = fbxGlobals.fbxTree.Objects.NodeAttribute[child.ID];

            if (attr !== undefined) {

                if (!is_fbx_camera_attribute(attr)) throw new Error(`Invalid FBX camera attribute ${child.ID}`);
                cameraAttribute = attr;

            }

        });

        if (cameraAttribute === undefined) {

            model = new Object3D();

        } else {

            let type = 0;
            if (cameraAttribute.CameraProjectionType !== undefined && cameraAttribute.CameraProjectionType.value === 1) {

                type = 1;

            }

            let nearClippingPlane = 1;
            if (cameraAttribute.NearPlane !== undefined) {

                nearClippingPlane = cameraAttribute.NearPlane.value / 1000;

            }

            let farClippingPlane = 1000;
            if (cameraAttribute.FarPlane !== undefined) {

                farClippingPlane = cameraAttribute.FarPlane.value / 1000;

            }


            let width = window.innerWidth;
            let height = window.innerHeight;

            if (cameraAttribute.AspectWidth !== undefined && cameraAttribute.AspectHeight !== undefined) {

                width = cameraAttribute.AspectWidth.value;
                height = cameraAttribute.AspectHeight.value;

            }

            const aspect = width / height;

            let fov = 45;
            if (cameraAttribute.FieldOfView !== undefined) {

                fov = cameraAttribute.FieldOfView.value;

            }

            const focalLength = cameraAttribute.FocalLength ? cameraAttribute.FocalLength.value : null;

            switch (type) {

                case 0: // Perspective
                {
                    const camera = new PerspectiveCamera(fov, aspect, nearClippingPlane, farClippingPlane);
                    if (focalLength !== null) camera.setFocalLength(focalLength);
                    model = camera;
                    break;
                }

                case 1: // Orthographic
                    console.warn('THREE.FBXLoader: Orthographic cameras not supported yet.');
                    model = new Object3D();
                    break;

                default:
                    console.warn('THREE.FBXLoader: Unknown camera type ' + type + '.');
                    model = new Object3D();
                    break;

            }

        }

        return model;

    }

    // Create a DirectionalLight, PointLight or SpotLight
    createLight (relationships: FBXConnectionEntry | undefined): Object3D {

        let model: Object3D;
        let lightAttribute: FBXLightAttributeNode | undefined;

        relationships?.children.forEach(function (child) {

            const attr = fbxGlobals.fbxTree.Objects.NodeAttribute[child.ID];

            if (attr !== undefined) {

                if (!is_fbx_light_attribute(attr)) throw new Error(`Invalid FBX light attribute ${child.ID}`);
                lightAttribute = attr;

            }

        });

        if (lightAttribute === undefined) {

            model = new Object3D();

        } else {

            const type = lightAttribute.LightType?.value ?? 0;

            // LightType can be undefined for Point lights
            let color: Color | number = 0xffffff;

            if (lightAttribute.Color !== undefined) {

                color = ColorManagement.colorSpaceToWorking(new Color().fromArray(lightAttribute.Color.value), SRGBColorSpace);

            }

            let intensity = (lightAttribute.Intensity === undefined) ? 1 : lightAttribute.Intensity.value / 100;

            // light disabled
            if (lightAttribute.CastLightOnObject !== undefined && lightAttribute.CastLightOnObject.value === 0) {

                intensity = 0;

            }

            let distance = 0;
            if (lightAttribute.FarAttenuationEnd !== undefined) {

                if (lightAttribute.EnableFarAttenuation !== undefined && lightAttribute.EnableFarAttenuation.value === 0) {

                    distance = 0;

                } else {

                    distance = lightAttribute.FarAttenuationEnd.value;

                }

            }

            // TODO: could this be calculated linearly from FarAttenuationStart to FarAttenuationEnd?
            const decay = 1;

            switch (type) {

                case 0: // Point
                    model = new PointLight(color, intensity, distance, decay);
                    break;

                case 1: // Directional
                    model = new DirectionalLight(color, intensity);
                    break;

                case 2: // Spot
                {
                    let angle = Math.PI / 3;
                    let penumbra = 0;

                    if (lightAttribute.OuterAngle !== undefined) {

                        angle = MathUtils.degToRad(lightAttribute.OuterAngle.value);

                        if (lightAttribute.InnerAngle !== undefined) {

                            penumbra = 1 - (lightAttribute.InnerAngle.value / lightAttribute.OuterAngle.value);
                            penumbra = Math.max(0, penumbra); // penumbra must be in the range [0,1]

                        }

                    } else if (lightAttribute.InnerAngle !== undefined) {

                        // fallback if only InnerAngle is defined

                        angle = MathUtils.degToRad(lightAttribute.InnerAngle.value);

                    }

                    model = new SpotLight(color, intensity, distance, angle, penumbra, decay);
                    break;
                }

                default:
                    console.warn('THREE.FBXLoader: Unknown light type ' + type + ', defaulting to a PointLight.');
                    model = new PointLight(color, intensity);
                    break;

            }

            if (lightAttribute.CastShadows !== undefined && lightAttribute.CastShadows.value === 1) {

                model.castShadow = true;

            }

        }

        return model;

    }

    createMesh (relationships: FBXConnectionEntry | undefined, geometryMap: Map<number, BufferGeometry | undefined>, materialMap: Map<number, MeshPhongMaterial | MeshLambertMaterial>): Mesh | SkinnedMesh {

        let geometry: BufferGeometry | undefined;
        const materials: Array<MeshPhongMaterial | MeshLambertMaterial> = [];

        // get geometry and materials(s) from connections
        relationships?.children.forEach(function (child) {

            if (geometryMap.has(child.ID)) {

                geometry = geometryMap.get(child.ID);

            }

            if (materialMap.has(child.ID)) {

                const material = materialMap.get(child.ID);
                if (material !== undefined) materials.push(material);

            }

        });

        if (materials.length === 0) {

            materials.push(new MeshPhongMaterial({
                name: Loader.DEFAULT_MATERIAL_NAME,
                color: 0xcccccc
            }));

        }

        if (geometry === undefined) throw new Error('FBX mesh model has no connected geometry');
        const meshMaterial: MeshPhongMaterial | MeshLambertMaterial | Array<MeshPhongMaterial | MeshLambertMaterial> = materials.length > 1 ? materials : materials[0];

        if ('color' in geometry.attributes) {

            materials.forEach(function (material) {

                material.vertexColors = true;

            });

        }

        // Sanitization: If geometry has groups, then it must match the provided material array.
        // If not, we need to clean up the `group.materialIndex` properties inside the groups and point at a (new) default material.
        // This isn't well defined; Unity creates default material, while Blender implicitly uses the previous material in the list.
        if (geometry.groups.length > 0) {

            let needsDefaultMaterial = false;

            for (let i = 0, il = geometry.groups.length; i < il; i++) {

                const group = geometry.groups[i];

                if (group.materialIndex !== undefined && (group.materialIndex < 0 || group.materialIndex >= materials.length)) {

                    group.materialIndex = materials.length;
                    needsDefaultMaterial = true;

                }

            }

            if (needsDefaultMaterial) {

                const defaultMaterial = new MeshPhongMaterial();
                materials.push(defaultMaterial);

            }

        }

        if ('FBX_Deformer' in geometry) {

            const model = new SkinnedMesh(geometry, meshMaterial);
            model.normalizeSkinWeights();
            return model;

        }

        return new Mesh(geometry, meshMaterial);

    }

    createCurve (relationships: FBXConnectionEntry | undefined, geometryMap: Map<number, BufferGeometry | undefined>): Line {

        const geometry = relationships?.children.reduce(function (geo: BufferGeometry | undefined, child) {

            if (geometryMap.has(child.ID)) geo = geometryMap.get(child.ID);

            return geo;

        }, undefined);

        if (geometry === undefined) throw new Error('FBX curve model has no connected geometry');

        // FBX does not list materials for Nurbs lines, so we'll just put our own in here.
        const material = new LineBasicMaterial({
            name: Loader.DEFAULT_MATERIAL_NAME,
            color: 0x3300ff,
            linewidth: 1
        });
        return new Line(geometry, material);

    }

    // parse the model node for transform data
    getTransformData (model: FBXModelObject, modelNode: FBXTransformModelNode): void {

        const transformData: FBXTransformData = {};

        if (modelNode.InheritType !== undefined) transformData.inheritType = parseInt(String(modelNode.InheritType.value));

        if (modelNode.RotationOrder !== undefined) transformData.eulerOrder = getEulerOrder(modelNode.RotationOrder.value);
        else transformData.eulerOrder = getEulerOrder(0);

        if (modelNode.Lcl_Translation !== undefined) transformData.translation = modelNode.Lcl_Translation.value;

        if (modelNode.PreRotation !== undefined) transformData.preRotation = modelNode.PreRotation.value;
        if (modelNode.Lcl_Rotation !== undefined) transformData.rotation = modelNode.Lcl_Rotation.value;
        if (modelNode.PostRotation !== undefined) transformData.postRotation = modelNode.PostRotation.value;

        if (modelNode.Lcl_Scaling !== undefined) transformData.scale = modelNode.Lcl_Scaling.value;

        if (modelNode.ScalingOffset !== undefined) transformData.scalingOffset = modelNode.ScalingOffset.value;
        if (modelNode.ScalingPivot !== undefined) transformData.scalingPivot = modelNode.ScalingPivot.value;

        if (modelNode.RotationOffset !== undefined) transformData.rotationOffset = modelNode.RotationOffset.value;
        if (modelNode.RotationPivot !== undefined) transformData.rotationPivot = modelNode.RotationPivot.value;

        model.userData.transformData = transformData;

    }

    setLookAtProperties (model: FBXModelObject, modelNode: FBXTransformModelNode): void {

        if ('LookAtProperty' in modelNode) {

            const children = fbxGlobals.connections.get(model.ID)!.children;

            children.forEach(function (child) {

                if (child.relationship === 'LookAtProperty') {

                    const lookAtTarget = fbxGlobals.fbxTree.Objects.Model[child.ID];

                    if (lookAtTarget !== undefined && is_fbx_transform_model_node(lookAtTarget) && lookAtTarget.Lcl_Translation !== undefined) {

                        const pos = lookAtTarget.Lcl_Translation.value;

                        // DirectionalLight, SpotLight
                        if (model.target !== undefined) {

                            model.target.position.fromArray(pos);
                            fbxGlobals.sceneGraph.add(model.target);

                        } else { // Cameras and other Object3Ds

                            model.lookAt(new Vector3().fromArray(pos));

                        }

                    }

                }

            });

        }

    }

    bindSkeleton (skeletons: FBXSceneDeformerResults['skeletons'], geometryMap: Map<number, BufferGeometry | undefined>, modelMap: Map<number, FBXModelObject>): void {

        for (const ID in skeletons) {

            const skeleton = skeletons[ID];

            // skeleton.bones is filled in by index as the models are parsed, so a
            // cluster whose bone model is missing from the file leaves an undefined
            // hole in the list. Those holes reach the exporters, where an undefined
            // joint is written out as null and the file is rejected on load
            // ("/skins/0/joints/null: failed to find index (null)"). Drop the holes
            // and keep a map of where each cluster ended up, so the skin indices
            // stored on the geometry can be moved along with them.
            //
            // Compute bone inverses from TransformLink rather than from the
            // bones' current matrixWorld. The TransformLink matrices represent
            // each bone's global transform at the time the skin weights were
            // painted, which may differ from the scene-reconstructed transforms.
            const boneInverses: Matrix4[] = [];
            const bones: Array<Bone & { ID: number }> = [];
            const clusterToBoneIndex: number[] = [];

            for (let i = 0, l = skeleton.rawBones.length; i < l; i++) {

                const bone = skeleton.bones[i];

                if (!bone) {

                    clusterToBoneIndex[i] = - 1;
                    continue;

                }

                clusterToBoneIndex[i] = bones.length;
                bones.push(bone);
                boneInverses.push(new Matrix4().copy(skeleton.rawBones[i].transformLink).invert());

            }

            const hasMissingBones = bones.length !== skeleton.rawBones.length;
            const remappedGeometries = new Set<BufferGeometry>();

            if (hasMissingBones) {

                console.warn('THREE.FBXLoader: ' + (skeleton.rawBones.length - bones.length) + ' skin cluster(s) have no bone in this file. Their influences are being dropped.');

            }

            skeleton.bones = bones;

            const parents = fbxGlobals.connections.get(parseInt(skeleton.ID))?.parents ?? [];

            parents.forEach((parent) => {

                if (geometryMap.has(parent.ID)) {

                    const geoID = parent.ID;
                    const geoRelationships = fbxGlobals.connections.get(geoID);
                    if (geoRelationships === undefined) return;

                    geoRelationships.parents.forEach((geoConnParent) => {

                        if (modelMap.has(geoConnParent.ID)) {

                            const model = modelMap.get(geoConnParent.ID);
                            if (!(model instanceof SkinnedMesh)) return;

                            // the skin indices on the geometry are cluster indices, so
                            // they only line up with the bone list while it is complete
                            if (hasMissingBones && !remappedGeometries.has(model.geometry)) {

                                remappedGeometries.add(model.geometry);
                                this.remapSkinIndices(model.geometry, clusterToBoneIndex);

                            }

                            // Use the mesh's current matrixWorld as bind matrix.
                            // The BindPose section is intentionally not used here
                            // since it may contain scale/rotation from the model
                            // hierarchy that is inconsistent with the TransformLink-
                            // based bone inverses. Always provide a bind matrix to
                            // prevent bind() from calling calculateInverses() which
                            // would overwrite the bone inverses computed above.
                            model.updateMatrixWorld(true);

                            model.bind(new Skeleton(bones, boneInverses), model.matrixWorld);

                        }

                    });

                }

            });

        }

    }

    // Points a geometry's skin indices at the compacted bone list. Influences that
    // referenced a cluster with no bone are dropped, and what is left is renormalized
    // so every vertex still sums to a full weight.
    remapSkinIndices (geometry: BufferGeometry, clusterToBoneIndex: number[]): void {

        const skinIndex = geometry.attributes.skinIndex;
        const skinWeight = geometry.attributes.skinWeight;

        if (skinIndex === undefined || skinWeight === undefined) return;

        for (let vertex = 0, l = skinIndex.count; vertex < l; vertex++) {

            let weightTotal = 0;

            for (let influence = 0; influence < 4; influence++) {

                const boneIndex = clusterToBoneIndex[skinIndex.getComponent(vertex, influence)];

                if (boneIndex === undefined || boneIndex === - 1) {

                    skinIndex.setComponent(vertex, influence, 0);
                    skinWeight.setComponent(vertex, influence, 0);
                    continue;

                }

                skinIndex.setComponent(vertex, influence, boneIndex);
                weightTotal += skinWeight.getComponent(vertex, influence);

            }

            // a vertex that was only influenced by dropped bones has nothing left to
            // normalize, and it was not skinned to anything before either, so leave it
            if (weightTotal === 0) continue;

            for (let influence = 0; influence < 4; influence++) {

                skinWeight.setComponent(vertex, influence, skinWeight.getComponent(vertex, influence) / weightTotal);

            }

        }

        skinIndex.needsUpdate = true;
        skinWeight.needsUpdate = true;

    }

    // Parse BindPose nodes and return a map of node ID to bind matrix.
    parsePoseNodes (): Record<string, Matrix4> {

        const bindMatrices: { [key: string]: Matrix4 } = {};

        if ('Pose' in fbxGlobals.fbxTree.Objects) {

            const BindPoseNode = fbxGlobals.fbxTree.Objects.Pose;

            for (const nodeID in BindPoseNode) {

                const poseNode = BindPoseNode[nodeID];
                if (poseNode.attrType !== 'BindPose') continue;
                if (!is_fbx_pose_node(poseNode)) throw new Error(`Invalid FBX bind pose ${nodeID}`);
                const poseNodes = poseNode.PoseNode;

                    if (Array.isArray(poseNodes)) {

                        poseNodes.forEach(function (poseEntry) {

                            bindMatrices[String(poseEntry.Node)] = new Matrix4().fromArray(poseEntry.Matrix.a);

                        });

                    } else {

                        bindMatrices[String(poseNodes.Node)] = new Matrix4().fromArray(poseNodes.Matrix.a);

                    }

            }

        }

        return bindMatrices;

    }

    addGlobalSceneSettings (): void {

        if ('GlobalSettings' in fbxGlobals.fbxTree) {

            if ('AmbientColor' in fbxGlobals.fbxTree.GlobalSettings) {

                // Parse ambient color - if it's not set to black (default), create an ambient light

                const ambientColorProperty = fbxGlobals.fbxTree.GlobalSettings.AmbientColor;

                if (!is_property(ambientColorProperty, is_number_array)) return;

                const [r, g, b] = ambientColorProperty.value;

                if (r !== 0 || g !== 0 || b !== 0) {

                    const color = new Color().setRGB(r, g, b, SRGBColorSpace);
                    fbxGlobals.sceneGraph.add(new AmbientLight(color, 1));

                }

            }

            if ('UnitScaleFactor' in fbxGlobals.fbxTree.GlobalSettings) {

                fbxGlobals.sceneGraph.userData.unitScaleFactor = fbxGlobals.fbxTree.GlobalSettings.UnitScaleFactor.value;

            }

        }

    }

}

export { FBXTreeParser }
