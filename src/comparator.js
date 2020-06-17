const DTW				= require('dtw')
const cosineSimilarity	= require('cos-similarity')

class FeatureComparator {
	constructor(options) {
		this.options = options || {}
		this._dtw = new DTW({distanceFunction: FeatureComparator.calculateDistance})
	}

	static calculateDistance(ax, bx) {
		return 1 - cosineSimilarity(ax, bx)
	}

	get bandSize() {
		return this.options.bandSize || 5
	}

	get ref() {
		return this.options.ref || 0.22
	}

	compare(a, b) {
		const cost = this._dtw.compute(a, b, this.bandSize)
		const normalizedCost = cost / ( a.length + b.length )
		return this.computeProbability(normalizedCost)
	}

	computeProbability(cost) {
		return 1 / ( 1 + Math.exp( ( cost - this.ref ) / this.ref ) )
	}
}

module.exports = FeatureComparator