const pako = require('pako');
const { NRBFReader, nrbfToJSON } = require('thetowersdk/node');

/**
 * Browser-safe reimplementation of thetowersdk's decodePlayerInfoSaveBytes.
 * The original (thetowersdk/node) shells out to Node's zlib/Buffer; NRBFReader
 * and nrbfToJSON underneath don't touch Node built-ins, so only the gzip step
 * needs a browser substitute (pako).
 */
function decodePlayerInfoSaveBytes(bytes) {
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const inflated = isGzip ? pako.ungzip(bytes) : bytes;
    const decoded = NRBFReader.readStream(inflated);
    const parsed = nrbfToJSON(decoded);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Failed to decode playerInfo.dat: NRBF root was not an object');
    }
    return { parsedRoot: parsed, wasGzip: isGzip };
}

module.exports = { decodePlayerInfoSaveBytes };
