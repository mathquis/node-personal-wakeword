const Stream			= require('stream')
const File				= require('fs')
const Path				= require('path')
const Block				= require('block-stream2')
const Framer			= require('sound-parameters-extractor').framer
const DTW				= require('dtw')
const cosineSimilarity	= require('cos-similarity')
const Gist				= require('../node-gist/lib/index')

const NONE		= false
const DETECTED	= true

function convertInt16ToFloat32(n) {
   var v = n < 0 ? n / 32768 : n / 32767;       // convert in range [-32768, 32767]
   return Math.max(-1, Math.min(1, v)); // clamp
}

class WakewordEngine extends Stream.Writable {
	constructor(options) {
		super()
		this.options = options || {}
		this.ringBuffer = []
		this.templates = []
		this._buffering = true
		this._detected = false
		this._extractor = new FeatureExtractor({
			samplesPerFrame: this.samplesPerFrame,
			sampleRate: this.sampleRate
		})
		this._comparator = new FeatureComparator(options)
		this.block = new Block( this.samplesPerFrame * 2 )
		this.detector = new Stream.Writable({
			write: (audioData, enc, cb) => {
				// console.log('Received streaming audio data')
				this.process(audioData, cb)
			}
		})
		this.detector.on('error', err => console.log(err))
		this.block.pipe(this.detector)
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

	get frameLengthMS() {
		return this.options.frameLengthMS || 25.0
	}

	get frameShiftMS() {
		return this.options.frameShiftMS || 10.0
	}

	get preEmphasisCoefficient() {
		return this.options.preEmphasisCoefficient || 0.97
	}

	get frameOverlap() {
		return Math.round(( this.frameLengthMS - this.frameShiftMS ) / this.frameLengthMS * 100) + '%'
	}

	get threshold() {
		return this.options.threshold || 0.5
	}

	loadTemplate(wakeword, templates) {
		this.templates.push({
			name: wakeword,
			templates: templates.map(template => {
				console.log('Loading "%s"', template)
				return this.extractFeaturesFromFile(template)
			})
		})
		this._minFrames = this.templates.reduce((min, templates) => {
			return templates.templates.reduce((min2, template) => {
				return Math.min(min2, template.length)
			}, min)
		}, 9999)
		this._maxFrames = this.templates.reduce((max, templates) => {
			return templates.templates.reduce((max2, template) => {
				return Math.max(max2, template.length)
			}, max)
		}, 0)
		console.log('Loaded %d templates for wakeword "%s"', templates.length, wakeword)
		console.log('Frames: min: %d, max: %d', this._minFrames, this._maxFrames)
	}

	process(audioData, cb) {
		this._queueAudioData(audioData, () => {
			// console.log('Processing audio data')
			this._runDetection(cb)
		})
	}

	_notifyListening() {
		this.emit('listen')
	}

	_notifyDetected(result) {
		this.emit('detected', result.name, result.index, result.score)
	}

	_write(audioData, enc, cb) {
		this.block.write(audioData, cb)
	}

	_queueAudioData(audioData, cb) {
		this.ringBuffer.push(audioData)
		if ( this.ringBuffer.length > this._maxFrames ) {
			this.ringBuffer.shift()
		}
		cb()
	}

	_runDetection(cb) {
		if ( this.ringBuffer.length < this._minFrames ) return cb ? cb() : undefined

		if ( this._buffering ) {
			this._buffering = false
			this._notifyListening()
		}

		const buffer = Buffer.concat(this.ringBuffer)
		const f2 = this.extractFeatureFromBuffer(buffer.buffer)
		const bestResult = this.templates.reduce((results, f1) => {
			const {name, templates} = f1
			return templates.reduce((results, template, index) => {
				const score = this._comparator.compare(template, f2.slice(Math.round(-1 * template.length)))
				results.push({name, index, score})
				return results
			}, results)
		}, [])
		.reduce((final, result) => {
			if ( final && result.score <= final.score) return final
			return result
		}, null)


		if ( bestResult ) {
			// console.log(bestResult)
			if ( bestResult && bestResult.score >= this.threshold ) {
				if ( !this._detected ) {
					this._detected = true
					setTimeout(() => {
						this._detected = false
						this._notifyListening()
					}, Math.round(this.frameLengthMS * this._minFrames))
					this._notifyDetected(bestResult)
				}
			}
		}

		if ( cb ) cb()
	}

	extractFeaturesFromFile(file) {
		return this.extractFeatureFromBuffer(
			File
			.readFileSync(
				Path.resolve(
					process.cwd(),
					file
				)
			)
			.buffer.slice(44)
		)
	}

	extractFeatureFromBuffer(buffer) {
		return this.normalizeFeatures(
				this.splitFrames(
					this.preEmphasis(buffer)
				)
				.filter(frame => {
					return frame.length === this.samplesPerFrame
				})
				.map(frame => {
					return this.extractFeatures(
						this.windowFrame(
							frame
						)
					)
				})
			)

	}

	preEmphasis(audioBuffer) {
		const coef = this.preEmphasisCoefficient
		// console.log(new Int16Array(audioBuffer))
		const samples = Array
			.from(
				new Int16Array(audioBuffer)
			)
			.map((v, i, list) => {
				if ( i == 0 ) console.log(v, list[i - 1], v - coef * ( list[i - 1] || 0 ))
				return convertInt16ToFloat32(
					v - coef * ( list[i - 1] || 0 )
				)
			})
		console.log(samples.slice(0, 20))
		// process.exit()
		return samples
	}

	splitFrames(audioSamples) {
		// console.log('Framing size %d with overlap %s', this.samplesPerFrame, this.frameOverlap)
		return Framer(audioSamples, this.samplesPerFrame, this.frameOverlap)
	}

	windowFrame(audioFrame) {
		return audioFrame
	}

	extractFeatures(audioFrame) {
		console.log(audioFrame.slice(0, 10))
		console.log(audioFrame.length)
		process.exit()
		return this._extractor.extractFeatures(audioFrame)
	}

	normalizeFeatures(frames) {
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

class FeatureExtractor {
	constructor(options) {
		this.options = options || {}
		this._extractor = new Gist(this.samplesPerFrame, this.sampleRate)
	}

	get sampleRate() {
		return this.options.sampleRate || 16000
	}

	get samplesPerFrame() {
		return this.options.samplesPerFrame || 400
	}

	extractFeatures(audioFrame) {
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
		return this.options.bandSize || 5
	}

	get ref() {
		return this.options.ref || 0.22
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