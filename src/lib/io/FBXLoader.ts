import { FileLoader, Loader, LoaderUtils, TextureLoader, type Group, type LoadingManager } from 'three'
import { fbxGlobals } from './fbx/fbx-globals'
import { BinaryParser } from './fbx/BinaryParser'
import { TextParser } from './fbx/TextParser'
import { FBXTreeParser } from './fbx/FBXTreeParser'
import { isFbxFormatBinary, isFbxFormatASCII, describeFileHead, getFbxVersion, convertArrayBufferToString } from './fbx/fbx-utils'

/**
 * A loader for the FBX format.
 *
 * Requires FBX file to be >= 7.0 and in ASCII or >= 6400 in Binary format.
 * Versions lower than this may load but will probably have errors.
 *
 * Needs Support:
 * - Morph normals / blend shape normals
 *
 * FBX format references:
 * - [C++ SDK reference](https://help.autodesk.com/view/FBX/2017/ENU/?guid=__cpp_ref_index_html)
 *
 * Binary format specification:
 * - [FBX binary file format specification](https://code.blender.org/2013/08/fbx-binary-file-format-specification/)
 *
 * ```js
 * const loader = new FBXLoader();
 * const object = await loader.loadAsync( 'models/fbx/stanford-bunny.fbx' );
 * scene.add( object );
 * ```
 *
 * @augments Loader
 * @three_import import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
 */
class FBXLoader extends Loader<Group> {

    /**
     * Constructs a new FBX loader.
     *
     * @param {LoadingManager} [manager] - The loading manager.
     */
    constructor(manager?: LoadingManager) {

        super(manager);

    }

    /**
     * Starts loading from the given URL and passes the loaded FBX asset
     * to the `onLoad()` callback.
     *
     * @param {string} url - The path/URL of the file to be loaded. This can also be a data URI.
     * @param {function(Group)} onLoad - Executed when the loading process has been finished.
     * @param {onProgressCallback} onProgress - Executed while the loading is in progress.
     * @param {onErrorCallback} onError - Executed when errors occur.
     */
    load(
        url: string,
        onLoad: (object: Group) => void,
        onProgress?: (event: ProgressEvent) => void,
        onError?: (error: unknown) => void
    ): void {

        const path = (this.path === '') ? LoaderUtils.extractUrlBase(url) : this.path;

        const loader = new FileLoader<ArrayBuffer>(this.manager);
        loader.setPath(this.path);
        loader.setResponseType('arraybuffer');
        loader.setRequestHeader(this.requestHeader);
        loader.setWithCredentials(this.withCredentials);

        loader.load(url, (buffer) => {


            try {

                onLoad(this.parse(buffer, path));

            } catch (e) {

                if (onError !== undefined) {

                    onError(e);

                } else {

                    console.error(e);

                }

                this.manager.itemError(url);

            }

        }, onProgress, onError);

    }

    /**
     * Parses the given FBX data and returns the resulting group.
     *
     * @param {ArrayBuffer} FBXBuffer - The raw FBX data as an array buffer.
     * @param {string} path - The URL base path.
     * @return {Group} An object representing the parsed asset.
     */
    parse (FBXBuffer: ArrayBuffer, path: string): Group {

        if (isFbxFormatBinary(FBXBuffer)) {

            fbxGlobals.fbxTree = new BinaryParser().parse(FBXBuffer);

        } else {

            const FBXText = convertArrayBufferToString(FBXBuffer);

            if (!isFbxFormatASCII(FBXText)) {

                throw new Error(
                    'THREE.FBXLoader: Unknown format. The file is not a binary FBX (no "Kaydara FBX Binary" ' +
                    'magic prefix) and no FBXHeaderExtension/FBXVersion node was found in the text, so it is ' +
                    'not an ASCII FBX either. File starts with: ' + describeFileHead(FBXText)
                );

            }

            if (getFbxVersion(FBXText) < 7000) {

                throw new Error('THREE.FBXLoader: FBX version not supported, FileVersion: ' + getFbxVersion(FBXText));

            }

            fbxGlobals.fbxTree = new TextParser().parse(FBXText);

        }

        // console.log( fbxGlobals.fbxTree );

        const textureLoader = new TextureLoader(this.manager).setPath(this.resourcePath || path).setCrossOrigin(this.crossOrigin);

        return new FBXTreeParser(textureLoader, this.manager).parse();

    }

}

export { FBXLoader }
