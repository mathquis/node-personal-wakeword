const Stream			= require('stream')
const File				= require('fs')
const Path				= require('path')
const Block				= require('block-stream2')
const VAD 				= require('node-vad')
const DTW				= require('dtw')
const cosineSimilarity	= require('cos-similarity')
const Gist				= require('../node-gist/lib/index')

const NONE		= false
const DETECTED	= true

function convertInt16ToFloat32(n) {
   var v = n < 0 ? n / 32768 : n / 32767;       // convert in range [-32768, 32767]
   return Math.max(-1, Math.min(1, v)); // clamp
}

class WakewordEngine extends Stream.Transform {
	constructor(options) {
		super()
		this.options = options || {}
		this.wakewords = []
		this._features = []
		this._buffering = true
		this._detected = false

		this._extractor = new FeatureExtractor({
			samplesPerFrame: this.samplesPerFrame,
			sampleRate: this.sampleRate
		})

		this._extractor.on('features', features => {
			this.processFeatures(features)
		})

		this._vad = VAD.createStream({
		    mode: VAD.Mode.AGGRESSIVE,
		    audioFrequency: this.sampleRate,
		    debounceTime: 1000
		})

		this.pipe(this._vad)

		this._vad.on('data', data => {
			if ( this._buffering || data.speech.state == true ) {
				this._extractor.write(data.audioData)
			}
		})

		this._comparator = new FeatureComparator(options)
	}

	get buffering() {
		return this._buffering
	}

	get sampleRate() {
		return this.options.sampleRate || 16000
	}

	get samplesPerFrame() {
		return this.sampleRate * this.frameLengthMS / 1000
	}

	get samplesPerShift() {
		return this.sampleRate * this.frameShiftMS / 1000
	}

	get frameLengthMS() {
		return this.options.frameLengthMS || 25.0
	}

	get frameShiftMS() {
		return this.options.frameShiftMS || 10.0
	}

	get threshold() {
		return this.options.threshold || 0.5
	}

	_transform(buffer, enc, done) {
		this.push(buffer)
		done()
	}

	async loadTemplate(wakeword, templates) {
		const features = await Promise.all(
			templates.map(template => {
				return this.extractFeaturesFromFile(template)
			})
		)
		this.wakewords.push({
			name: wakeword,
			templates: features
		})

		this._minFrames = this.wakewords.reduce((min, templates) => {
			return templates.templates.reduce((min2, template) => {
				return Math.min(min2, template.length)
			}, min)
		}, 9999)
		this._maxFrames = this.wakewords.reduce((max, templates) => {
			return templates.templates.reduce((max2, template) => {
				return Math.max(max2, template.length)
			}, max)
		}, 0)
		console.log('Loaded %d templates for wakeword "%s"', templates.length, wakeword)
		console.log('Frames: min: %d, max: %d', this._minFrames, this._maxFrames)
	}

	process(audioBuffer) {
		this.push(audioBuffer)
	}

	processFeatures(features) {
		this._features.push(features)
		if ( this._features.length > this._maxFrames ) {
			this._features.shift()
			if ( this._buffering ) {
				this._buffering = false
				this._notifyListening()
			}
			this._runDetection()
		}
	}

	_notifyListening() {
		this.emit('listen')
		this._buffering = false
	}

	_notifyDetected(result) {
		this.emit('detected', result.name, result.index, result.score)
	}

	_runDetection() {
		const features = this._normalizeFeatures( this._features )

		const result = this.wakewords.reduce((result, wakeword) => {
			const {name, templates} = wakeword
			return templates.reduce((result, template, index) => {
				const score = this._comparator.compare(template, features.slice(Math.round(-1 * template.length)))
				if ( result && score < result.score ) return result
				return {name, index, score}
			}, result)
		}, {name: '', index: 0, score: 0})

		if ( result.score >= this.threshold ) {
			if ( !this._detected ) {
				this._detected = true
				setTimeout(() => {
					this._detected = false
					this._notifyListening()
				}, Math.round(this.frameLengthMS * this._minFrames))
				this._notifyDetected(result)
			}
		}
	}

	async extractFeaturesFromFile(file) {
		console.log('Extracting features from file "%s"', file)
		const frames = await new Promise((resolve, reject) => {
			const frames = []
			const extractor = new FeatureExtractor()
			extractor.on('features', features => {
				frames.push(features)
			})
			const input = File.createReadStream( Path.resolve( process.cwd(), file ), {start: 44} )
			input
				.on('error', err => {
					reject(err)
				})
				.on('end', () => {
					resolve( this._normalizeFeatures(frames) )
				})

			input.pipe(extractor)
		})
		console.log('Extracted %d frames from file "%s"', frames.length, file)
		return frames
	}

	_normalizeFeatures(frames) {
		// Normalize by removing mean
		const numFrames			= frames.length
		const numFeatures		= frames[0].length
		const sum				= new Array(numFeatures).fill(0)
		const normalizedFrames	= []
		for ( let i = 0 ; i < numFrames ; i++ ) {
			for ( let j = 0; j < numFeatures ; j++ ) {
				sum[j] += frames[i][j]
			}
		}
		// Note: j = 1 because we remove the first MFCC
		const fromMfcc	= 1
		const toMfcc	= numFeatures
		for ( let i = 0 ; i < numFrames ; i++ ) {
			for ( let j = fromMfcc ; j < toMfcc ; j++ ) {
				const idx = i
				const idx2 = j - 1
				if ( !normalizedFrames[idx] ) normalizedFrames[idx] = []
				const value = frames[i][j]
				normalizedFrames[idx][idx2] = ( value - ( sum[j] / numFrames ) )
			}
		}
		return normalizedFrames
	}
}

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
					this.emit('features', features)
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
		return this.options.preEmphasisCoefficient || 0.95
	}

	_write(audioData, enc, done) {
		this.push(audioData)
		done()
		// this._block.write(audioData, enc, done)
		// this.preEmphasis(audioData)
	}

	preEmphasis(audioBuffer) {
		const coef = this.preEmphasisCoefficient
		const samples = Array
			.from(
				new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength / Int16Array.BYTES_PER_ELEMENT)
			)
			.map((v, i, list) => {
				// if ( i == 0 ) console.log(v, list[i - 1], v - coef * ( list[i - 1] || 0 ))
				return convertInt16ToFloat32(
					v - coef * ( list[i - 1] || 0 )
				)
			})
		// console.log(samples.slice(0, 20))
		// process.exit()
		return samples
	}

	extractFeatures(audioFrame) {
		// console.log(audioFrame)
		// process.exit()
		this._extractor.processAudioFrame(Float32Array.from(audioFrame))
		return this._extractor.getMelFrequencyCepstralCoefficients()
	}
}

class FeatureComparator {
	constructor(options) {
		this.options = options || {}
		this._dtw = new DTW({distanceFunction: FeatureComparator.calculateDistance})
	}

	get bandSize() {
		return this.options.bandSize || 3
	}

	get ref() {
		return this.options.ref || 0.23
	}

	compare(a, b) {
		const cost = this._dtw.compute(a, b, this.bandSize)
		// console.log('Cost', cost)
		const normCost = cost / ( a.length + b.length )
		// console.log('Ncost', normCost)
		return this.computeProbability(normCost)
	}

	computeProbability(cost) {
		return 1 / ( 1 + Math.exp( ( cost - this.ref ) / this.ref ) )
	}

	static calculateDistance(ax, bx) {
		return 1 - cosineSimilarity(ax, bx)
	}
}

module.exports = WakewordEngine