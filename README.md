# node-personal-wakeword

Based on https://medium.com/snips-ai/machine-learning-on-voice-a-gentle-introduction-with-snips-personal-wake-word-detector-133bd6fb568e

### Installation

```bash
npm i @mathquis/node-personal-wakeword
```

### Usage

```javascript
const WakewordDetector = require('@mathquis/node-personal-wakeword')
const Recorder = require('mic')

async function main() {
	// Create a new wakeword detection engine
	const detector = new WakewordDetector({
		/*
		sampleRate: 16000,
		bitLength: 16,
		frameShiftMS: 10.0,
		frameLengthMS: 30.0, // Must be a multiple of frameShiftMS
		vadMode: WakewordDetector.VadMode.AGGRESSIVE, // See node-vad modes
		vadDebounceTime: 500,
		band: 5, // DTW window width
		ref: 0.22, // See Snips paper for explanation about this parameter
		preEmphasisCoefficient: 0.97, // Pre-emphasis ratio
		*/
		threshold: 0.5 // Default value
	})

	// The detector will emit a "ready" event when its internal audio frame buffer is filled
	detector.on('ready', () => {
		console.log('listening...')
	})

	// The detector will emit an "error" event when it encounters an error (VAD, feature extraction, etc.)
	detector.on('error', err => {
		console.error(err.stack)
	})

	// The detector will emit a "keyword" event when it has detected a keyword in the audio stream
	/* The event payload is:
		{
			"keyword"     : "alexa", // The detected keyword
			"score"       : 0.56878768987, // The detection score
			"threshold"   : 0.5, // The detection threshold used (global or keyword)
			"frames"      : 89, // The number of audio frames used in the detection
			"timestamp"   : 1592574404789, // The detection timestamp (ms)
			"audioData"   : <Buffer> // The utterance audio data (can be written to a file for debugging)
		}
	*/
	detector.on('keyword', ({keyword, score, threshold, timestamp}) => {
		console.log(`Detected "${keyword}" with score ${score} / ${threshold}`)
	})

	// Add a new keyword using multiple "templates"
	await detector.addKeyword('alexa', [
		// WAV templates (trimmed with no noise!)
		'./keywords/alexa1.wav',
		'./keywords/alexa2.wav',
		'./keywords/alexa3.wav'
	], {
		// Options
		disableAveraging: true, // Disabled by default, disable templates averaging (note that resources consumption will increase)
		threshold: 0.52 // Per keyword threshold
	})

	// Create an audio stream from an audio recorder (arecord, sox, etc.)
	const recorder = new Recorder({
		channels      : detector.channels, // Defaults to 1
		rate          : detector.sampleRate, // Defaults to 16000
		bitwidth      : detector.bitLength // Defaults to 16
	})

	// Pipe to wakeword detector
	recorder.pipe(detector)

	recorder.start()
}

main()
```