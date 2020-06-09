const File					= require('fs')
const Path					= require('path')
const Framer				= require('sound-parameters-extractor').framer
const {Wavefile}			= require('wavefile')
const DTW					= require('dtw')
const cosineSimilarity		= require('cos-similarity')
const Glob					= require('glob')
const Chalk					= require('chalk')
const Gist					= require('../node-gist/lib/index')
// const VAD					= require('node-vad')

const config = {
	SHOW_TIMINGS: false,
	THRESHOLD: 0.5,
	DTW_REF: 0.24,
	BAND_SIZE: 4,
	PREEMPHASIS_COEFFICIENT: 0.97,
	// RAW_ENERGY: true,
	// NUM_MEL_BINS: 12,
	// NUM_FEATURES: 12,
	FRAME_LENGTH_MS: 25.0,
	FRAME_SHIFT_MS: 10.0,
	SAMPLE_RATE,
	// LOW_FREQ: 20,
	// HIGH_FREQ: SAMPLE_RATE / 2
}

// console.log(config)

const grey				= Chalk.bold.gray
const error				= Chalk.bold.red
const ok				= Chalk.green
const warning			= Chalk.yellow

const timings			= new Map()
const showTimings		= config.SHOW_TIMINGS
const samplesPerFrame	= config.SAMPLE_RATE * config.FRAME_LENGTH_MS / 1000
const gist				= new Gist(samplesPerFrame, config.SAMPLE_RATE)
const dtw				= new DTW({distanceFunction: dtwCosineSim})
// const vad			= new VAD(VAD.Mode.NORMAL)

let totalFrames = 0
let totalTime = 0
let success = 0
let errors = 0
let falsePositives = 0
let falseNegatives = 0

const STATE_SUCCESS = 'success'
const STATE_FALSE_POSITIVE = 'fp'
const STATE_FALSE_NEGATIVE = 'fn'

// *****
const templates = [
	{
		name: 'mathieu',
		templates: [
			extractTemplateFeaturesFromFile('./wavs/templates/mathieu1.wav'),
			extractTemplateFeaturesFromFile('./wavs/templates/mathieu2.wav'),
			extractTemplateFeaturesFromFile('./wavs/templates/mathieu3.wav'),
			// extractTemplateFeaturesFromFile('./wavs/templates/mathieu4-nonorm.wav')
		]
	},
	{
		name: 'valentine',
		templates: [
			extractTemplateFeaturesFromFile('./wavs/templates/valentine1.wav'),
			extractTemplateFeaturesFromFile('./wavs/templates/valentine2.wav'),
			extractTemplateFeaturesFromFile('./wavs/templates/valentine3.wav'),
			// extractTemplateFeaturesFromFile('./wavs/templates/valentine4-nonorm.wav')
		]
	}
]

totalFrames = 0

const files = Glob.sync('./wavs/*.wav')

files.forEach(file => {
	startTiming('compare')
	const result = compare(templates, file)
	totalTime += stopTiming('compare')
	switch ( result ) {
		case STATE_SUCCESS:
			success++
			break
		case STATE_FALSE_POSITIVE:
			falsePositives++
			break
		case STATE_FALSE_NEGATIVE:
			falseNegatives++
			break
		default:
			errors++
	}
})

const total = success + errors + falsePositives + falseNegatives

console.log(grey(    '---------------------------------------'))
console.log(         'Total frames                 : %d', totalFrames )
console.log(         'Total time                   : %dms', totalTime )
console.log(         'Total duration               : %ds', ( totalFrames * config.FRAME_LENGTH_MS / 1000 ).toFixed(3) )
console.log(         'Speed                        : %dms per frame', ( totalTime / totalFrames ).toFixed(3) )
console.log(grey(    '---------------------------------------'))
console.log(ok(      'Success                      : %d'), success)
console.log(warning( 'False negatives (missed)     : %d'), falseNegatives)
console.log(error(   'False positives (triggered)  : %d'), falsePositives)
console.log(error(   'Errors                       : %d'), errors)
console.log(grey(    '---------------------------------------'))
console.log(warning( 'ER%                          : %d%%'), ( (total - success - falseNegatives) / total * 100 ).toFixed(1) )
console.log(         'Accuracy                     : %d%%', ( (total - falseNegatives - falsePositives - errors) / total * 100 ).toFixed(1) )

function compare(templates, file) {
	console.log(grey('---------------------------------------'))
	const match = file.match(/\/([a-z]+)[^\/]*\.wav$/i)
	const expected = match ? match[1].toLowerCase().trim() : 'unknown'
	const st = (new Date()).getTime()
	startTiming('features')
	const f2 = extractFeaturesFromFile(file)
	stopTiming('features')
	startTiming('dtw')
	const possibles = []
	const bestResult = templates.reduce((results, f1) => {
		const {name, templates} = f1
		possibles.push(name)
		return templates.reduce((results, template, index) => {
			const cost = dtw.compute(template, f2, config.BAND_SIZE)
			// console.log('Cost', cost)
			const normCost = cost / ( template.length + f2.length )
			// console.log('Ncost', normCost)
			const score = computeProbability(normCost)
			// console.log('Prob', prob)
			results.push({name, index, score})
			return results
		}, results)
	}, [])
	.reduce((final, result) => {
		if ( final && result.score <= final.score) return final
		return result
	}, null)
	stopTiming('dtw')
	const et = (new Date()).getTime()
	console.log(grey('Inference time: %f on %d frames'), (et - st), f2.length)
	// console.log(detected)
	if ( bestResult ) {
		if ( bestResult.score >= config.THRESHOLD ) {
			if ( bestResult.name != expected ) {
				console.log(error('[FAILED] Found "%s" / Expected "%s" (score: %f)'), bestResult.name, expected, bestResult.score.toFixed(3))
				return STATE_FALSE_POSITIVE
			}
			console.log(ok('[DETECTED] "%s" (score: %f, index: %d)'), bestResult.name, bestResult.score.toFixed(3), bestResult.index)
			return STATE_SUCCESS
		} else {
			console.log(grey('[IGNORED] Best result was "%s" (score: %f)'), bestResult.name, bestResult.score.toFixed(3))
			if ( possibles.indexOf(expected) >= 0 ) {
				return STATE_FALSE_NEGATIVE
			} else {
				return STATE_SUCCESS
			}
		}
	}
	return STATE_SUCCESS
}

function dtwCosineSim(a, b) {
	return 1 - cosineSimilarity(a, b)
}

function computeProbability(cost) {
	return 1 / ( 1 + Math.exp( ( cost - config.DTW_REF ) / config.DTW_REF ) )
}

function startTiming(key) {
	const st = (new Date()).getTime()
	timings.set(key, st)
}

function stopTiming(key) {
	const timing = timings.get(key)
	if ( !timing ) return 0
	const totalTime = (new Date()).getTime() - timing
	if ( showTimings ) {
		console.log(key, totalTime)
	}
	return totalTime
}

function getFileSamples(file) {
	startTiming('get_samples')
	const samples = Array.from(
		new Int16Array(
			File
			.readFileSync(
				Path.resolve(
					process.cwd(),
					file
				)
			)
			.slice(44)
			.buffer
		)
	)
	stopTiming('get_samples')
	return samples
}

function extractTemplateFeaturesFromFile(file) {
	console.log(grey('Loading template "%s"'), file)
	return getFeatures( getFileSamples( file ) )
}

function extractFeaturesFromFile(file) {
	console.log('Processing file "%s"', file)
	return getFeatures( getFileSamples( file ) )
}

function getFeatures(samples) {
	startTiming('get_features')
	const frames = normalizeFeatures(
						frameSignal(
							preEmphasis(
								normalizeAudio(
									samples
								),
								config.PREEMPHASIS_COEFFICIENT
							)
						)
						.filter(frame => {
							return frame.length === samplesPerFrame
						})
						.map(frame => {
							return extractFeatures(
								windowFrame(frame)
							)
						})
					)
	totalFrames += frames.length
	stopTiming('get_features')
	return frames
}

function convertInt16ToFloat32(n) {
   var v = n < 0 ? n / 32768 : n / 32767;       // convert in range [-32768, 32767]
   return Math.max(-1, Math.min(1, v)); // clamp
}

// Does not change anything!
function normalizeAudio(audio) {
	return audio
	const maxValue = audio.reduce((m, v) => {
		return Math.max(m, Math.abs(v))
	}, 0)
	// console.log('Max:', maxValue)
	return audio.map(v => v / maxValue)
}

// Apply pre-emphasis to the audio sample and return a processed sample
function preEmphasis(audio, coef) {
	startTiming('pre_emphasis')
	const result = audio.map((v, i, list) => {
		return convertInt16ToFloat32(
			v - coef * ( list[i - 1] || 0 )
		)
	})
	stopTiming('pre_emphasis')
	return result
}

// async function filterVAD(audio) {
// 	const chunkStep = Math.round( 16000 * 0.04 )
// 	const vadChunk = []
// 	const bufLen = buf.length
// 	for ( let i = 0 ; i < bufLen ; i+= chunkStep ) {
// 		const chunk = buf.slice(i, i + chunkStep)
// 		// console.log(chunk)
// 		await vad.processAudio(chunk, 16000)
// 			.then(res => {
// 				switch (res) {
// 				    // case VAD.Event.ERROR:
// 				    //     // console.log("ERROR");
// 				    //     break;
// 				    // case VAD.Event.NOISE:
// 				    //     // console.log("NOISE");
// 				    //     break;
// 				    // case VAD.Event.SILENCE:
// 				    //     // console.log("SILENCE");
// 				    //     break;
// 				    case VAD.Event.VOICE:
// 				        // console.log("VOICE");
// 				        vadChunk.push(chunk)
// 				        break;
// 				}
// 			})
// 	}
// 	const vadBuffer = Buffer.concat(vadChunk)
// 	return vadBuffer
// }

// Return an array of audio frames
function frameSignal(audio) {
	startTiming('frame_signal')
	const overlap = Math.round(( config.FRAME_LENGTH_MS - config.FRAME_SHIFT_MS ) / config.FRAME_LENGTH_MS * 100) + '%'
	// console.log('Framing size %d with overlap %s', samplesPerFrame, overlap)
	const frames = Framer(audio, samplesPerFrame, overlap)
	stopTiming('frame_signal')
	// console.log('Frames: %d x %d', frames.length, frames[0].length)
	return frames
}

// Return the windowed frame
function windowFrame(audioFrame) {
	return audioFrame
}

function extractFeatures(audioFrame) {
	// startTiming('extract_features')
	gist.processAudioFrame(Float32Array.from(audioFrame))
	const features = gist.getMelFrequencyCepstralCoefficients()
	// stopTiming('extract_features')
	return features
}

function normalizeFeatures(frames) {
	// Normalize by removing mean
	startTiming('normalize_features')
	const numFrames		= frames.length
	const numFeatures	= frames[0].length
	const sum			= new Array(numFeatures).fill(0)
	const normalized 	= []
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
			if ( !normalized[idx] ) normalized[idx] = []
			const value = frames[i][j]
			normalized[idx][idx2] = ( value - ( sum[j] / numFrames ) )
		}
	}
	stopTiming('normalize_features')
	return normalized
}