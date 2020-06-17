function convertInt16ToFloat32(n) {
   var v = n < 0 ? n / 32768 : n / 32767;       // convert in range [-32768, 32767]
   return Math.max(-1, Math.min(1, v)); // clamp
}

module.exports = {
	convertInt16ToFloat32
}