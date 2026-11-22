import type { EulerOrder, Matrix4, Object3D } from 'three'

/**
 * Dynamically shaped value stored in a parsed FBX document node. FBX nodes can
 * nest arbitrarily and carry scalars, byte buffers or arrays of any of these.
 */
export type FBXNodeValue =
    | string
    | number
    | boolean
    | ArrayBuffer
    | Uint8Array
    | FBXNodeValue[]
    | FBXNodeObject
    | ((key: string, value: FBXNodeValue) => void)
    | FBXProperty<number>
    | FBXProperty<number[]>
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
}
