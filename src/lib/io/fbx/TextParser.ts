import { FBXTree } from './FBXTree'
import { append, parseNumberArray } from './fbx-utils'
import { type FBXNode } from './BinaryParser'
import type { FBXNodeObject, FBXNodeValue } from './FBXNodes'
import { readFBXNodeArray, readFBXNodeObject } from './FBXNodeValidation'

function as_object (value: FBXNodeValue): FBXNodeObject {
    return readFBXNodeObject(value, 'ASCII parser node');
}

function as_array (value: FBXNodeValue): FBXNodeValue[] {
    return readFBXNodeArray(value, 'ASCII parser list');
}

/**
 * Parses an FBX file stored in ASCII (text) format.
 * Processes the file line-by-line using indentation to reconstruct the node
 * hierarchy, returning an `FBXTree` that mirrors the document structure.
 */
class TextParser {
    nodeStack!: FBXNode[];
    currentIndent: number = 0;
    currentProp!: FBXNode | unknown[];
    currentPropName: string | undefined
    allNodes: FBXTree = new FBXTree();
    /** 1-based line number currently being processed, used only for error messages. */
    currentLineNumber: number = 0;

    getPrevNode (): FBXNode {

        return this.nodeStack[this.currentIndent - 2];

    }

    getCurrentNode (): FBXNode {

        return this.nodeStack[this.currentIndent - 1];

    }

    getCurrentProp (): FBXNode | unknown[] {

        return this.currentProp;

    }

    pushStack (node: FBXNode): void {

        this.nodeStack.push(node);
        this.currentIndent += 1;

    }

    popStack (): void {

        this.nodeStack.pop();
        this.currentIndent -= 1;

    }

    setCurrentProp (val: FBXNode | unknown[], name: string | undefined): void {

        this.currentProp = val;
        this.currentPropName = name;

    }

    parse (text: string): FBXTree {

        this.currentIndent = 0;

        this.allNodes = new FBXTree();
        this.nodeStack = [];
        this.currentProp = [];
        this.currentPropName = '';

        const split = text.split(/[\r\n]+/);

        split.forEach((line, i) => {

            this.currentLineNumber = i + 1;

            const matchComment = line.match(/^[\s\t]*;/);
            const matchEmpty = line.match(/^[\s\t]*$/);

            if (matchComment || matchEmpty) return;

            // The `{` and `}` patterns are anchored to end-of-line. Without the anchor a
            // property whose *value* contains a brace -- a Windows path with a {token}, a
            // GUID, a material name -- was read as a block delimiter, pushing or popping the
            // node stack and permanently desynchronising the indent from the file.
            const matchBeginning = line.match('^\\t{' + this.currentIndent + '}(\\w+):(.*)\\{\\s*$');
            const matchProperty = line.match('^\\t{' + (this.currentIndent) + '}(\\w+):[\\s\\t\\r\\n](.*)');
            // At indent 0 there is nothing to close, and '\t{-1}' is not a valid quantifier.
            const matchEnd = this.currentIndent > 0
                ? line.match('^\\t{' + (this.currentIndent - 1) + '}\\}\\s*$')
                : null;

            if (matchBeginning) {

                this.parseNodeBegin(line, matchBeginning);

            } else if (matchProperty) {

                // The next physical line is the property's value; forEach owns
                // the index, so reading i+1 is equivalent to mutating i here.
                this.parseNodeProperty(line, matchProperty, split[i + 1]);

            } else if (matchEnd) {

                this.popStack();

            } else if (line.match(/^[^\s\t}]/)) {

                // large arrays are split over multiple lines terminated with a ',' character
                // if this is encountered the line needs to be joined to the previous line
                this.parseNodePropertyContinued(line);

            }

        });

        return this.allNodes;

    }

    parseNodeBegin (_line: string, property: string[]): void {

        const nodeName = property[1].trim().replace(/^"/, '').replace(/"$/, '');

        const nodeAttrs = property[2].split(',').map(function (attr) {

            return attr.trim().replace(/^"/, '').replace(/"$/, '');

        });

        const node: FBXNode = { name: nodeName, propertyList: [] };
        const attrs = this.parseNodeAttr(nodeAttrs);

        const currentNode = this.getCurrentNode();

        // a top node
        if (this.currentIndent === 0) {

            this.allNodes.add(nodeName, node);

        } else { // a subnode

            // if the subnode already exists, append it
            if (nodeName in currentNode) {

                // special case Pose needs PoseNodes as an array
                if (nodeName === 'PoseNode') {

                    as_array(currentNode.PoseNode).push(node);

                } else if (as_object(currentNode[nodeName]).id !== undefined) {

                    currentNode[nodeName] = {};
                    const existing = as_object(currentNode[nodeName]);
                    existing[String(existing.id)] = existing;

                }

                if (attrs.id !== '') as_object(currentNode[nodeName])[String(attrs.id)] = node;

            } else if (typeof attrs.id === 'number') {

                currentNode[nodeName] = {};
                as_object(currentNode[nodeName])[String(attrs.id)] = node;

            } else if (nodeName !== 'Properties70') {

                if (nodeName === 'PoseNode') currentNode[nodeName] = [node];
                else currentNode[nodeName] = node;

            }

        }

        if (typeof attrs.id === 'number') node.id = attrs.id;
        if (attrs.name !== '') node.attrName = attrs.name;
        if (attrs.type !== '') node.attrType = attrs.type;

        this.pushStack(node);

    }

    parseNodeAttr (attrs: string[]): { id: number | string; name: string; type: string } {

        let id: number | string = attrs[0];

        if (attrs[0] !== '') {

            id = parseInt(attrs[0]);

            if (isNaN(id)) {

                id = attrs[0];

            }

        }

        let name = '', type = '';

        if (attrs.length > 1) {

            name = attrs[1].replace(/^(\w+)::/, '');
            type = attrs[2];

        }

        return { id: id, name: name, type: type };

    }

    parseNodeProperty (line: string, property: string[], contentLine: string): void {

        let propName: string = property[1].replace(/^"/, '').replace(/"$/, '').trim();
        let propValue: string | Array<number | string> = property[2].replace(/^"/, '').replace(/"$/, '').trim();

        // for special case: base64 image data follows "Content: ," line
        //	Content: ,
        //	 "/9j/4RDaRXhpZgAATU0A..."
        if (propName === 'Content' && propValue === ',') {

            propValue = contentLine.replace(/"/g, '').replace(/,$/, '').trim();

        }

        const currentNode = this.getCurrentNode();

        if (currentNode === undefined) {

            // Document-level properties such as `CreationTime:` and `Creator:` sit outside
            // any block, so there is no node on the stack to attach them to -- they belong on
            // the tree root. Upstream three.js read `currentNode.name` unconditionally and
            // failed here with "Cannot read properties of undefined (reading 'name')".
            if (this.currentIndent === 0) {

                this.allNodes.add(propName, propValue);
                return;

            }

            throw new Error(
                'THREE.FBXLoader: Malformed ASCII FBX. Expected an open node at indent ' +
                this.currentIndent + ' but the node stack holds ' + this.nodeStack.length +
                ' entries, on line ' + this.currentLineNumber + ': ' + JSON.stringify(line.slice(0, 120))
            );

        }

        const parentName = currentNode.name;

        if (parentName === 'Properties70') {

            this.parseNodeSpecialProperty(line, propName, typeof propValue === 'string' ? propValue : String(propValue));
            return;

        }

        // Connections
        if (propName === 'C') {

            // At this point a connection property is always still the raw text
            // value; the array form is constructed just below.
            const connectionText = typeof propValue === 'string' ? propValue : '';
            const connProps = connectionText.split(',').slice(1);
            const from = parseInt(connProps[0]);
            const to = parseInt(connProps[1]);

            let rest = connectionText.split(',').slice(3);

            rest = rest.map(function (elem: string) {

                return elem.trim().replace(/^"/, '');

            });

            propName = 'connections';
            const connectionValues: Array<number | string> = [from, to];
            append(connectionValues, rest);
            propValue = connectionValues;

            if (currentNode[propName] === undefined) {

                currentNode[propName] = [];

            }

        }

        // Node
        if (propName === 'Node' && (typeof propValue === 'string' || typeof propValue === 'number')) {
            currentNode.id = propValue;
        }

        // connections
        if (propName in currentNode && Array.isArray(currentNode[propName])) {

            as_array(currentNode[propName]).push(propValue);

        } else {

            if (propName !== 'a') currentNode[propName] = propValue;
            else currentNode.a = propValue;

        }

        this.setCurrentProp(currentNode, propName);

        // convert string to array, unless it ends in ',' in which case more will be added to it
        if (propName === 'a' && typeof propValue === 'string' && propValue.slice(- 1) !== ',') {

            currentNode.a = parseNumberArray(propValue);

        }

    }

    parseNodePropertyContinued (line: string): void {

        const currentNode = this.getCurrentNode();

        // Only array properties (`a:`) are continued across lines. Anything else reaching here
        // is a line the dispatcher could not classify, so there is nothing to append it to.
        if (currentNode === undefined || currentNode.a === undefined) {

            console.warn('THREE.FBXLoader: Skipping unrecognised line ' + this.currentLineNumber + ': ' + JSON.stringify(line.slice(0, 120)));
            return;

        }

        currentNode.a += line;

        // if the line doesn't end in ',' we have reached the end of the property value
        // so convert the string to an array
        if (line.slice(- 1) !== ',') {

            if (typeof currentNode.a !== 'string') throw new Error(`Invalid ASCII number array at line ${this.currentLineNumber}`);
            currentNode.a = parseNumberArray(currentNode.a);

        }

    }

    // parse "Property70"
    parseNodeSpecialProperty (line: string, propName: string, propValue: string): void {

        // split this
        // P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
        // into array like below
        // ["Lcl Scaling", "Lcl Scaling", "", "A", "1,1,1" ]
        const props = propValue.split('",').map(function (prop: string) {

            return prop.trim().replace(/^"/, '').replace(/\s/, '_');

        });

        const innerPropName = props[0];
        const innerPropType1 = props[1];
        const innerPropType2 = props[2];
        const innerPropFlag = props[3];
        let innerPropValue: string | number | number[] = props[4];

        // cast values where needed, otherwise leave as strings
        switch (innerPropType1) {

            case 'int':
            case 'enum':
            case 'bool':
            case 'ULongLong':
            case 'double':
            case 'Number':
            case 'FieldOfView':
                innerPropValue = parseFloat(innerPropValue);
                break;

            case 'Color':
            case 'ColorRGB':
            case 'Vector3D':
            case 'Lcl_Translation':
            case 'Lcl_Rotation':
            case 'Lcl_Scaling':
                innerPropValue = parseNumberArray(innerPropValue);
                break;

        }

        // CAUTION: these props must append to parent's parent
        this.getPrevNode()[innerPropName] = {

            'type': innerPropType1,
            'type2': innerPropType2,
            'flag': innerPropFlag,
            'value': innerPropValue

        };

        this.setCurrentProp(this.getPrevNode(), innerPropName);

    }

}

export { TextParser }
