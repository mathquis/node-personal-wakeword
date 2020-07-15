const Stream				= require('stream')
const File					= require('fs')
const Path					= require('path')
const FeatureExtractor		= require('./extractor')
const FeatureComparator		= require('./comparator')
const WakewordKeyword		= require('./keyword')
const VoiceActivityFilter	= require('./vad')

class WakewordDetector extends Stream.Transform {
	constructor(options) {
		// Take audio buffer in and output keyword detection payload
		super({
			readableObjectMode: true
		})

		this.options	= options || {}
		this._keywords	= new Map()
		this._minFrames = 9999
		this._maxFrames = 0

		this._comparator = new FeatureComparator(options)

		this._vad = new VoiceActivityFilter({
			buffering: true,
			sampleRate: this.sampleRate,
			vadDebounceTime: this.vadDebounceTime
		})

		this._vad
			.on('error', err => this.emit('error', new Error('VAD error: ' + err.message)))

		this._extractor = this._createExtractor()

		this._extractor
			.on('data', ({features, audioBuffer}) => this._processFeatures(features, audioBuffer))
			.on('error', err => this.emit('error', new Error('Extraction error: ' + err.message)))

		this._vad.pipe(this._extractor)

		this.clearKeywords()
		this.reset()
	}

	get buffering() {
		return this._buffering
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

	get vadMode() {
		return this.options.vadMode || VoiceActivityFilter.Mode.MODE_AGGRESSIVE
	}

	get vadDebounceTime() {
		return this.options.vadDebounceTime || 500
	}

	async extractFeaturesFromFile(file) {
		const frames = await new Promise(async (resolve, reject) => {
			const frames = []
			const extractor = this._createExtractor()
			extractor.on('data', ({features}) => {
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

	removeKeyword(keyword) {
		this._keywords.delete(keyword)
	}

	clearKeywords() {
		this._keywords = new Map()
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

	reset() {
		this._frames = []
		this._chunks = []
		this._vad.buffering = true
		this._state = {keyword: null, score: 0}
	}

	process(audioBuffer) {
		this._vad.write(audioBuffer)
	}

	_transform(buffer, enc, done) {
		this._vad.write(buffer, enc, done)
	}

	_processFeatures(features, audioBuffer) {
		this._frames.push(features)
		this._chunks.push(audioBuffer)
		const numFrames = this._frames.length
		if ( numFrames > this._minFrames ) {
			if ( this._vad.buffering ) {
				this._vad.buffering = false
				this.emit('ready')
			}
			this._runDetection()
		}
		if ( numFrames > this._maxFrames ) {
			this._frames.shift()
			this._chunks.shift()
		}
	}

	_runDetection() {
		const features	= this._normalizeFeatures( this._frames )
		const result	= this._getBestKeyword(features)
		if ( result.keyword !== null ) {
			if ( result.keyword && result.keyword === this._state.keyword ) {
				if ( result.score < this._state.score ) {
					const timestamp = (new Date()).getTime()
					const audioData = Buffer.concat(this._chunks.slice(Math.round(-1.2 * result.frames)))
					const eventPayload = {
						...result,
						audioData,
						timestamp
					}
					this.emit('keyword', eventPayload)
					this.push(eventPayload)
					this.reset()
					return
				}
			}
		}
		this._state = result
	}

	_getBestKeyword(features) {
		let result = {keyword: null, score: 0, threshold: this.threshold}
		this._keywords.forEach(kw => {
			if ( !kw.enabled ) return
			const threshold = kw.threshold || this.threshold
			const templates = kw.templates
			templates.forEach((template, index) => {
				const frames = features.slice(Math.round(-1 * template.length))
				const score = this._comparator.compare(template, frames)
				if ( score < threshold ) return
				if ( score < result.score ) return
				result = {
					...result,
					keyword: kw.keyword,
					frames: template.length,
					threshold,
					score
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
		const normalizedFrames	= new Array(numFrames)
		// Using for loop for speed
		// See benchmark: https://github.com/dg92/Performance-Analysis-JS
		for ( let i = 0 ; i < numFrames ; i++ ) {
			normalizedFrames[i] = new Array(numFeatures)
			for ( let j = 0; j < numFeatures ; j++ ) {
				sum[j] += frames[i][j]
				normalizedFrames[i][j] = frames[i][j]
			}
		}
		for ( let i = 0 ; i < numFrames ; i++ ) {
			for ( let j = 0; j < numFeatures ; j++ ) {
				normalizedFrames[i][j] = normalizedFrames[i][j] - sum[j] / numFrames
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

WakewordDetector.VadMode = VoiceActivityFilter.Mode

module.exports = WakewordDetector