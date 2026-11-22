import type { EulerOrder, Matrix4, Object3D } from 'three'

/** FBX property values used by the tree parser. */
export interface FBXProperty<T> {
    value: T;
}

/** A connection row emitted by both the binary and text FBX parsers. */
export type FBXConnectionRow = [fromID: number, toID: number, relationship?: string];

/** Video node fields consumed while resolving external and embedded images. */
export interface FBXVideoNode {
    RelativeFilename?: string;
    Filename: string;
    Content?: string | ArrayBuffer;
}

/** Texture node fields consumed when constructing a Three.js texture. */
export interface FBXTextureNode {
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
