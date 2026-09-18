// Browser stub for thetowersdk/node's `require("node:zlib")`. We never call
// thetowersdk's own decodePlayerInfoSaveBytes (see decode-save.js), so this
// only needs to exist to satisfy the require — it's never actually invoked.
function gunzipSync() {
    throw new Error('node:zlib is not available in the browser build');
}

module.exports = { gunzipSync };
