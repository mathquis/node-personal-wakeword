const Stream	= require('stream')
const VAD		= require('node-vad')

class VoiceActivityFilter extends Stream.Transform {
	constructor(options) {
		super()
		this.options	= options || {}
		this._buffering	= !!options.buffering

		this._vad = VAD.createStream({
		    mode            : this.vadMode,
		    audioFrequency  : this.sampleRate,
		    debounceTime    : this.vadDebounceTime
		})

		this._vad
			.on('data', data => {
				if ( data.speech.start === true ) {
					this.emit('start')
				}
				if ( data.speech.end === true ) {
					this.emit('stop')
				}
				if ( this.buffering || data.speech.state === true ) {
					this.push(data.audioData)
				}
			})
			.on('error', err => this.error(err))
	}

	get sampleRate() {
		return this.options.sampleRate || 16000
	}

	get vadMode() {
		return this.options.vadMode || VAD.Mode.AGGRESSIVE
	}

	get vadDebounceTime() {
		return this.options.vadDebounceTime || 1000
	}

	get buffering() {
		return !!this._buffering
	}

	set buffering(state) {
		this._buffering = !!state
	}

	_transform(buffer, enc, done) {
		this._vad.write(buffer, enc, done)
	}

	error(err) {
		this.emit('error', err)
	}

	destroy(err) {
		this._vad.removeAllListeners()
		this._vad.destroy()
		this._vad = null

		super.destroy(err)
	}
}

VoiceActivityFilter.Mode = VAD.Mode

module.exports = VoiceActivityFilter