'use strict';

const MODEL_ID = 'Xenova/multilingual-e5-small';
const MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const EMBEDDING_DIMENSIONS = 384;

class MlUnavailableError extends Error {
  constructor() {
    super('The local semantic model could not be loaded or run. Check model-cache storage and backend network access, then retry.');
    this.code = 'ML_MODEL_UNAVAILABLE';
  }
}

class MlOutputError extends Error {
  constructor() {
    super('The local semantic model returned an invalid embedding.');
    this.code = 'ML_INVALID_OUTPUT';
  }
}

function createSemanticEngine({ cacheDir, pipelineLoader } = {}) {
  let extractorPromise;
  let loaded = false;

  async function getExtractor() {
    if (!extractorPromise) {
      extractorPromise = (async () => {
        const loadedModule = pipelineLoader
          ? await pipelineLoader()
          : await import('@huggingface/transformers');
        if (loadedModule.env && cacheDir) loadedModule.env.cacheDir = cacheDir;
        const extractor = await loadedModule.pipeline(
          'feature-extraction',
          MODEL_ID,
          { dtype: 'q8', revision: MODEL_REVISION }
        );
        loaded = true;
        return extractor;
      })().catch(() => {
        extractorPromise = null;
        throw new MlUnavailableError();
      });
    }
    return extractorPromise;
  }

  async function embedMany(texts, kind = 'passage') {
    if (!Array.isArray(texts) || !texts.length || texts.length > 32 ||
        !texts.every((text) => typeof text === 'string' && text.trim() && text.length <= 4000)) {
      throw new TypeError('Embedding input must contain 1–32 non-empty text passages of at most 4,000 characters.');
    }
    if (kind !== 'query' && kind !== 'passage') throw new TypeError('Embedding kind must be query or passage.');
    const extractor = await getExtractor();
    let output;
    try {
      output = await extractor(texts.map((text) => `${kind}: ${text}`), { pooling: 'mean', normalize: true });
    } catch {
      throw new MlUnavailableError();
    }
    let vectors;
    try {
      vectors = output.tolist();
    } catch {
      throw new MlOutputError();
    }
    if (!Array.isArray(vectors) || vectors.length !== texts.length ||
        !vectors.every((vector) => Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS &&
          vector.every((value) => Number.isFinite(value)))) {
      throw new MlOutputError();
    }
    return vectors;
  }

  return {
    embed: async (text, kind) => (await embedMany([text], kind))[0],
    embedMany,
    status: () => ({
      status: loaded ? 'loaded' : 'not_loaded',
      task: 'multilingual text embeddings for semantic retrieval and similarity',
      model: MODEL_ID,
      revision: MODEL_REVISION,
      dimensions: EMBEDDING_DIMENSIONS,
      languages: ['Arabic', 'English'],
      legalEvaluation: 'not_evaluated_on_UAE_legal_materials'
    })
  };
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) ||
      left.length !== right.length || !left.length ||
      !left.every(Number.isFinite) || !right.every(Number.isFinite)) {
    throw new TypeError('Cosine similarity requires equal-sized finite vectors.');
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) throw new TypeError('Cosine similarity is undefined for a zero vector.');
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function splitPassages(text, maxCharacters = 1800, overlap = 200) {
  const passages = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxCharacters, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(' ', end);
      if (boundary > start + maxCharacters * 0.7) end = boundary;
    }
    const passage = text.slice(start, end).trim();
    if (passage) passages.push({ text: passage, startOffset: start, endOffset: end });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return passages;
}

module.exports = {
  MODEL_ID,
  MODEL_REVISION,
  MlOutputError,
  MlUnavailableError,
  cosineSimilarity,
  createSemanticEngine,
  splitPassages
};
