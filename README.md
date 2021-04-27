# node-personal-wakeword

Based on https://medium.com/snips-ai/machine-learning-on-voice-a-gentle-introduction-with-snips-personal-wake-word-detector-133bd6fb568e

### Installation

```bash
npm i @mathquis/node-personal-wakeword
```

### Usage

```javascript
const WakewordDetector = require('@mathquis/node-personal-wakeword')
const Mic              = require('mic')
const Stream           = require('stream')

async function main() {
  // Create a new wakeword detection engine
  let detector = new WakewordDetector({
    /*
    sampleRate: 16000,
    bitLength: 16,
    frameShiftMS: 10.0,
    frameLengthMS: 30.0, // Must be a multiple of frameShiftMS
    vad: true, // Use VAD detection
    vadMode: WakewordDetector.VadMode.AGGRESSIVE, // See node-vad modes
    vadDebounceTime: 500,
    band: 5, // DTW window width
    ref: 0.22, // See Snips paper for explanation about this parameter
    preEmphasisCoefficient: 0.97, // Pre-emphasis ratio
    */
    threshold: 0.5 // Default value
  })

  // *****

  // KEYWORD MANAGEMENT

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

  // Keywords can be enabled/disabled at runtime
  detector.disableKeyword('alexa')
  detector.enableKeyword('alexa')

  // *****

  // EVENTS

  // The detector will emit a "ready" event when its internal audio frame buffer is filled
  detector.on('ready', () => {
    console.log('listening...')
  })

  // The detector will emit an "error" event when it encounters an error (VAD, feature extraction, etc.)
  detector.on('error', err => {
    console.error(err.stack)
  })

  // The detector will emit a "vad-silence" event when no voice is heard
  detector.on('vad-silence', () => {
    console.log('Hearing silence...')
  })

  // The detector will emit a "vad-voice" event when it hears a voice
  detector.on('vad-voice', () => {
    console.log('Hearing voices...')
  })

  // The detector will emit a "data" event when it has detected a keyword in the audio stream
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
  detector.on('data', ({keyword, score, threshold, timestamp}) => {
    console.log(`Detected "${keyword}" with score ${score} / ${threshold}`)
  })

  // Note that as the detector is a transform stream the standard "data" event also works...
  // I just added the "keyword" event for clarity :)

  // *****

  // STREAMS

  // As an alternative to events, the detector is a transform stream that takes audio buffers in and output keyword detection payload
  const detectionStream = new Stream.Writable({
    objectMode: true,
    write: (data, enc, done) => {
      // `data` is equivalent to "data" event payload
      console.log(data)
      done()
    }
  })

  detector.pipe(detectionStream)

  // *****

  // Create an audio stream from an audio recorder (arecord, sox, etc.)
  let recorder = Mic({
    channels      : detector.channels, // Defaults to 1
    rate          : detector.sampleRate, // Defaults to 16000
    bitwidth      : detector.bitLength // Defaults to 16
  })

  let stream = recorder.getAudioStream()

  // Pipe to wakeword detector
  stream.pipe(detector)

  recorder.start()

  // Destroy the recorder and detector after 10s
  setTimeout(() => {
    stream.unpipe(detector)
    stream.removeAllListeners()
    stream.destroy()
    stream = null

    recorder = null

    detector.removeAllListeners()
    detector.destroy()
    detector = null
  }, 10000)
}

main()
```
