function convertInt16ToFloat32(n) {
   var v = n < 0 ? n / 32768 : n / 32767;       // convert in range [-32768, 32767]
   return Math.max(-1, Math.min(1, v)); // clamp
}

function cosineSimilarity(vectorA = [], vectorB = []) {
  const dimensionality = Math.min(vectorA.length, vectorB.length);
  let dotAB = 0;
  let dotA = 0;
  let dotB = 0;
  let dimension = 0;
  while (dimension < dimensionality) {
    const componentA = vectorA[dimension];
    const componentB = vectorB[dimension];
    dotAB += componentA * componentB;
    dotA += componentA * componentA;
    dotB += componentB * componentB;
    dimension += 1;
  }

  const magnitude = Math.sqrt(dotA * dotB);
  return magnitude === 0 ? 0 : dotAB / magnitude;
}

module.exports = {
	convertInt16ToFloat32,
	cosineSimilarity
}