const Stream			= require('stream')
const File				= require('fs')
const Path				= require('path')
const Block				= require('block-stream2')
const VAD 				= require('node-vad')
const FeatureExtractor 	= require('./extractor')
const FeatureComparator	= require('./comparator')
const WakewordKeyword	= require('./keyword')

class WakewordDetector extends Stream.Transform {
	constructor(options) {
		super()
		this.options	= options || {}
		this._keywords	= new Map()
		this._features	= []
		this._buffering	= true
		this._detected	= false
		this._minFrames = 9999
		this._maxFrames = 0
		this._state 	= {keyword: '', score: 0}

		this._comparator = new FeatureComparator(options)

		this._extractor = this._createExtractor()

		this._extractor.on('features', features => {
			this._processFeatures(features)
		})

		this._vad = VAD.createStream({
		    mode: VAD.Mode.AGGRESSIVE,
		    audioFrequency: this.sampleRate,
		    debounceTime: this.vadDebounceTime
		})

		this._vad.on('data', data => {
			if ( this._buffering || ( data && data.speech && data.speech.state == true ) ) {
				this._extractor.write(data.audioData)
			}
		})

		this.pipe(this._vad)
	}

	get buffering() {
		return this._buffering
	}

	get detected() {
		return this._detected
	}

	get channels() {
		return 1
	}

	get bitLength() {
		return this.options.bitLength || 16
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
		return this.options.frameLengthMS || 30.0
	}

	get frameShiftMS() {
		return this.options.frameShiftMS || 10.0
	}

	get threshold() {
		return this.options.threshold || 0.5
	}

	get vadDebounceTime() {
		return this.options.vadDebounceTime || 500
	}

	async extractFeaturesFromFile(file) {
		const frames = await new Promise(async (resolve, reject) => {
			const frames = []
			const extractor = this._createExtractor()
			extractor.on('features', features => {
				frames.push(features)
			})
			const filePath = Path.resolve( process.cwd(), file )
			let stats
			try {
				stats = await File.promises.stat(filePath)
			} catch (err) {
				return reject( new Error(`File "${filePath}" not found`) )
			}
			if ( !stats.isFile() ) {
				return reject( new Error(`File "${filePath}" is not a file`) )
			}
			const input = File.createReadStream( filePath, {start: 44} )
			input
				.on('error', err => {
					reject(err)
				})
				.on('end', () => {
					resolve( this._normalizeFeatures(frames) )
				})

			input.pipe(extractor)
		})
		return frames
	}

	async addKeyword(keyword, files, options) {
		let kw = this._keywords.get(keyword)
		if ( !kw ) {
			kw = new WakewordKeyword(keyword, options)
			this._keywords.set(keyword, kw)
		}
		await Promise.all(
			files.map(async file => {
				const features = await this.extractFeaturesFromFile(file)
				this._minFrames = Math.min(this._minFrames, features.length)
				this._maxFrames = Math.max(this._maxFrames, features.length)
				kw.addFeatures(features)
			})
		)
	}

	enableKeyword(keyword) {
		const kw = this._keywords.get(keyword)
		if ( !kw ) throw new Error(`Unknown keyword "${keyword}"`)
		kw.enabled = true
	}

	disableKeyword(keyword) {
		const kw = this._keywords.get(keyword)
		if ( !kw ) throw new Error(`Unknown keyword "${keyword}"`)
		kw.enabled = false
	}

	process(audioBuffer) {
		this.push(audioBuffer)
	}

	_transform(buffer, enc, done) {
		this.push(buffer)
		done()
	}

	_processFeatures(features) {
		this._features.push(features)
		if ( this._features.length > this._maxFrames ) {
			this._features.shift()
			if ( this._buffering ) {
				this._buffering = false
				this._notifyListening()
			}
			if ( !this._detected ) {
				this._runDetection()
			}
		}
	}

	_notifyListening() {
		this.emit('listen')
		this._buffering = false
	}

	_notifyDetected(result) {
		this._detected = true
		setTimeout(() => {
			this._detected = false
			this._notifyListening()
		}, Math.round(this.frameShiftMS * this._minFrames))
		this.emit('detected', result.keyword, result.score)
	}

	_runDetection() {
		const features = this._normalizeFeatures( this._features )
		const result = this._getBestKeyword(features)
		if ( result.score >= this.threshold ) {
			if ( result.keyword === this._state.keyword ) {
				if ( result.score < this._state.score ) {
					if ( !this._detected ) {
						this._notifyDetected(this._state)
					}
				}
			}
		}
		this._state = result
	}

	_getBestKeyword(features) {
		let result = {keyword: '', score: 0}
		this._keywords.forEach(kw => {
			if ( !kw.enabled ) return
			kw._templates.forEach((t) => {
				const score = this._comparator.compare(t, features.slice(Math.round(-1 * t.length)))
				if ( score > result.score ) {
					result = {
						keyword: kw.keyword,
						score
					}
				}
			})
		})
		return result
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
		const fromMfcc	= 0
		const toMfcc	= numFeatures
		for ( let i = 0 ; i < numFrames ; i++ ) {
			for ( let j = fromMfcc ; j < toMfcc ; j++ ) {
				const idx = i
				const idx2 = j - fromMfcc
				if ( !normalizedFrames[idx] ) normalizedFrames[idx] = []
				const value = frames[i][j]
				normalizedFrames[idx][idx2] = ( value - ( sum[j] / numFrames ) )
			}
		}
		return normalizedFrames
	}

	_createExtractor() {
		return new FeatureExtractor({
			...this.options,
			samplesPerFrame: this.samplesPerFrame,
			samplesPerShift: this.samplesPerShift,
			sampleRate: this.sampleRate
		})
	}
}

module.exports = WakewordDetector