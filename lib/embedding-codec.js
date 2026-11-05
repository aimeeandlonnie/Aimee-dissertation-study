// Compact storage for the embeddings in Firebase `semantic_cache`.
//
// An embedding is 1,536 numbers. Stored as JSON decimals each takes ~20
// characters (~30 KB per entry); packed as 32-bit floats and base64-encoded
// it takes ~8 KB. OpenAI's embeddings are 32-bit precision to begin with,
// so cosine similarities change by about 1e-7, which does not affect any
// threshold or ranking the chatbot uses.
//
// Written by api/firebase.js (appendSemanticCache) as `embeddingB64`; read
// by api/router.js, which also still accepts the older `embedding` arrays.

export function encodeEmbedding(embedding) {
  const floats = Float32Array.from(embedding);
  return Buffer.from(floats.buffer).toString('base64');
}

export function decodeEmbedding(entry) {
  if (typeof entry.embeddingB64 === 'string' && entry.embeddingB64) {
    const bytes = Buffer.from(entry.embeddingB64, 'base64');
    if (bytes.length === 0 || bytes.length % 4 !== 0) return null;
    // Copy into an aligned buffer: Buffer slices may not start on a 4-byte
    // boundary, which Float32Array requires.
    const aligned = new Uint8Array(bytes).buffer;
    return new Float32Array(aligned);
  }
  return null;
}
