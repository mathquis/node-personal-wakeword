const Matrix            = require('./matrix')
const EuclidianDistance = require('./distance')

class DTW {
  constructor(options) {
    options || (options = {})
    this._state            = {distanceCostMatrix: null}
    this._distanceFunction = options.distanceFunction || EuclidianDistance
  }

  compute(firstSequence, secondSequence, window) {
    let cost = Number.POSITIVE_INFINITY;
    if (typeof window === 'undefined') {
      cost = this._computeOptimalPath(firstSequence, secondSequence);
    } else if (typeof window === 'number') {
      cost = this._computeOptimalPathWithWindow(firstSequence, secondSequence, window);
    } else {
      throw new TypeError('Invalid window parameter type: expected a number');
    }

    return cost;
  }

  _computeOptimalPath(s, t) {
    this._state.m = s.length;
    this._state.n = t.length;
    let distanceCostMatrix = Matrix.create(this._state.m, this._state.n, Number.POSITIVE_INFINITY);

    distanceCostMatrix[0][0] = this._distanceFunction(s[0], t[0]);

    for (let rowIndex = 1; rowIndex < this._state.m; rowIndex++) {
      var cost = this._distanceFunction(s[rowIndex], t[0]);
      distanceCostMatrix[rowIndex][0] = cost + distanceCostMatrix[rowIndex - 1][0];
    }

    for (let columnIndex = 1; columnIndex < this._state.n; columnIndex++) {
      const cost = this._distanceFunction(s[0], t[columnIndex]);
      distanceCostMatrix[0][columnIndex] = cost + distanceCostMatrix[0][columnIndex - 1];
    }

    for (let rowIndex = 1; rowIndex < this._state.m; rowIndex++) {
      for (let columnIndex = 1; columnIndex < this._state.n; columnIndex++) {
        const cost = this._distanceFunction(s[rowIndex], t[columnIndex]);
        distanceCostMatrix[rowIndex][columnIndex] =
          cost + Math.min(
            distanceCostMatrix[rowIndex - 1][columnIndex],          // Insertion
            distanceCostMatrix[rowIndex][columnIndex - 1],          // Deletion
            distanceCostMatrix[rowIndex - 1][columnIndex - 1]);     // Match
      }
    }

    this._state.distanceCostMatrix = distanceCostMatrix;
    this._state.similarity = distanceCostMatrix[this._state.m - 1][this._state.n - 1];
    return this._state.similarity;
  }

  _computeOptimalPathWithWindow(s, t, w) {
    this._state.m = s.length
    this._state.n = t.length
    const window = Math.max(w, Math.abs(s.length - t.length))
    let distanceCostMatrix = Matrix.create(this._state.m + 1, this._state.n + 1, Number.POSITIVE_INFINITY)
    distanceCostMatrix[0][0] = 0

    for (let rowIndex = 1; rowIndex <= this._state.m; rowIndex++) {
      for (let columnIndex = Math.max(1, rowIndex - window); columnIndex <= Math.min(this._state.n, rowIndex + window); columnIndex++) {
        const cost = this._distanceFunction(s[rowIndex - 1], t[columnIndex - 1])
        distanceCostMatrix[rowIndex][columnIndex] =
          cost + Math.min(
          distanceCostMatrix[rowIndex - 1][columnIndex],          // Insertion
          distanceCostMatrix[rowIndex][columnIndex - 1],          // Deletion
          distanceCostMatrix[rowIndex - 1][columnIndex - 1])      // Match
      }
    }

    distanceCostMatrix.shift()
    distanceCostMatrix = distanceCostMatrix.map(function (row) {
      return row.slice(1, row.length)
    })
    this._state.distanceCostMatrix = distanceCostMatrix
    this._state.similarity = distanceCostMatrix[this._state.m - 1][this._state.n - 1]
    return this._state.similarity
  }

  path() {
    var path = null;
    if (this._state.distanceCostMatrix instanceof Array) {
      path = this._retrieveOptimalPath();
    }

    return path;
  }

  _retrieveOptimalPath() {
    let rowIndex = this._state.m - 1
    let columnIndex = this._state.n - 1
    const path = [[rowIndex, columnIndex]]
    const epsilon = 1e-14
    while ((rowIndex > 0) || (columnIndex > 0)) {
      if ((rowIndex > 0) && (columnIndex > 0)) {
        const min = Math.min(
          this._state.distanceCostMatrix[rowIndex - 1][columnIndex],          // Insertion
          this._state.distanceCostMatrix[rowIndex][columnIndex - 1],          // Deletion
          this._state.distanceCostMatrix[rowIndex - 1][columnIndex - 1])      // Match
        if (min === this._state.distanceCostMatrix[rowIndex - 1][columnIndex - 1]) {
          rowIndex--
          columnIndex--
        } else if (min === this._state.distanceCostMatrix[rowIndex - 1][columnIndex]) {
          rowIndex--
        } else if (min === this._state.distanceCostMatrix[rowIndex][columnIndex - 1]) {
          columnIndex--
        }
      } else if ((rowIndex > 0) && (columnIndex === 0)) {
        rowIndex--
      } else if ((rowIndex === 0) && (columnIndex > 0)) {
        columnIndex--
      }

      path.push([rowIndex, columnIndex])
    }

    return path.reverse()
  }
}

module.exports = DTW