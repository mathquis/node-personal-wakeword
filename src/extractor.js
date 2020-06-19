const Stream			= require('stream')
const Block				= require('block-stream2')
const Gist				= require('@mathquis/node-gist')
const Utils 			= require('./utils')

class FeatureExtractor extends Stream.Transform {
	constructor(options) {
		super()
		this.options	= options || {}
		this.samples	= []
		this._extractor	= new Gist(this.samplesPerFrame, this.sampleRate)
		this._block		= new Block( this.samplesPerShift * this.sampleRate / 8000 )

		this._block.on('data', audioBuffer => {
				const newSamples = this.preEmphasis( audioBuffer )
				if ( this.samples.length >= this.samplesPerFrame ) {
					this.samples = [...this.samples.slice(newSamples.length), ...newSamples]
					const features = this.extractFeatures( this.samples.slice(0, this.samplesPerFrame) )
					this.emit('features', features, audioBuffer)
				} else {
					this.samples = [...this.samples, ...newSamples]
				}
		})

		this.pipe(this._block)
	}

	get sampleRate() {
		return this.options.sampleRate || 16000
	}

	get samplesPerFrame() {
		return this.options.samplesPerFrame || 480
	}

	get samplesPerShift() {
		return this.options.samplesPerShift || 160
	}

	get preEmphasisCoefficient() {
		return this.options.preEmphasisCoefficient || 0.97
	}

	_write(audioData, enc, done) {
		this.push(audioData)
		done()
	}

	preEmphasis(audioBuffer) {
		const coef = this.preEmphasisCoefficient
		const samples = Array
			.from(
				new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength / Int16Array.BYTES_PER_ELEMENT)
			)
			.map((v, i, list) => {
				return Utils.convertInt16ToFloat32(
					v - coef * ( list[i - 1] || 0 )
				)
			})
		return samples
	}

	extractFeatures(audioFrame) {
		this._extractor.processAudioFrame(Float32Array.from(audioFrame))
		return this._extractor.getMelFrequencyCepstralCoefficients().slice(1)
	}
}

module.exports = FeatureExtractor