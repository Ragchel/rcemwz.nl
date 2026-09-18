var exports = window.exports || (window.exports = {});
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nrbfToJSON = nrbfToJSON;
function nrbfToJSON(obj) {
    const visited = new Set();
    function convert(value) {
        if (value === null || value === undefined)
            return null;
        if (visited.has(value))
            return '[Circular]';
        if (typeof value === 'object'
            && value !== null
            && 'typeName' in value
            && 'entries' in value
            && typeof value.entries === 'object') {
            visited.add(value);
            const result = { typeName: value.typeName };
            for (const [key, entryValue] of value.entries) {
                result[key] = convert(entryValue);
            }
            visited.delete(value);
            return result;
        }
        if (value instanceof Date)
            return value.toISOString();
        if (Array.isArray(value))
            return value.map(convert);
        if (typeof value === 'bigint')
            return { __type: 'BigInt', __value: value.toString() };
        return value;
    }
    return convert(obj);
}
window.nrbfToJSON = exports.nrbfToJSON;
