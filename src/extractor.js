const Stream			= require('stream')
const Block				= require('block-stream2')
const debug 			= require('debug')('extractor')
const Gist				= require('@mathquis/node-gist')
const Utils 			= require('./utils')

class FeatureExtractor extends Stream.Transform {
	constructor(options) {
		super({
			readableObjectMode: true
		})
		this.options	= options || {}
		this.samples	= []
		this._extractor	= new Gist(this.samplesPerFrame, this.sampleRate)
		this._block		= new Block( this.samplesPerShift * this.sampleRate / 8000 )

		this._block
			.on('data', audioBuffer => {
					debug('Extracting from frame (length: %d)', audioBuffer.length)
					const newSamples = this.preEmphasis( audioBuffer )
					if ( this.samples.length >= this.samplesPerFrame ) {
						this.samples = [...this.samples.slice(newSamples.length), ...newSamples]
						try {
							const features = this.extractFeatures( this.samples.slice(0, this.samplesPerFrame) )
							debug('Features: %O', features)
							this.push({features, audioBuffer})
						} catch (err) {
							this.error(err)
						}
					} else {
						this.samples = [...this.samples, ...newSamples]
					}
			})
			.on('error', err => this.error(err))
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
		this._block.write(audioData, enc, done)
	}

	error(err) {
		this.emit('error', err)
	}

	destroy(err) {
		this._block.removeAllListeners()
		this._block.destroy()
		this._block = null

		this._extractor = null

		super.destroy(err)
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