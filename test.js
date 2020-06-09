const WakewordEngine = require('./index')
const Spawn = require('child_process').spawn
const File = require('fs')

async function main() {

	const detector = new WakewordEngine({})

	await detector.loadTemplate('mathieu', [
		'./wavs/templates/mathieu1.wav',
		'./wavs/templates/mathieu2.wav',
		'./wavs/templates/mathieu3.wav'
	])

	await detector.loadTemplate('valentine', [
		'./wavs/templates/valentine1.wav',
		'./wavs/templates/valentine2.wav',
		'./wavs/templates/valentine3.wav'
	])

	// // await detector.loadTemplate('valo', [
	// // 	'./wavs/templates/valo1.wav',
	// // 	'./wavs/templates/valo2.wav',
	// // 	'./wavs/templates/valo3.wav'
	// // ])

	await detector.loadTemplate('marie', [
		'./wavs/templates/marie1.wav',
		'./wavs/templates/marie2.wav',
		'./wavs/templates/marie3.wav'
	])

	await detector.loadTemplate('arthur', [
		'./wavs/templates/arthur1.wav',
		'./wavs/templates/arthur2.wav',
		'./wavs/templates/arthur3.wav'
	])

	let listening = false
	detector.on('listen', () => {
		listening = true
		console.log('Listening...')
	})

	detector.on('detected', (keyword, index, score) => {
		console.log('%s - Keyword detected: %s [%d] (score: %f)', (new Date()).toISOString(), keyword, index, score)
	})

	const FRAME_LENGTH	= detector.samplesPerFrame
	const SAMPLE_RATE	= detector.sampleRate
	const BIT_LENGTH 	= 2
	const CHANNELS 		= 1
	const ENDIANNESS 	= 'little'

	console.log( "frame length  : %d", FRAME_LENGTH )
	console.log( "sample rate   : %d", SAMPLE_RATE )

	const command = 'sox'
	const args = [
		'--no-show-progress',
		'--buffer=' + FRAME_LENGTH * BIT_LENGTH * 2,
		'--channels=' + CHANNELS,
		'--endian=' + ENDIANNESS,
		'--bits=' + BIT_LENGTH * 8,
		'--rate=' + SAMPLE_RATE,
		'--default-device',
		'--type=wav',
		'-',
		// 'gain',
		// '-6',
		// 'noisered', 'noise.prof', '0.2'
	]

	console.log(args)
	console.log('Buffering...')

	const capture = Spawn(command, args)

	capture.on('error', err => console.log(err))
	capture.on('exit', () => console.log('Recorder exited'))

	capture.stderr.pipe(process.stderr)
	capture.stdout.pipe(detector)
}

main()