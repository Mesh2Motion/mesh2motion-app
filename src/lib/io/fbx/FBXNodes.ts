import type { Bone, BufferGeometry, Color, EulerOrder, Matrix4, Object3D, Texture } from 'three'

/**
 * Dynamically shaped value stored in a parsed FBX document node. FBX nodes can
 * nest arbitrarily and carry scalars, byte buffers or arrays of any of these.
 */
export type FBXNodeValue =
    | null
    | string
    | number
    | boolean
    | ArrayBuffer
    | Uint8Array
    | FBXNodeValue[]
    | FBXNodeObject
    | ((key: string, value: FBXNodeValue) => void)
    | FBXProperty<FBXNodeValue>
    | undefined;

/** Object-shaped FBX node (a dynamic record of named values). */
export interface FBXNodeObject {
    [key: string]: FBXNodeValue;
}

/**
 * A raw node stored in a parsed FBX tree. Common fields are declared explicitly;
 * exporters add arbitrary named children, so the index signature remains.
 */
export interface FBXRawNode extends FBXNodeObject {
    id?: number | string;
    name?: string;
    attrName?: string;
    attrType?: string;
    value?: FBXNodeValue;
    props?: FBXNodeValue;
    a?: FBXNodeValue;
    Vertices?: { a: number[] };
    PolygonVertexIndex?: { a: number[] };
    Normals?: { a: number[] };
    UV?: { a: number[] };
    UVIndex?: { a: number[] };
    DocumentUrl?: { value: FBXNodeValue };
    AmbientColor?: { value: FBXNodeValue };
    Matrix?: { a: FBXNodeValue };
    Node?: FBXRawNode;
    URL?: string;
    Filename?: string;
    type?: FBXNodeValue;
    type2?: FBXNodeValue;
    flag?: FBXNodeValue;
    AspectHeight?: { value: FBXNodeValue };
    AspectWidth?: { value: FBXNodeValue };
    BumpFactor?: { value: FBXNodeValue };
    CameraProjectionType?: { value: FBXNodeValue };
    CastLightOnObject?: { value: FBXNodeValue };
    CastShadows?: { value: FBXNodeValue };
    Color?: { value: FBXNodeValue };
    Diffuse?: { value: FBXNodeValue };
    DiffuseColor?: { value: FBXNodeValue };
    DisplacementFactor?: { value: FBXNodeValue };
    EnableFarAttenuation?: { value: FBXNodeValue };
    FarAttenuationEnd?: { value: FBXNodeValue };
    FarPlane?: { value: FBXNodeValue };
    FieldOfView?: { value: FBXNodeValue };
    FocalLength?: { value: FBXNodeValue };
    InheritType?: { value: FBXNodeValue };
    InnerAngle?: { value: FBXNodeValue };
    Intensity?: { value: FBXNodeValue };
    Lcl_Rotation?: { value: FBXNodeValue };
    Lcl_Scaling?: { value: FBXNodeValue };
    Lcl_Translation?: { value: FBXNodeValue };
    LightType?: { value: FBXNodeValue };
    NearPlane?: { value: FBXNodeValue };
    Opacity?: { value: FBXNodeValue };
    OuterAngle?: { value: FBXNodeValue };
    PostRotation?: { value: FBXNodeValue };
    PreRotation?: { value: FBXNodeValue };
    ReflectionFactor?: { value: FBXNodeValue };
    RotationOffset?: { value: FBXNodeValue };
    RotationOrder?: { value: FBXNodeValue };
    RotationPivot?: { value: FBXNodeValue };
    Scaling?: { value: FBXNodeValue };
    ScalingOffset?: { value: FBXNodeValue };
    ScalingPivot?: { value: FBXNodeValue };
    Shininess?: { value: FBXNodeValue };
    Specular?: { value: FBXNodeValue };
    SpecularColor?: { value: FBXNodeValue };
    Translation?: { value: FBXNodeValue };
    TransparencyFactor?: { value: FBXNodeValue };
    UnitScaleFactor?: { value: FBXNodeValue };
    UpAxis?: { value: FBXNodeValue };
}

/** The known sections of a parsed FBX document. */
export interface FBXTreeObjects extends FBXNodeObject {
    AnimationCurve: Record<string, FBXRawNode>;
    AnimationCurveNode: Record<string, FBXRawNode>;
    AnimationLayer: Record<string, FBXRawNode>;
    AnimationStack: Record<string, FBXRawNode>;
    Deformer: Record<string, FBXRawNode>;
    Geometry: Record<string, FBXRawNode>;
    LayeredTexture: Record<string, FBXRawNode>;
    Material: Record<string, FBXRawNode>;
    Model: Record<string, FBXRawNode>;
    NodeAttribute: Record<string, FBXRawNode>;
    Pose: Record<string, FBXRawNode>;
    Texture: Record<string, FBXRawNode>;
    Video: Record<string, FBXRawNode>;
}

export interface FBXTreeConnections {
    connections: Array<Array<number | string>>;
}

/** A node as produced by BinaryParser / TextParser and consumed by FBXTreeParser. */
export interface FBXParseNode extends FBXNodeObject {
    name: string;
    id?: number;
    attrName?: string;
    attrType?: string;
    singleProperty?: boolean;
    propertyList?: FBXNodeValue[];
    connections?: FBXNodeValue[];
}

/** FBX property values used by the tree parser. */
export interface FBXProperty<T> {
    value: T;
}

export interface FBXValueProperty<T> extends FBXProperty<T> {
    type?: string;
}

/** FBX material fields required by the material adapter. */
export interface FBXMaterialNode extends FBXRawNode {
    id: number;
    attrName: string;
    ShadingModel: string | FBXProperty<string>;
    BumpFactor?: FBXProperty<number>;
    Diffuse?: FBXProperty<number[]>;
    DiffuseColor?: FBXValueProperty<number[]>;
    DisplacementFactor?: FBXProperty<number>;
    Emissive?: FBXProperty<number[]>;
    EmissiveColor?: FBXProperty<number[]>;
    EmissiveFactor?: FBXProperty<number>;
    TransparencyFactor?: FBXProperty<number | string>;
    Opacity?: FBXProperty<number | string | null>;
    ReflectionFactor?: FBXProperty<number>;
    Shininess?: FBXProperty<number>;
    Specular?: FBXProperty<number[]>;
    SpecularColor?: FBXValueProperty<number[]>;
}

/** Material parameters emitted by the FBX material adapter. */
export interface FBXMaterialProperties {
    bumpScale?: number;
    color?: Color;
    displacementScale?: number;
    emissive?: Color;
    opacity: number;
    transparent?: boolean;
    reflectivity?: number;
    shininess?: number;
    specular?: Color;
    bumpMap?: Texture;
    aoMap?: Texture;
    map?: Texture;
    displacementMap?: Texture;
    normalMap?: Texture;
    envMap?: Texture;
    specularMap?: Texture;
    alphaMap?: Texture;
}

export interface FBXRawBoneData {
    ID: number;
    indices: number[];
    weights: number[];
    transformLink: Matrix4;
}

export interface FBXDeformerNode extends FBXRawNode {
    id: number;
    attrName: string;
    attrType: string;
    TransformLink?: { a: number[] };
    Indexes?: { a: number[] };
    Weights?: { a: number[] };
    DeformPercent?: FBXProperty<number>;
    FullWeights?: { a: number[] };
}

export interface FBXSkeletonData {
    ID: string;
    geometryID: number;
    rawBones: FBXRawBoneData[];
    bones: Array<Bone & { ID: number }>;
}

/** Skin data required by geometry conversion before scene bones are resolved. */
export interface FBXGeometrySkeletonData {
    rawBones: Array<Pick<FBXRawBoneData, 'indices' | 'weights'>>;
}

export interface FBXRawMorphTargetData {
    name: string;
    initialWeight: FBXProperty<number> | undefined;
    id: number | string;
    fullWeights: number[];
    geoID?: number;
}

export interface FBXMorphDeformerData {
    id: string;
    rawTargets: FBXRawMorphTargetData[];
}

/** Shared output of FBXTreeParser.parseDeformers and input to geometry parsing. */
export interface FBXDeformerResults {
    skeletons: Record<string, FBXGeometrySkeletonData>;
    morphTargets: Record<string, FBXMorphDeformerData>;
}

/** Fully resolved deformer data after scene model construction. */
export interface FBXSceneDeformerResults {
    skeletons: Record<string, FBXSkeletonData>;
    morphTargets: Record<string, FBXMorphDeformerData>;
}

/** Common transform fields used by model nodes. */
export interface FBXTransformModelNode extends FBXRawNode {
    id: number;
    attrName: string;
    attrType: string;
    InheritType?: FBXProperty<number | string>;
    RotationOrder?: FBXProperty<number>;
    Lcl_Translation?: FBXProperty<number[]>;
    PreRotation?: FBXProperty<number[]>;
    Lcl_Rotation?: FBXProperty<number[]>;
    PostRotation?: FBXProperty<number[]>;
    Lcl_Scaling?: FBXProperty<number[]>;
    ScalingOffset?: FBXProperty<number[]>;
    ScalingPivot?: FBXProperty<number[]>;
    RotationOffset?: FBXProperty<number[]>;
    RotationPivot?: FBXProperty<number[]>;
    LookAtProperty?: FBXProperty<number[]>;
}

export interface FBXCameraAttributeNode extends FBXRawNode {
    id: number;
    CameraProjectionType?: FBXProperty<number>;
    NearPlane?: FBXProperty<number>;
    FarPlane?: FBXProperty<number>;
    AspectWidth?: FBXProperty<number>;
    AspectHeight?: FBXProperty<number>;
    FieldOfView?: FBXProperty<number>;
    FocalLength?: FBXProperty<number>;
}

export interface FBXLightAttributeNode extends FBXRawNode {
    id: number;
    LightType?: FBXProperty<number>;
    Color?: FBXProperty<number[]>;
    Intensity?: FBXProperty<number>;
    CastLightOnObject?: FBXProperty<number>;
    FarAttenuationEnd?: FBXProperty<number>;
    EnableFarAttenuation?: FBXProperty<number>;
    OuterAngle?: FBXProperty<number>;
    InnerAngle?: FBXProperty<number>;
    CastShadows?: FBXProperty<number>;
}

export interface FBXPoseMatrixNode extends FBXNodeObject {
    Node: string | number;
    Matrix: FBXNodeObject & { a: number[] };
}

export interface FBXPoseDataNode extends FBXRawNode {
    attrType?: string;
    NbPoseNodes: number;
    PoseNode: FBXPoseMatrixNode | FBXPoseMatrixNode[];
}

/** A connection row emitted by both the binary and text FBX parsers. */
export type FBXConnectionRow = [fromID: number, toID: number, relationship?: string];

/** Video node fields consumed while resolving external and embedded images. */
export interface FBXVideoNode extends FBXRawNode {
    RelativeFilename?: string;
    Filename: string;
    Content?: string | ArrayBuffer;
}

/** Texture node fields consumed when constructing a Three.js texture. */
export interface FBXTextureNode extends FBXRawNode {
    id: number;
    attrName: string;
    FileName: string;
    WrapModeU?: FBXProperty<number>;
    WrapModeV?: FBXProperty<number>;
    Scaling?: FBXProperty<number[]> | undefined;
    Translation?: FBXProperty<number[]> | undefined;
}

export interface FBXLayerNodeBase {
    MappingInformationType: string;
    ReferenceInformationType: string;
}

export interface FBXNormalLayerNode extends FBXLayerNodeBase {
    Normals: { a: number[] };
    NormalIndex?: { a: number[] };
    NormalsIndex?: { a: number[] };
}

export interface FBXUVLayerNode extends FBXLayerNodeBase {
    UV: { a: number[] };
    UVIndex: { a: number[] };
}

export interface FBXColorLayerNode extends FBXLayerNodeBase {
    Colors: { a: number[] };
    ColorIndex: { a: number[] };
}

export interface FBXMaterialLayerNode extends FBXLayerNodeBase {
    Materials: { a: number[] };
}

export interface FBXAnimationCurve {
    id: number;
    times: number[];
    values: number[];
}

export interface FBXAnimationCurveNode {
    id: number;
    attr: string;
    curves: Partial<Record<'x' | 'y' | 'z' | 'morph', FBXAnimationCurve>>;
}

export interface FBXAnimationLayerNode {
    modelName: string;
    ID?: number;
    morphName?: string;
    initialPosition?: number[];
    initialRotation?: number[];
    initialScale?: number[];
    transform?: Matrix4;
    eulerOrder?: EulerOrder;
    preRotation?: number[];
    postRotation?: number[];
    [name: string]: string | number | number[] | Matrix4 | EulerOrder | FBXAnimationCurveNode | undefined;
}

/** Three.js scene object annotated with the numeric object ID from its FBX node. */
export interface FBXModelObject extends Object3D {
    ID: number;
    geometry?: BufferGeometry;
    target?: Object3D;
}
