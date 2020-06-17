const WakewordEngine = require('./src/')
const Spawn = require('child_process').spawn
const File = require('fs')

async function main() {

	const detector = new WakewordEngine({})

	await detector.addKeyword('mathieu', [
		'./wavs/templates/mathieu1.wav',
		'./wavs/templates/mathieu2.wav',
		'./wavs/templates/mathieu3.wav'
	])

	await detector.addKeyword('valentine', [
		'./wavs/templates/valentine1.wav',
		'./wavs/templates/valentine2.wav',
		'./wavs/templates/valentine3.wav'
	])

	// // await detector.addKeyword('valo', [
	// // 	'./wavs/templates/valo1.wav',
	// // 	'./wavs/templates/valo2.wav',
	// // 	'./wavs/templates/valo3.wav'
	// // ])

	await detector.addKeyword('marie', [
		'./wavs/templates/marie1.wav',
		'./wavs/templates/marie2.wav',
		'./wavs/templates/marie3.wav'
	])

	await detector.addKeyword('arthur', [
		'./wavs/templates/arthur1.wav',
		'./wavs/templates/arthur2.wav',
		'./wavs/templates/arthur3.wav'
	])

	let listening = false
	detector.on('listen', () => {
		listening = true
		console.log('Listening...')
	})

	detector.on('detected', (keyword, score) => {
		console.log('%s - Keyword detected: %s (score: %f)', (new Date()).toISOString(), keyword, score)
	})

	const FRAME_LENGTH	= detector.samplesPerFrame
	const SAMPLE_RATE	= detector.sampleRate
	const BIT_LENGTH 	= detector.bitLength
	const CHANNELS 		= detector.channels
	const ENDIANNESS 	= 'little'

	console.log( "frame length  : %d", FRAME_LENGTH )
	console.log( "sample rate   : %d", SAMPLE_RATE )
	console.log( "bit length    : %d", BIT_LENGTH )
	console.log( "channels      : %d", CHANNELS )

	const command = 'sox'
	const args = [
		'--no-show-progress',
		'--buffer=' + FRAME_LENGTH * BIT_LENGTH / 8,
		'--channels=' + CHANNELS,
		'--endian=' + ENDIANNESS,
		'--bits=' + BIT_LENGTH,
		'--rate=' + SAMPLE_RATE,
		'--default-device',
		'--type=raw',
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