import type { FBXNodeObject, FBXNodeValue } from './FBXNodes'

/** Runtime check for the plain object records emitted by the ASCII and binary parsers. */
export function isFBXNodeObject (value: FBXNodeValue | undefined): value is FBXNodeObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof ArrayBuffer) && !(value instanceof Uint8Array)
}

export function readFBXNodeObject (value: FBXNodeValue | undefined, context: string): FBXNodeObject {
    if (!isFBXNodeObject(value)) throw new Error(`Invalid FBX object at ${context}`);
    return value;
}

export function readFBXNodeArray (value: FBXNodeValue | undefined, context: string): FBXNodeValue[] {
    if (!Array.isArray(value)) throw new Error(`Invalid FBX array at ${context}`);
    return value;
}

export function readFBXNumber (value: FBXNodeValue, context: string): number {
    if (typeof value !== 'number') throw new Error(`Invalid FBX number at ${context}`);
    return value;
}

export function readFBXString (value: FBXNodeValue, context: string): string {
    if (typeof value !== 'string') throw new Error(`Invalid FBX string at ${context}`);
    return value;
}

export function readFBXNumberArray (value: FBXNodeValue, context: string): number[] {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'number')) throw new Error(`Invalid FBX number array at ${context}`);
    return value;
}

export function readFBXProperty<T extends FBXNodeValue> (
    value: FBXNodeValue | undefined,
    isValue: (candidate: FBXNodeValue) => candidate is T,
    context: string
): T {
    if (!isFBXNodeObject(value) || !('value' in value) || !isValue(value.value)) throw new Error(`Invalid FBX property at ${context}`);
    return value.value;
}
