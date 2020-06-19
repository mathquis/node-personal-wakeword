const DTW			= require('./dtw/dtw')
const Comparator	= require('./comparator')

class WakewordKeyword {
	constructor(keyword, options) {
		this.keyword			= keyword
		this.averageFeatures	= []
		this._templates			= []
		this.options			= options || {}
		this.enabled			= true
	}

	get disableAveraging() {
		return this.options.disableAveraging || false
	}

	get threshold() {
		return this.options.threshold || 0
	}

	get templates() {
		return this.disableAveraging ? this._templates : [this.averageFeatures]
	}

	addFeatures(features) {
		this._templates = [...this._templates, features]
		if ( !this.disableAveraging ) this._averageFeatures()
	}

	_averageFeatures() {
		// According to Guoguo Chen (Kitt.ai) in this paper
		// http://citeseerx.ist.psu.edu/viewdoc/download?doi=10.1.1.684.8586&rep=rep1&type=pdf
		// Averaging the templates using DTW does not seem to impact accuracy
		// And greatly reduce resource consumption
		// We choose the longest template as the origin
		this._templates.sort((a, b) => b.length - a.length)

		const origin = this._templates[0]

		const dtw = new DTW({distanceFunction: Comparator.calculateDistance})

		const avgs = origin.map(features => {
			return features.map(feature => {
				return [feature]
			})
		})

		for ( let i = 1 ; i < this._templates.length ; i++ ) {
			const frames = this._templates[i]
			const score = dtw.compute(origin, frames)
			dtw
				.path()
				.forEach(([x, y]) => {
					frames[y].forEach((feature, index) => {
						avgs[x][index].push(feature)
					})
				})
		}

		this.averageFeatures = avgs.map(frame => {
			return frame.map(featureGroup => {
				return featureGroup.reduce((result, value) => result + value, 0) / featureGroup.length
			})
		})
	}
}

module.exports = WakewordKeyword