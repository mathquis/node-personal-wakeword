const DTW	= require('./dtw/dtw')
const Utils	= require('./utils')

class FeatureComparator {
	constructor(options) {
		this.options = options || {}
		this._dtw = new DTW({distanceFunction: FeatureComparator.calculateDistance})
		console.log(this._dtw)
	}

	static calculateDistance(ax, bx) {
		return 1 - Utils.cosineSimilarity(ax, bx)
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