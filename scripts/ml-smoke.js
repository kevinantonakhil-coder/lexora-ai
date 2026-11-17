'use strict';

const path = require('node:path');
const { cosineSimilarity, createSemanticEngine } = require('../src/ml/semantic');

async function main() {
  const engine = createSemanticEngine({
    cacheDir: process.env.LEXORA_ML_CACHE_DIR || path.resolve(process.cwd(), 'data', 'model-cache')
  });
  const query = 'A customer must pay an invoice within thirty days.';
  const candidates = [
    'Payment of the invoice is due within 30 days.',
    'The building must provide marked fire exits.'
  ];
  const queryVector = await engine.embed(query, 'query');
  const candidateVectors = await engine.embedMany(candidates, 'passage');
  const relevantSimilarity = cosineSimilarity(queryVector, candidateVectors[0]);
  const unrelatedSimilarity = cosineSimilarity(queryVector, candidateVectors[1]);
  if (queryVector.length !== 384 || candidateVectors.some((vector) => vector.length !== 384) ||
      relevantSimilarity <= unrelatedSimilarity) {
    throw new Error('The model smoke check failed its basic semantic-ranking assertion.');
  }
  console.log(JSON.stringify({
    model: engine.status(),
    dimensions: queryVector.length,
    relevantSimilarity,
    unrelatedSimilarity,
    note: 'Synthetic English smoke check only; not a UAE legal accuracy evaluation.'
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
