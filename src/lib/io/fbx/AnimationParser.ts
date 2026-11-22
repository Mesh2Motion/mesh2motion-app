import {
    AnimationClip,
    Euler,
    type EulerOrder,
    MathUtils,
    Matrix4,
    NumberKeyframeTrack,
    type Object3D,
    PropertyBinding,
    Quaternion,
    QuaternionKeyframeTrack,
    type KeyframeTrack,
    Vector3,
    VectorKeyframeTrack
} from 'three'
import { fbxGlobals } from './fbx-globals'
import { convertFBXTimeToSeconds, getEulerOrder } from './fbx-utils'
import type {
    FBXAnimationCurve,
    FBXAnimationCurveNode,
    FBXAnimationLayerNode,
    FBXModelObject,
    FBXNodeValue,
    FBXRawNode
} from './FBXNodes'

/** A times/values pair for one animated axis. Synchronised curves have no id. */
interface AnimationCurveData {
    times: number[];
    values: number[];
}

/** The set of animated channels attached to a curve node. */
type AnimationCurves = Partial<Record<'x' | 'y' | 'z' | 'morph', FBXAnimationCurve>>;

/** An animation layer entry whose transform channels are typed curve nodes. */
interface RawAnimationTracks extends FBXAnimationLayerNode {
    T?: FBXAnimationCurveNode;
    R?: FBXAnimationCurveNode;
    S?: FBXAnimationCurveNode;
    DeformPercent?: FBXAnimationCurveNode;
}

/** A raw clip pairing an animation stack name with its layer entries. */
interface RawClip {
    name: string;
    layer: RawAnimationTracks[];
}

/** Three.js object carrying morph target metadata. */
interface MorphTargetObject extends Object3D {
    morphTargetDictionary?: Record<string, number>;
}

/** Asserts that a dynamically shaped FBX value is an object-shaped raw node. */
function as_node (value: FBXNodeValue | undefined): FBXRawNode {
    return value as FBXRawNode;
}

/** Asserts that a dynamically shaped FBX value is an array of numbers. */
function as_numbers (value: FBXNodeValue | undefined): number[] {
    return value as number[];
}

/**
 * Converts animation data from the `FBXTree` into Three.js `AnimationClip` objects.
 * Processes `AnimationStack`, `AnimationLayer`, and `AnimationCurveNode` hierarchies,
 * interpolating rotation curves and applying pre/post rotations where needed.
 */
class AnimationParser {

    // take raw animation clips and turn them into three.js animation clips
    parse (): AnimationClip[] {

        const animationClips: AnimationClip[] = [];

        const rawClips = this.parseClips();

        if (rawClips !== undefined) {

            for (const key in rawClips) {

                const rawClip = rawClips[key];

                const clip = this.addClip(rawClip);

                animationClips.push(clip);

            }

        }

        return animationClips;

    }

    parseClips () {

        // since the actual transformation data is stored in FBXTree.Objects.AnimationCurve,
        // if this is undefined we can safely assume there are no animations
        if (fbxGlobals.fbxTree.Objects.AnimationCurve === undefined) return undefined;

        const curveNodesMap = this.parseAnimationCurveNodes();

        this.parseAnimationCurves(curveNodesMap);

        const layersMap = this.parseAnimationLayers(curveNodesMap);
        const rawClips = this.parseAnimStacks(layersMap);

        return rawClips;

    }

    // parse nodes in FBXTree.Objects.AnimationCurveNode
    // each AnimationCurveNode holds data for an animation transform for a model (e.g. left arm rotation )
    // and is referenced by an AnimationLayer
    parseAnimationCurveNodes () {

        const rawCurveNodes = fbxGlobals.fbxTree.Objects.AnimationCurveNode;

        const curveNodesMap = new Map<number, FBXAnimationCurveNode>();

        for (const nodeID in rawCurveNodes) {

            const rawCurveNode = rawCurveNodes[nodeID];

            if (rawCurveNode.attrName!.match(/S|R|T|DeformPercent/) !== null) {

                const curveNode: FBXAnimationCurveNode = {

                    id: rawCurveNode.id as number,
                    attr: rawCurveNode.attrName!,
                    curves: {},

                };

                curveNodesMap.set(curveNode.id, curveNode);

            }

        }

        return curveNodesMap;

    }

    // parse nodes in FBXTree.Objects.AnimationCurve and connect them up to
    // previously parsed AnimationCurveNodes. Each AnimationCurve holds data for a single animated
    // axis ( e.g. times and values of x rotation)
    parseAnimationCurves (curveNodesMap: Map<number, FBXAnimationCurveNode>) {

        const rawCurves = fbxGlobals.fbxTree.Objects.AnimationCurve;

        // TODO: Many values are identical up to roundoff error, but won't be optimised
        // e.g. position times: [0, 0.4, 0. 8]
        // position values: [7.23538335023477e-7, 93.67518615722656, -0.9982695579528809, 7.23538335023477e-7, 93.67518615722656, -0.9982695579528809, 7.235384487103147e-7, 93.67520904541016, -0.9982695579528809]
        // clearly, this should be optimised to
        // times: [0], positions [7.23538335023477e-7, 93.67518615722656, -0.9982695579528809]
        // this shows up in nearly every FBX file, and generally time array is length > 100

        for (const nodeID in rawCurves) {

            const rawCurve = as_node(rawCurves[nodeID]);

            const animationCurve: FBXAnimationCurve = {

                id: rawCurve.id as number,
                times: as_numbers(as_node(rawCurve.KeyTime).a).map(convertFBXTimeToSeconds),
                values: as_numbers(as_node(rawCurve.KeyValueFloat).a),

            };

            const relationships = fbxGlobals.connections.get(animationCurve.id);

            if (relationships !== undefined) {

                const animationCurveID = relationships.parents[0].ID;
                const animationCurveRelationship = relationships.parents[0].relationship;

                if (animationCurveRelationship?.match(/X/)) {

                    curveNodesMap.get(animationCurveID)!.curves['x'] = animationCurve;

                } else if (animationCurveRelationship?.match(/Y/)) {

                    curveNodesMap.get(animationCurveID)!.curves['y'] = animationCurve;

                } else if (animationCurveRelationship?.match(/Z/)) {

                    curveNodesMap.get(animationCurveID)!.curves['z'] = animationCurve;

                } else if (animationCurveRelationship?.match(/DeformPercent/) && curveNodesMap.has(animationCurveID)) {

                    curveNodesMap.get(animationCurveID)!.curves['morph'] = animationCurve;

                }

            }

        }

    }

    // parse nodes in FBXTree.Objects.AnimationLayer. Each layers holds references
    // to various AnimationCurveNodes and is referenced by an AnimationStack node
    // note: theoretically a stack can have multiple layers, however in practice there always seems to be one per stack
    parseAnimationLayers (curveNodesMap: Map<number, FBXAnimationCurveNode>) {

        const rawLayers = fbxGlobals.fbxTree.Objects.AnimationLayer;

        const layersMap = new Map<number, RawAnimationTracks[]>();

        for (const nodeID in rawLayers) {

            const layerCurveNodes: RawAnimationTracks[] = [];

            const connection = fbxGlobals.connections.get(parseInt(nodeID));

            if (connection !== undefined) {

                // all the animationCurveNodes used in the layer
                const children = connection.children;

                children.forEach((child, i) => {

                    const curveNode = curveNodesMap.get(child.ID);
                    if (curveNode !== undefined) {

                        // check that the curves are defined for at least one axis, otherwise ignore the curveNode
                        if (curveNode.curves.x !== undefined || curveNode.curves.y !== undefined || curveNode.curves.z !== undefined) {

                            if (layerCurveNodes[i] === undefined) {

                                const filteredParents = fbxGlobals.connections.get(child.ID)!.parents.filter((parent) => {

                                    return parent.relationship !== undefined;

                                });

                                if (filteredParents.length === 0) return;

                                const modelID = filteredParents[0].ID;

                                if (modelID !== undefined) {

                                    const rawModel = fbxGlobals.fbxTree.Objects.Model[modelID.toString()];

                                    if (rawModel === undefined) {

                                        console.warn('THREE.FBXLoader: Encountered a unused curve.', child);
                                        return;

                                    }

                                    const node: FBXAnimationLayerNode = {

                                        modelName: rawModel.attrName ? PropertyBinding.sanitizeNodeName(rawModel.attrName) : '',
                                        ID: rawModel.id as number,
                                        initialPosition: [0, 0, 0],
                                        initialRotation: [0, 0, 0],
                                        initialScale: [1, 1, 1],

                                    };

                                    fbxGlobals.sceneGraph.traverse((child) => {

                                        if ((child as FBXModelObject).ID === rawModel.id) {

                                            node.transform = child.matrix;

                                            if (child.userData.transformData) {

                                                node.eulerOrder = child.userData.transformData.eulerOrder;

                                                if (child.userData.transformData.rotation) node.initialRotation = child.userData.transformData.rotation;

                                            }

                                        }

                                    });

                                    if (!node.transform) node.transform = new Matrix4();

                                    // if the animated model is pre rotated, we'll have to apply the pre rotations to every
                                    // animation value as well
                                    if ('PreRotation' in rawModel) node.preRotation = as_numbers(rawModel.PreRotation!.value);
                                    if ('PostRotation' in rawModel) node.postRotation = as_numbers(rawModel.PostRotation!.value);

                                    layerCurveNodes[i] = node;

                                }

                            }

                            if (layerCurveNodes[i]) layerCurveNodes[i][curveNode.attr] = curveNode;

                        } else if (curveNode.curves.morph !== undefined) {

                            if (layerCurveNodes[i] === undefined) {

                                const filteredParents = fbxGlobals.connections.get(child.ID)!.parents.filter((parent) => {

                                    return parent.relationship !== undefined;

                                });

                                if (filteredParents.length === 0) return;

                                const deformerID = filteredParents[0].ID;

                                const morpherID = fbxGlobals.connections.get(deformerID)!.parents[0].ID;
                                const geoID = fbxGlobals.connections.get(morpherID)!.parents[0].ID;

                                // assuming geometry is not used in more than one model
                                const modelID = fbxGlobals.connections.get(geoID)!.parents[0].ID;

                                const rawModel = fbxGlobals.fbxTree.Objects.Model[modelID];

                                const node: FBXAnimationLayerNode = {

                                    modelName: rawModel.attrName ? PropertyBinding.sanitizeNodeName(rawModel.attrName) : '',
                                    morphName: fbxGlobals.fbxTree.Objects.Deformer[deformerID].attrName,

                                };

                                layerCurveNodes[i] = node;

                            }

                            layerCurveNodes[i][curveNode.attr] = curveNode;

                        }

                    }

                });

                layersMap.set(parseInt(nodeID), layerCurveNodes);

            }

        }

        return layersMap;

    }

    // parse nodes in FBXTree.Objects.AnimationStack. These are the top level node in the animation
    // hierarchy. Each Stack node will be used to create an AnimationClip
    parseAnimStacks (layersMap: Map<number, RawAnimationTracks[]>): Record<string, RawClip> {

        const rawStacks = fbxGlobals.fbxTree.Objects.AnimationStack;

        // connect the stacks (clips) up to the layers
        const rawClips: Record<string, RawClip> = {};

        for (const nodeID in rawStacks) {

            const children = fbxGlobals.connections.get(parseInt(nodeID))!.children;

            if (children.length > 1) {

                // it seems like stacks will always be associated with a single layer. But just in case there are files
                // where there are multiple layers per stack, we'll display a warning
                console.warn('THREE.FBXLoader: Encountered an animation stack with multiple layers, this is currently not supported. Ignoring subsequent layers.');

            }

            const layer = layersMap.get(children[0].ID);

            rawClips[nodeID] = {

                name: rawStacks[nodeID].attrName!,
                layer: layer!,

            };

        }

        return rawClips;

    }

    addClip (rawClip: RawClip): AnimationClip {

        let tracks: KeyframeTrack[] = [];

        rawClip.layer.forEach((rawTracks) => {

            tracks = tracks.concat(this.generateTracks(rawTracks));

        });

        return new AnimationClip(rawClip.name, - 1, tracks);

    }

    generateTracks (rawTracks: RawAnimationTracks): KeyframeTrack[] {

        const tracks: KeyframeTrack[] = [];

        const initPositionVec = new Vector3();
        const initScaleVec = new Vector3();

        if (rawTracks.transform) rawTracks.transform.decompose(initPositionVec, new Quaternion(), initScaleVec);

        const initialPosition = initPositionVec.toArray();
        const initialScale = initScaleVec.toArray();

        if (rawTracks.T !== undefined && Object.keys(rawTracks.T.curves).length > 0) {

            const positionTrack = this.generateVectorTrack(rawTracks.modelName, rawTracks.T.curves, initialPosition, 'position');
            if (positionTrack !== undefined) tracks.push(positionTrack);

        }

        if (rawTracks.R !== undefined && Object.keys(rawTracks.R.curves).length > 0) {

            const rotationTrack = this.generateRotationTrack(rawTracks.modelName, rawTracks.R.curves, rawTracks.preRotation, rawTracks.postRotation, rawTracks.eulerOrder, rawTracks.initialRotation);
            if (rotationTrack !== undefined) tracks.push(rotationTrack);

        }

        if (rawTracks.S !== undefined && Object.keys(rawTracks.S.curves).length > 0) {

            const scaleTrack = this.generateVectorTrack(rawTracks.modelName, rawTracks.S.curves, initialScale, 'scale');
            if (scaleTrack !== undefined) tracks.push(scaleTrack);

        }

        if (rawTracks.DeformPercent !== undefined) {

            const morphTrack = this.generateMorphTrack(rawTracks);
            if (morphTrack !== undefined) tracks.push(morphTrack);

        }

        return tracks;

    }

    generateVectorTrack (modelName: string, curves: AnimationCurves, initialValue: number[], type: string): VectorKeyframeTrack {

        const times = this.getTimesForAllAxes(curves);
        const values = this.getKeyframeTrackValues(times, curves, initialValue);

        return new VectorKeyframeTrack(modelName + '.' + type, times, values);

    }

    generateRotationTrack (modelName: string, curves: AnimationCurves, preRotation: number[] | undefined, postRotation: number[] | undefined, eulerOrder: EulerOrder | undefined, initialRotation: number[] | undefined): QuaternionKeyframeTrack | undefined {

        let times: number[] | undefined;
        let values: number[] | undefined;

        if (curves.x !== undefined || curves.y !== undefined || curves.z !== undefined) {

            // Get merged, sorted, unique times from all available curves
            const mergedTimes = this.getTimesForAllAxes(curves);

            if (mergedTimes.length > 0) {

                const initialRot = initialRotation || [0, 0, 0];

                // Synchronize all curves to the merged time array.
                // Missing axes are filled with constant values from the initial rotation (Lcl Rotation).
                // Existing curves at different times are linearly interpolated.
                const syncX = this.synchronizeCurve(curves.x, mergedTimes, initialRot[0]);
                const syncY = this.synchronizeCurve(curves.y, mergedTimes, initialRot[1]);
                const syncZ = this.synchronizeCurve(curves.z, mergedTimes, initialRot[2]);

                const result = this.interpolateRotations(syncX, syncY, syncZ, eulerOrder);

                times = result[0];
                values = result[1];

            }

        }

        // For Maya models using "Joint Orient", Euler order only applies to rotation, not pre/post-rotations
        const defaultEulerOrder = getEulerOrder(0);

        let preRotationQuaternion: Quaternion | undefined;
        if (preRotation !== undefined) {

            preRotationQuaternion = new Quaternion().setFromEuler(new Euler().fromArray([
                MathUtils.degToRad(preRotation[0]),
                MathUtils.degToRad(preRotation[1]),
                MathUtils.degToRad(preRotation[2]),
                defaultEulerOrder
            ]));

        }

        let postRotationQuaternion: Quaternion | undefined;
        if (postRotation !== undefined) {

            postRotationQuaternion = new Quaternion().setFromEuler(new Euler().fromArray([
                MathUtils.degToRad(postRotation[0]),
                MathUtils.degToRad(postRotation[1]),
                MathUtils.degToRad(postRotation[2]),
                defaultEulerOrder
            ])).invert();

        }

        const quaternion = new Quaternion();
        const euler = new Euler();

        const quaternionValues: number[] = [];

        if (!values || !times) return undefined;

        for (let i = 0; i < values.length; i += 3) {

            euler.set(values[i], values[i + 1], values[i + 2], eulerOrder);
            quaternion.setFromEuler(euler);

            if (preRotationQuaternion !== undefined) quaternion.premultiply(preRotationQuaternion);
            if (postRotationQuaternion !== undefined) quaternion.multiply(postRotationQuaternion);

            // Check unroll
            if (i > 2) {

                const prevQuat = new Quaternion().fromArray(
                    quaternionValues,
                    ((i - 3) / 3) * 4
                );

                if (prevQuat.dot(quaternion) < 0) {

                    quaternion.set(- quaternion.x, - quaternion.y, - quaternion.z, - quaternion.w);

                }

            }

            quaternion.toArray(quaternionValues, (i / 3) * 4);

        }

        return new QuaternionKeyframeTrack(modelName + '.quaternion', times, quaternionValues);

    }

    generateMorphTrack (rawTracks: RawAnimationTracks): NumberKeyframeTrack {

        const curves = rawTracks.DeformPercent!.curves.morph!;
        const values = curves.values.map((val) => val / 100);

        const morphObject = fbxGlobals.sceneGraph.getObjectByName(rawTracks.modelName) as MorphTargetObject | null | undefined;
        const morphNum = morphObject?.morphTargetDictionary![rawTracks.morphName!];

        return new NumberKeyframeTrack(rawTracks.modelName + '.morphTargetInfluences[' + morphNum + ']', curves.times, values);

    }

    // For all animated objects, times are defined separately for each axis
    // Here we'll combine the times into one sorted array without duplicates
    getTimesForAllAxes (curves: AnimationCurves): number[] {

        let times: number[] = [];

        // first join together the times for each axis, if defined
        if (curves.x !== undefined) times = times.concat(curves.x.times);
        if (curves.y !== undefined) times = times.concat(curves.y.times);
        if (curves.z !== undefined) times = times.concat(curves.z.times);

        // then sort them
        times = times.sort(function (a, b) {

            return a - b;

        });

        // and remove duplicates
        if (times.length > 1) {

            let targetIndex = 1;
            let lastValue = times[0];
            for (let i = 1; i < times.length; i++) {

                const currentValue = times[i];
                if (currentValue !== lastValue) {

                    times[targetIndex] = currentValue;
                    lastValue = currentValue;
                    targetIndex++;

                }

            }

            times = times.slice(0, targetIndex);

        }

        return times;

    }

    getKeyframeTrackValues (times: number[], curves: AnimationCurves, initialValue: number[]): number[] {

        const prevValue = initialValue;

        const values: number[] = [];

        let xIndex = - 1;
        let yIndex = - 1;
        let zIndex = - 1;

        times.forEach(function (time) {

            if (curves.x) xIndex = curves.x.times.indexOf(time);
            if (curves.y) yIndex = curves.y.times.indexOf(time);
            if (curves.z) zIndex = curves.z.times.indexOf(time);

            // if there is an x value defined for this frame, use that
            if (xIndex !== - 1) {

                const xValue = curves.x!.values[xIndex];
                values.push(xValue);
                prevValue[0] = xValue;

            } else {

                // otherwise use the x value from the previous frame
                values.push(prevValue[0]);

            }

            if (yIndex !== - 1) {

                const yValue = curves.y!.values[yIndex];
                values.push(yValue);
                prevValue[1] = yValue;

            } else {

                values.push(prevValue[1]);

            }

            if (zIndex !== - 1) {

                const zValue = curves.z!.values[zIndex];
                values.push(zValue);
                prevValue[2] = zValue;

            } else {

                values.push(prevValue[2]);

            }

        });

        return values;

    }

    // Synchronize a curve to a target time array using linear interpolation.
    // If the curve is undefined (axis not animated), returns constant values from initialValue.
    synchronizeCurve (curve: FBXAnimationCurve | undefined, targetTimes: number[], initialValue: number): AnimationCurveData {

        if (curve === undefined) {

            return { times: targetTimes, values: targetTimes.map(() => initialValue) };

        }

        // If the curve already has the same number of keyframes as the target, assume times match
        if (curve.times.length === targetTimes.length) return curve;

        // Linearly interpolate curve values at each target time
        const values: number[] = [];

        for (let i = 0; i < targetTimes.length; i++) {

            values.push(this.sampleCurveValue(curve, targetTimes[i], initialValue));

        }

        return { times: targetTimes, values: values };

    }

    // Sample a single value from a curve at a given time using linear interpolation
    sampleCurveValue (curve: AnimationCurveData, time: number, initialValue: number): number {

        const times = curve.times;
        const values = curve.values;

        // Before first keyframe
        if (time <= times[0]) return values[0];

        // After last keyframe
        if (time >= times[times.length - 1]) return values[values.length - 1];

        // Find surrounding keyframes and linearly interpolate
        for (let i = 0; i < times.length - 1; i++) {

            if (time >= times[i] && time <= times[i + 1]) {

                if (times[i] === time) return values[i];

                const alpha = (time - times[i]) / (times[i + 1] - times[i]);
                return values[i] * (1 - alpha) + values[i + 1] * alpha;

            }

        }

        return initialValue;

    }

    // Rotations are defined as Euler angles which can have values of any size
    // These will be converted to quaternions which don't support values greater than
    // PI, so we'll interpolate large rotations
    interpolateRotations (curvex: AnimationCurveData, curvey: AnimationCurveData, curvez: AnimationCurveData, eulerOrder: EulerOrder | undefined): [number[], number[]] {

        const times: number[] = [];
        const values: number[] = [];

        // Add first frame
        times.push(curvex.times[0]);
        values.push(MathUtils.degToRad(curvex.values[0]));
        values.push(MathUtils.degToRad(curvey.values[0]));
        values.push(MathUtils.degToRad(curvez.values[0]));

        for (let i = 1; i < curvex.values.length; i++) {

            const initialValue = [
                curvex.values[i - 1],
                curvey.values[i - 1],
                curvez.values[i - 1],
            ];

            if (isNaN(initialValue[0]) || isNaN(initialValue[1]) || isNaN(initialValue[2])) {

                continue;

            }

            const initialValueRad = initialValue.map(MathUtils.degToRad);

            const currentValue = [
                curvex.values[i],
                curvey.values[i],
                curvez.values[i],
            ];

            if (isNaN(currentValue[0]) || isNaN(currentValue[1]) || isNaN(currentValue[2])) {

                continue;

            }

            const currentValueRad = currentValue.map(MathUtils.degToRad);

            const valuesSpan = [
                currentValue[0] - initialValue[0],
                currentValue[1] - initialValue[1],
                currentValue[2] - initialValue[2],
            ];

            const absoluteSpan = [
                Math.abs(valuesSpan[0]),
                Math.abs(valuesSpan[1]),
                Math.abs(valuesSpan[2]),
            ];

            if (absoluteSpan[0] >= 180 || absoluteSpan[1] >= 180 || absoluteSpan[2] >= 180) {

                const maxAbsSpan = Math.max(...absoluteSpan);

                const numSubIntervals = maxAbsSpan / 180;

                const E1 = new Euler(initialValueRad[0], initialValueRad[1], initialValueRad[2], eulerOrder);
                const E2 = new Euler(currentValueRad[0], currentValueRad[1], currentValueRad[2], eulerOrder);

                const Q1 = new Quaternion().setFromEuler(E1);
                const Q2 = new Quaternion().setFromEuler(E2);

                // Check unroll
                if (Q1.dot(Q2) < 0) {

                    Q2.set(- Q2.x, - Q2.y, - Q2.z, - Q2.w);

                }

                // Interpolate
                const initialTime = curvex.times[i - 1];
                const timeSpan = curvex.times[i] - initialTime;

                const Q = new Quaternion();
                const E = new Euler();
                for (let t = 0; t < 1; t += 1 / numSubIntervals) {

                    Q.copy(Q1.clone().slerp(Q2.clone(), t));

                    times.push(initialTime + t * timeSpan);
                    E.setFromQuaternion(Q, eulerOrder);

                    values.push(E.x);
                    values.push(E.y);
                    values.push(E.z);

                }

            } else {

                times.push(curvex.times[i]);
                values.push(MathUtils.degToRad(curvex.values[i]));
                values.push(MathUtils.degToRad(curvey.values[i]));
                values.push(MathUtils.degToRad(curvez.values[i]));

            }

        }

        return [times, values];

    }

}

export { AnimationParser }
