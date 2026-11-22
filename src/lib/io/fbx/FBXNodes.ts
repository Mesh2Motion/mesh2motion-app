import type { Object3D } from 'three'

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

/** Three.js scene object annotated with the numeric object ID from its FBX node. */
export interface FBXModelObject extends Object3D {
    ID: number;
}
