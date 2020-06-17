# node-personal-wakeword

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
		vadDebounceTime: 500,
		band: 5,
		ref: 0.22,
		preEmphasisCoefficient: 0.97,
		*/
		threshold: 0.5 // Default value
	})

	// The detector will emit a "listening" event when it is starting to process the audio stream
	detector.on('listening', () => {
		console.log('listening...')
	})

	// The detector will emit a "detected" event when it has detected a keyword in the audio stream
	detector.on('detected', (keyword, score) => {
		console.log(\`detected "${keyword}" with score ${score}\`)
	})

	// Add a new keyword using multiple "templates"
	await detector.addKeyword('alexa', [
		'./keywords/alexa1.wav',
		'./keywords/alexa2.wav',
		'./keywords/alexa3.wav'
	])

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