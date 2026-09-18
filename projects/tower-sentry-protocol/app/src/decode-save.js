const { ungzip } = require('pako/lib/inflate.js');
const { NRBFReader } = require('thetowersdk/internal/node/nrbf/nrbf-reader');
const { nrbfToJSON } = require('thetowersdk/internal/node/nrbf/nrbf-to-json');

/**
 * Browser-safe reimplementation of thetowersdk's decodePlayerInfoSaveBytes.
 * The original (thetowersdk/node) shells out to Node's zlib/Buffer; NRBFReader
 * and nrbfToJSON underneath don't touch Node built-ins, so only the gzip step
 * needs a browser substitute (pako).
 */
function decodePlayerInfoSaveBytes(bytes) {
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const inflated = isGzip ? ungzip(bytes) : bytes;
    const decoded = NRBFReader.readStream(inflated);
    const parsed = nrbfToJSON(decoded);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Failed to decode playerInfo.dat: NRBF root was not an object');
    }
    return { parsedRoot: parsed, wasGzip: isGzip };
}

module.exports = { decodePlayerInfoSaveBytes };
