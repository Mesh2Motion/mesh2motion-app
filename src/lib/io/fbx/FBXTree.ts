/**
 * Holds the parsed FBX document as a plain object tree.
 * Produced by either `TextParser` (ASCII format) or `BinaryParser` (binary format)
 * and consumed by `FBXTreeParser` to build the Three.js scene graph.
 */

import type { FBXNodeValue, FBXRawNode, FBXTreeConnections, FBXTreeObjects } from './FBXNodes'

interface FBXHeaderExtensionNode extends FBXRawNode {
    SceneInfo: FBXRawNode & { DocumentUrl: { value: FBXNodeValue } };
}

class FBXTree {
    // Declared type-only: the parsers attach these dynamically at runtime.
    declare Objects: FBXTreeObjects;
    declare Connections: FBXTreeConnections;
    declare GlobalSettings: FBXRawNode & {
        UpAxis: { value: FBXNodeValue };
        UnitScaleFactor: { value: FBXNodeValue };
    };
    declare FBXHeaderExtension: FBXHeaderExtensionNode;
    declare CreationTime: FBXRawNode;
    declare Creator: FBXRawNode;

    add (key: string, value: FBXNodeValue): void {
        // Assignment is contained here; consumers use the declared sections above.
        (this as unknown as Record<string, FBXNodeValue>)[key] = value;
    }
}

export { FBXTree }
