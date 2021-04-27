const euclideanDistance = function (x, y) {
  const difference = x - y
  const euclideanDistance = Math.sqrt(difference * difference)
  return euclideanDistance
}

module.exports = euclideanDistance