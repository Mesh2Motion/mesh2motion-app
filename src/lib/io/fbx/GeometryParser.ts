import {
    BufferGeometry,
    Color,
    ColorManagement,
    Float32BufferAttribute,
    Matrix3,
    Matrix4,
    ShapeUtils,
    SRGBColorSpace,
    Uint16BufferAttribute,
    Vector2,
    Vector3,
    Vector4
} from 'three'
import { NURBSCurve } from 'three/addons/curves/NURBSCurve.js'
import { fbxGlobals } from './fbx-globals'
import { generateTransform, getEulerOrder, getData, type FBXAttributeInfo } from './fbx-utils'
import type { FBXColorLayerNode, FBXMaterialLayerNode, FBXNormalLayerNode, FBXUVLayerNode } from './FBXNodes'

/**
 * Converts geometry nodes from the `FBXTree` into Three.js `BufferGeometry` objects.
 * Handles mesh triangulation, UVs, normals, vertex colours, skin weights,
 * morph targets, and NURBS curves.
 */
class GeometryParser {

    negativeMaterialIndices: boolean;

    constructor () {

        this.negativeMaterialIndices = false;

    }

    // Parse nodes in FBXTree.Objects.Geometry
    parse (deformers: any): Map<number, BufferGeometry | undefined> {

        const geometryMap = new Map();

        if ('Geometry' in fbxGlobals.fbxTree.Objects) {

            const geoNodes = fbxGlobals.fbxTree.Objects.Geometry;

            for (const nodeID in geoNodes) {

                const relationships = fbxGlobals.connections.get(parseInt(nodeID));
                const geo = this.parseGeometry(relationships, geoNodes[nodeID], deformers);

                geometryMap.set(parseInt(nodeID), geo);

            }

        }

        // report warnings

        if (this.negativeMaterialIndices === true) {

            console.warn('THREE.FBXLoader: The FBX file contains invalid (negative) material indices. The asset might not render as expected.');

        }

        return geometryMap;

    }

    // Parse single node in FBXTree.Objects.Geometry
    parseGeometry (relationships: any, geoNode: any, deformers: any): BufferGeometry | undefined {

        switch (geoNode.attrType) {

            case 'Mesh':
                return this.parseMeshGeometry(relationships, geoNode, deformers);

            case 'NurbsCurve':
                return this.parseNurbsGeometry(geoNode);

        }

    }

    // Parse single node mesh geometry in FBXTree.Objects.Geometry
    parseMeshGeometry (relationships: any, geoNode: any, deformers: any): BufferGeometry | undefined {

        const skeletons = deformers.skeletons;
        const morphTargets: any[] = [];

        const modelNodes = relationships.parents.map(function (parent: any) {

            return fbxGlobals.fbxTree.Objects.Model[parent.ID];

        });

        // don't create geometry if it is not associated with any models
        if (modelNodes.length === 0) return;

        const skeleton = relationships.children.reduce(function (skeleton: any, child: any) {

            if (skeletons[child.ID] !== undefined) skeleton = skeletons[child.ID];

            return skeleton;

        }, null);

        relationships.children.forEach(function (child: any) {

            if (deformers.morphTargets[child.ID] !== undefined) {

                morphTargets.push(deformers.morphTargets[child.ID]);

            }

        });

        // Assume one model and get the preRotation from that
        // if there is more than one model associated with the geometry this may cause problems
        const modelNode = modelNodes[0];

        const transformData: any = {};

        if ('RotationOrder' in modelNode) transformData.eulerOrder = getEulerOrder(modelNode.RotationOrder.value);
        if ('InheritType' in modelNode) transformData.inheritType = parseInt(modelNode.InheritType.value);

        if ('GeometricTranslation' in modelNode) transformData.translation = modelNode.GeometricTranslation.value;
        if ('GeometricRotation' in modelNode) transformData.rotation = modelNode.GeometricRotation.value;
        if ('GeometricScaling' in modelNode) transformData.scale = modelNode.GeometricScaling.value;

        const transform = generateTransform(transformData);

        return this.genGeometry(geoNode, skeleton, morphTargets, transform);

    }

    // Generate a BufferGeometry from a node in FBXTree.Objects.Geometry
    genGeometry (geoNode: any, skeleton: any, morphTargets: any[], preTransform: Matrix4): BufferGeometry {

        const geo: BufferGeometry = new BufferGeometry();
        if (geoNode.attrName) geo.name = geoNode.attrName;

        const geoInfo: any = this.parseGeoNode(geoNode, skeleton);
        const buffers = this.genBuffers(geoInfo);

        const positionAttribute = new Float32BufferAttribute(buffers.vertex, 3);

        positionAttribute.applyMatrix4(preTransform);

        geo.setAttribute('position', positionAttribute);

        if (buffers.colors.length > 0) {

            geo.setAttribute('color', new Float32BufferAttribute(buffers.colors, 3));

        }

        if (skeleton) {

            geo.setAttribute('skinIndex', new Uint16BufferAttribute(buffers.weightsIndices, 4));

            geo.setAttribute('skinWeight', new Float32BufferAttribute(buffers.vertexWeights, 4));

            // used later to bind the skeleton to the model
            Object.assign(geo, { FBX_Deformer: skeleton });

        }

        if (buffers.normal.length > 0) {

            const normalMatrix = new Matrix3().getNormalMatrix(preTransform);

            const normalAttribute = new Float32BufferAttribute(buffers.normal, 3);
            normalAttribute.applyNormalMatrix(normalMatrix);

            geo.setAttribute('normal', normalAttribute);

        }

        buffers.uvs.forEach(function (uvBuffer, i) {

            const name = i === 0 ? 'uv' : `uv${i}`;

            geo.setAttribute(name, new Float32BufferAttribute(buffers.uvs[i], 2));

        });

        if (geoInfo.material && geoInfo.material.mappingType !== 'AllSame') {

            // Convert the material indices of each vertex into rendering groups on the geometry.
            let prevMaterialIndex = buffers.materialIndex[0];
            let startIndex = 0;

            buffers.materialIndex.forEach(function (currentIndex, i) {

                if (currentIndex !== prevMaterialIndex) {

                    geo.addGroup(startIndex, i - startIndex, prevMaterialIndex);

                    prevMaterialIndex = currentIndex;
                    startIndex = i;

                }

            });

            // the loop above doesn't add the last group, do that here.
            if (geo.groups.length > 0) {

                const lastGroup = geo.groups[geo.groups.length - 1];
                const lastIndex = lastGroup.start + lastGroup.count;

                if (lastIndex !== buffers.materialIndex.length) {

                    geo.addGroup(lastIndex, buffers.materialIndex.length - lastIndex, prevMaterialIndex);

                }

            }

            // case where there are multiple materials but the whole geometry is only
            // using one of them
            if (geo.groups.length === 0) {

                geo.addGroup(0, buffers.materialIndex.length, buffers.materialIndex[0]);

            }

        }

        this.addMorphTargets(geo, geoNode, morphTargets, preTransform);

        return geo;

    }

    parseGeoNode (geoNode: any, skeleton: any) {

        const geoInfo: any = {};

        geoInfo.vertexPositions = (geoNode.Vertices !== undefined) ? geoNode.Vertices.a : [];
        geoInfo.vertexIndices = (geoNode.PolygonVertexIndex !== undefined) ? geoNode.PolygonVertexIndex.a : [];

        if (geoNode.LayerElementColor && geoNode.LayerElementColor[0].Colors) {

            geoInfo.color = this.parseVertexColors(geoNode.LayerElementColor[0]);

        }

        if (geoNode.LayerElementMaterial) {

            geoInfo.material = this.parseMaterialIndices(geoNode.LayerElementMaterial[0]);

        }

        if (geoNode.LayerElementNormal) {

            geoInfo.normal = this.parseNormals(geoNode.LayerElementNormal[0]);

        }

        if (geoNode.LayerElementUV) {

            geoInfo.uv = [];

            let i = 0;
            while (geoNode.LayerElementUV[i]) {

                if (geoNode.LayerElementUV[i].UV) {

                    geoInfo.uv.push(this.parseUVs(geoNode.LayerElementUV[i]));

                }

                i++;

            }

        }

        geoInfo.weightTable = {};

        if (skeleton !== null) {

            geoInfo.skeleton = skeleton;

            skeleton.rawBones.forEach(function (rawBone: any, i: number) {

                // loop over the bone's vertex indices and weights
                rawBone.indices.forEach(function (index: number, j: number) {

                    // Skin clusters can list vertices with a weight of exactly 0 (some
                    // exporters write the full cluster membership). Carrying those through
                    // would pair a real bone id with a zero weight, which glTF validators
                    // reject on export (ACCESSOR_JOINTS_USED_ZERO_WEIGHT). Dropping them
                    // here lets the padding below fill the slot with joint 0 instead.
                    if (rawBone.weights[j] === 0) return;

                    if (geoInfo.weightTable[index] === undefined) geoInfo.weightTable[index] = [];

                    geoInfo.weightTable[index].push({

                        id: i,
                        weight: rawBone.weights[j],

                    });

                });

            });

        }

        return geoInfo;

    }

    genBuffers (geoInfo: any) {

        const buffers = {
            vertex: [],
            normal: [],
            colors: [],
            uvs: [],
            materialIndex: [],
            vertexWeights: [],
            weightsIndices: [],
        };

        let polygonIndex = 0;
        let faceLength = 0;
        let displayedWeightsWarning = false;

        // these will hold data for a single face
        let facePositionIndexes: number[] = [];
        let faceNormals: number[] = [];
        let faceColors: number[] = [];
        let faceUVs: number[][] = [];
        let faceWeights: number[] = [];
        let faceWeightIndices: number[] = [];

        geoInfo.vertexIndices.forEach((vertexIndex: number, polygonVertexIndex: number) => {

            let materialIndex;
            let endOfFace = false;

            // Face index and vertex index arrays are combined in a single array
            // A cube with quad faces looks like this:
            // PolygonVertexIndex: *24 {
            //  a: 0, 1, 3, -3, 2, 3, 5, -5, 4, 5, 7, -7, 6, 7, 1, -1, 1, 7, 5, -4, 6, 0, 2, -5
            //  }
            // Negative numbers mark the end of a face - first face here is 0, 1, 3, -3
            // to find index of last vertex bit shift the index: ^ - 1
            if (vertexIndex < 0) {

                vertexIndex = vertexIndex ^ - 1; // equivalent to ( x * -1 ) - 1
                endOfFace = true;

            }

            let weightIndices: number[] = [];
            let weights: number[] = [];

            facePositionIndexes.push(vertexIndex * 3, vertexIndex * 3 + 1, vertexIndex * 3 + 2);

            if (geoInfo.color) {

                const data = getData(polygonVertexIndex, polygonIndex, vertexIndex, geoInfo.color);

                faceColors.push(data[0], data[1], data[2]);

            }

            if (geoInfo.skeleton) {

                if (geoInfo.weightTable[vertexIndex] !== undefined) {

                    geoInfo.weightTable[vertexIndex].forEach(function (wt: any) {

                        weights.push(wt.weight);
                        weightIndices.push(wt.id);

                    });


                }

                if (weights.length > 4) {

                    if (!displayedWeightsWarning) {

                        console.warn('THREE.FBXLoader: Vertex has more than 4 skinning weights assigned to vertex. Deleting additional weights.');
                        displayedWeightsWarning = true;

                    }

                    const wIndex = [0, 0, 0, 0];
                    const Weight = [0, 0, 0, 0];

                    weights.forEach(function (weight, weightIndex) {

                        let currentWeight = weight;
                        let currentIndex = weightIndices[weightIndex];

                        Weight.forEach(function (comparedWeight, comparedWeightIndex, comparedWeightArray) {

                            if (currentWeight > comparedWeight) {

                                comparedWeightArray[comparedWeightIndex] = currentWeight;
                                currentWeight = comparedWeight;

                                const tmp = wIndex[comparedWeightIndex];
                                wIndex[comparedWeightIndex] = currentIndex;
                                currentIndex = tmp;

                            }

                        });

                    });

                    weightIndices = wIndex;
                    weights = Weight;

                }

                // if the weight array is shorter than 4 pad with 0s
                while (weights.length < 4) {

                    weights.push(0);
                    weightIndices.push(0);

                }

                // Skinning assumes the four weights on a vertex add up to 1. FBX files
                // do not guarantee that, and dropping the extra influences above makes
                // the total smaller still, which pulls those vertices toward the origin
                // once the mesh is posed or exported to glTF.
                const weightTotal = weights[0] + weights[1] + weights[2] + weights[3];

                if (weightTotal > 0) {

                    for (let i = 0; i < 4; ++i) {

                        weights[i] = weights[i] / weightTotal;

                    }

                }

                for (let i = 0; i < 4; ++i) {

                    faceWeights.push(weights[i]);
                    faceWeightIndices.push(weightIndices[i]);

                }

            }

            if (geoInfo.normal) {

                const data = getData(polygonVertexIndex, polygonIndex, vertexIndex, geoInfo.normal);

                faceNormals.push(data[0], data[1], data[2]);

            }

            if (geoInfo.material && geoInfo.material.mappingType !== 'AllSame') {

                materialIndex = getData(polygonVertexIndex, polygonIndex, vertexIndex, geoInfo.material)[0];

                if (materialIndex < 0) {

                    this.negativeMaterialIndices = true;
                    materialIndex = 0; // fallback

                }

            }

            if (geoInfo.uv) {

                geoInfo.uv.forEach(function (uv: any, i: number) {

                    const data = getData(polygonVertexIndex, polygonIndex, vertexIndex, uv);

                    if (faceUVs[i] === undefined) {

                        faceUVs[i] = [];

                    }

                    faceUVs[i].push(data[0]);
                    faceUVs[i].push(data[1]);

                });

            }

            faceLength++;

            if (endOfFace) {

                this.genFace(buffers, geoInfo, facePositionIndexes, materialIndex ?? 0, faceNormals, faceColors, faceUVs, faceWeights, faceWeightIndices, faceLength);

                polygonIndex++;
                faceLength = 0;

                // reset arrays for the next face
                facePositionIndexes = [];
                faceNormals = [];
                faceColors = [];
                faceUVs = [];
                faceWeights = [];
                faceWeightIndices = [];

            }

        });

        return buffers;

    }

    // See https://www.khronos.org/opengl/wiki/Calculating_a_Surface_Normal
    getNormalNewell (vertices: Vector3[]): Vector3 {

        const normal = new Vector3(0.0, 0.0, 0.0);

        for (let i = 0; i < vertices.length; i++) {

            const current = vertices[i];
            const next = vertices[(i + 1) % vertices.length];

            normal.x += (current.y - next.y) * (current.z + next.z);
            normal.y += (current.z - next.z) * (current.x + next.x);
            normal.z += (current.x - next.x) * (current.y + next.y);

        }

        normal.normalize();

        return normal;

    }

    getNormalTangentAndBitangent (vertices: Vector3[]): { normal: Vector3; tangent: Vector3; bitangent: Vector3 } {

        const normalVector = this.getNormalNewell(vertices);
        // Avoid up being equal or almost equal to normalVector
        const up = Math.abs(normalVector.z) > 0.5 ? new Vector3(0.0, 1.0, 0.0) : new Vector3(0.0, 0.0, 1.0);
        const tangent = up.cross(normalVector).normalize();
        const bitangent = normalVector.clone().cross(tangent).normalize();

        return {
            normal: normalVector,
            tangent: tangent,
            bitangent: bitangent
        };

    }

    flattenVertex (vertex: Vector3, normalTangent: Vector3, normalBitangent: Vector3): Vector2 {

        return new Vector2(
            vertex.dot(normalTangent),
            vertex.dot(normalBitangent)
        );

    }

    // Generate data for a single face in a geometry. If the face is a quad then split it into 2 tris
    genFace (buffers: any, geoInfo: any, facePositionIndexes: number[], materialIndex: number, faceNormals: number[], faceColors: number[], faceUVs: number[][], faceWeights: number[], faceWeightIndices: number[], faceLength: number) {

        let triangles;

        if (faceLength > 3) {

            // Triangulate n-gon using earcut

            const vertices = [];
            // in morphing scenario vertexPositions represent morphPositions
            // while baseVertexPositions represent the original geometry's positions
            const positions = geoInfo.baseVertexPositions || geoInfo.vertexPositions;
            for (let i = 0; i < facePositionIndexes.length; i += 3) {

                vertices.push(
                    new Vector3(
                        positions[facePositionIndexes[i]],
                        positions[facePositionIndexes[i + 1]],
                        positions[facePositionIndexes[i + 2]]
                    )
                );

            }

            const { tangent, bitangent } = this.getNormalTangentAndBitangent(vertices);
            const triangulationInput = [];

            for (const vertex of vertices) {

                triangulationInput.push(this.flattenVertex(vertex, tangent, bitangent));

            }

            // When vertices is an array of [0,0,0] elements (which is the case for vertices not participating in morph)
            // the triangulationInput will be an array of [0,0] elements
            // resulting in an array of 0 triangles being returned from ShapeUtils.triangulateShape
            // leading to not pushing into buffers.vertex the redundant vertices (the vertices that are not morphed).
            // That's why, in order to support morphing scenario, "positions" is looking first for baseVertexPositions,
            // so that we don't end up with an array of 0 triangles for the faces not participating in morph.
            triangles = ShapeUtils.triangulateShape(triangulationInput, []);

        } else {

            // Regular triangle, skip earcut triangulation step
            triangles = [[0, 1, 2]];

        }

        for (const [i0, i1, i2] of triangles) {

            buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i0 * 3]]);
            buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i0 * 3 + 1]]);
            buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i0 * 3 + 2]]);

            buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i1 * 3]]);
            buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i1 * 3 + 1]]);
            buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i1 * 3 + 2]]);

            buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i2 * 3]]);
            buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i2 * 3 + 1]]);
            buffers.vertex.push(geoInfo.vertexPositions[facePositionIndexes[i2 * 3 + 2]]);

            if (geoInfo.skeleton) {

                buffers.vertexWeights.push(faceWeights[i0 * 4]);
                buffers.vertexWeights.push(faceWeights[i0 * 4 + 1]);
                buffers.vertexWeights.push(faceWeights[i0 * 4 + 2]);
                buffers.vertexWeights.push(faceWeights[i0 * 4 + 3]);

                buffers.vertexWeights.push(faceWeights[i1 * 4]);
                buffers.vertexWeights.push(faceWeights[i1 * 4 + 1]);
                buffers.vertexWeights.push(faceWeights[i1 * 4 + 2]);
                buffers.vertexWeights.push(faceWeights[i1 * 4 + 3]);

                buffers.vertexWeights.push(faceWeights[i2 * 4]);
                buffers.vertexWeights.push(faceWeights[i2 * 4 + 1]);
                buffers.vertexWeights.push(faceWeights[i2 * 4 + 2]);
                buffers.vertexWeights.push(faceWeights[i2 * 4 + 3]);

                buffers.weightsIndices.push(faceWeightIndices[i0 * 4]);
                buffers.weightsIndices.push(faceWeightIndices[i0 * 4 + 1]);
                buffers.weightsIndices.push(faceWeightIndices[i0 * 4 + 2]);
                buffers.weightsIndices.push(faceWeightIndices[i0 * 4 + 3]);

                buffers.weightsIndices.push(faceWeightIndices[i1 * 4]);
                buffers.weightsIndices.push(faceWeightIndices[i1 * 4 + 1]);
                buffers.weightsIndices.push(faceWeightIndices[i1 * 4 + 2]);
                buffers.weightsIndices.push(faceWeightIndices[i1 * 4 + 3]);

                buffers.weightsIndices.push(faceWeightIndices[i2 * 4]);
                buffers.weightsIndices.push(faceWeightIndices[i2 * 4 + 1]);
                buffers.weightsIndices.push(faceWeightIndices[i2 * 4 + 2]);
                buffers.weightsIndices.push(faceWeightIndices[i2 * 4 + 3]);

            }

            if (geoInfo.color) {

                buffers.colors.push(faceColors[i0 * 3]);
                buffers.colors.push(faceColors[i0 * 3 + 1]);
                buffers.colors.push(faceColors[i0 * 3 + 2]);

                buffers.colors.push(faceColors[i1 * 3]);
                buffers.colors.push(faceColors[i1 * 3 + 1]);
                buffers.colors.push(faceColors[i1 * 3 + 2]);

                buffers.colors.push(faceColors[i2 * 3]);
                buffers.colors.push(faceColors[i2 * 3 + 1]);
                buffers.colors.push(faceColors[i2 * 3 + 2]);

            }

            if (geoInfo.material && geoInfo.material.mappingType !== 'AllSame') {

                buffers.materialIndex.push(materialIndex);
                buffers.materialIndex.push(materialIndex);
                buffers.materialIndex.push(materialIndex);

            }

            if (geoInfo.normal) {

                buffers.normal.push(faceNormals[i0 * 3]);
                buffers.normal.push(faceNormals[i0 * 3 + 1]);
                buffers.normal.push(faceNormals[i0 * 3 + 2]);

                buffers.normal.push(faceNormals[i1 * 3]);
                buffers.normal.push(faceNormals[i1 * 3 + 1]);
                buffers.normal.push(faceNormals[i1 * 3 + 2]);

                buffers.normal.push(faceNormals[i2 * 3]);
                buffers.normal.push(faceNormals[i2 * 3 + 1]);
                buffers.normal.push(faceNormals[i2 * 3 + 2]);

            }

            if (geoInfo.uv) {

                geoInfo.uv.forEach(function (uv: any, j: number) {

                    if (buffers.uvs[j] === undefined) buffers.uvs[j] = [];

                    buffers.uvs[j].push(faceUVs[j][i0 * 2]);
                    buffers.uvs[j].push(faceUVs[j][i0 * 2 + 1]);

                    buffers.uvs[j].push(faceUVs[j][i1 * 2]);
                    buffers.uvs[j].push(faceUVs[j][i1 * 2 + 1]);

                    buffers.uvs[j].push(faceUVs[j][i2 * 2]);
                    buffers.uvs[j].push(faceUVs[j][i2 * 2 + 1]);

                });

            }

        }

    }

    addMorphTargets (parentGeo: any, parentGeoNode: any, morphTargets: any[], preTransform: any) {

        if (morphTargets.length === 0) return;

        parentGeo.morphTargetsRelative = true;

        parentGeo.morphAttributes.position = [];
        // parentGeo.morphAttributes.normal = []; // not implemented

        // Morph attribute positions are stored as deltas (morphTargetsRelative = true), so the
        // translation component of the geometric transform must not be applied to them — only the
        // rotation/scale part. Otherwise every delta gets the geometric translation added, which
        // shifts morphed vertices away from their intended position by `weight * translation` as
        // the influence increases.
        const morphPreTransform = preTransform.clone().setPosition(0, 0, 0);

        morphTargets.forEach((morphTarget: any) => {

            morphTarget.rawTargets.forEach((rawTarget: any) => {

                const morphGeoNode = fbxGlobals.fbxTree.Objects.Geometry[rawTarget.geoID];

                if (morphGeoNode !== undefined) {

                    this.genMorphGeometry(parentGeo, parentGeoNode, morphGeoNode, morphPreTransform, rawTarget.name);

                }

            });

        });

    }

    // a morph geometry node is similar to a standard node, and the node is also contained
    // in FBXTree.Objects.Geometry, however it can only have attributes for position, normal
    // and a special attribute Index defining which vertices of the original geometry are affected
    // Normal and position attributes only have data for the vertices that are affected by the morph
    genMorphGeometry (parentGeo: any, parentGeoNode: any, morphGeoNode: any, preTransform: any, name: string) {

        const basePositions = parentGeoNode.Vertices !== undefined ? parentGeoNode.Vertices.a : [];
        const baseIndices = parentGeoNode.PolygonVertexIndex !== undefined ? parentGeoNode.PolygonVertexIndex.a : [];

        const morphPositionsSparse = morphGeoNode.Vertices !== undefined ? morphGeoNode.Vertices.a : [];
        const morphIndices = morphGeoNode.Indexes !== undefined ? morphGeoNode.Indexes.a : [];

        const length = parentGeo.attributes.position.count * 3;
        const morphPositions = new Float32Array(length);

        for (let i = 0; i < morphIndices.length; i++) {

            const morphIndex = morphIndices[i] * 3;

            morphPositions[morphIndex] = morphPositionsSparse[i * 3];
            morphPositions[morphIndex + 1] = morphPositionsSparse[i * 3 + 1];
            morphPositions[morphIndex + 2] = morphPositionsSparse[i * 3 + 2];

        }

        // TODO: add morph normal support
        const morphGeoInfo = {
            vertexIndices: baseIndices,
            vertexPositions: morphPositions,
            baseVertexPositions: basePositions
        };

        const morphBuffers = this.genBuffers(morphGeoInfo);

        const positionAttribute = new Float32BufferAttribute(morphBuffers.vertex, 3);
        positionAttribute.name = name || morphGeoNode.attrName;

        positionAttribute.applyMatrix4(preTransform);

        parentGeo.morphAttributes.position.push(positionAttribute);

    }

    // Parse normal from FBXTree.Objects.Geometry.LayerElementNormal if it exists
    parseNormals (NormalNode: FBXNormalLayerNode): FBXAttributeInfo {

        const mappingType = NormalNode.MappingInformationType;
        const referenceType = NormalNode.ReferenceInformationType;
        const buffer = NormalNode.Normals.a;
        let indexBuffer: number[] = [];
        if (referenceType === 'IndexToDirect') {

            if (NormalNode.NormalIndex !== undefined) {

                indexBuffer = NormalNode.NormalIndex.a;

            } else if (NormalNode.NormalsIndex !== undefined) {

                indexBuffer = NormalNode.NormalsIndex.a;

            }

        }

        return {
            dataSize: 3,
            buffer: buffer,
            indices: indexBuffer,
            mappingType: mappingType,
            referenceType: referenceType
        };

    }

    // Parse UVs from FBXTree.Objects.Geometry.LayerElementUV if it exists
    parseUVs (UVNode: FBXUVLayerNode): FBXAttributeInfo {

        const mappingType = UVNode.MappingInformationType;
        const referenceType = UVNode.ReferenceInformationType;
        const buffer = UVNode.UV.a;
        let indexBuffer: number[] = [];
        if (referenceType === 'IndexToDirect') {

            indexBuffer = UVNode.UVIndex.a;

        }

        return {
            dataSize: 2,
            buffer: buffer,
            indices: indexBuffer,
            mappingType: mappingType,
            referenceType: referenceType
        };

    }

    // Parse Vertex Colors from FBXTree.Objects.Geometry.LayerElementColor if it exists
    parseVertexColors (ColorNode: FBXColorLayerNode): FBXAttributeInfo {

        const mappingType = ColorNode.MappingInformationType;
        const referenceType = ColorNode.ReferenceInformationType;
        const buffer = ColorNode.Colors.a;
        let indexBuffer: number[] = [];
        if (referenceType === 'IndexToDirect') {

            indexBuffer = ColorNode.ColorIndex.a;

        }

        for (let i = 0, c = new Color(); i < buffer.length; i += 4) {

            c.fromArray(buffer, i);
            ColorManagement.colorSpaceToWorking(c, SRGBColorSpace);
            c.toArray(buffer, i);

        }

        return {
            dataSize: 4,
            buffer: buffer,
            indices: indexBuffer,
            mappingType: mappingType,
            referenceType: referenceType
        };

    }

    // Parse mapping and material data in FBXTree.Objects.Geometry.LayerElementMaterial if it exists
    parseMaterialIndices (MaterialNode: FBXMaterialLayerNode): FBXAttributeInfo {

        const mappingType = MaterialNode.MappingInformationType;
        const referenceType = MaterialNode.ReferenceInformationType;

        if (mappingType === 'NoMappingInformation') {

            return {
                dataSize: 1,
                buffer: [0],
                indices: [0],
                mappingType: 'AllSame',
                referenceType: referenceType
            };

        }

        const materialIndexBuffer = MaterialNode.Materials.a;

        // Since materials are stored as indices, there's a bit of a mismatch between FBX and what
        // we expect. So we create an intermediate buffer that points to the index in the buffer,
        // for conforming with the other functions we've written for other data.
        const materialIndices = [];

        for (let i = 0; i < materialIndexBuffer.length; ++i) {

            materialIndices.push(i);

        }

        return {
            dataSize: 1,
            buffer: materialIndexBuffer,
            indices: materialIndices,
            mappingType: mappingType,
            referenceType: referenceType
        };

    }

    // Generate a NurbGeometry from a node in FBXTree.Objects.Geometry
    parseNurbsGeometry (geoNode: any): BufferGeometry {

        const order = parseInt(geoNode.Order);

        if (isNaN(order)) {

            console.error('THREE.FBXLoader: Invalid Order %s given for geometry ID: %s', geoNode.Order, geoNode.id);
            return new BufferGeometry();

        }

        const degree = order - 1;

        const knots = geoNode.KnotVector.a;
        const controlPoints: Vector4[] = [];
        const pointsValues = geoNode.Points.a;

        for (let i = 0, l = pointsValues.length; i < l; i += 4) {

            controlPoints.push(new Vector4().fromArray(pointsValues, i));

        }

        let startKnot: number | undefined, endKnot: number | undefined;

        if (geoNode.Form === 'Closed') {

            controlPoints.push(controlPoints[0]);

        } else if (geoNode.Form === 'Periodic') {

            startKnot = degree;
            endKnot = knots.length - 1 - startKnot;

            for (let i = 0; i < degree; ++i) {

                controlPoints.push(controlPoints[i]);

            }

        }

        const curve = new NURBSCurve(degree, knots, controlPoints, startKnot, endKnot);
        const points = curve.getPoints(controlPoints.length * 12);

        return new BufferGeometry().setFromPoints(points);

    }

}

export { GeometryParser }
