const Path 		= require('path')
const Readline	= require('readline')
const Spawn		= require('child_process').spawn

const recordPath 	= './records'
const chunkSize		= 512
const channels		= 1
const endianess		= 'little'
const bits			= 16
const sampleRate	= 16000
const device 		= null

const rl = Readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

main()

async function main() {
	process.on('SIGINT', () => {
		process.exit()
	})

	const speakerName = await promptFor('Please enter the name of the speaker: ')

	await promptFor('Press ENTER to startv recording!')

	let speakerIndex = parseInt(process.argv[2] || '0')

	while ( true ) {
		speakerIndex++
		const fileName = speakerName + '_' + speakerIndex + '.wav'
		const file = Path.resolve(process.cwd(), recordPath) + '/' + fileName
		await recordSpeaker(file)
		console.log('Saved "%s"', fileName)
	}
}

async function promptFor(text) {
	return new Promise((resolve, reject) => {
		rl.question(text, name => {
			resolve(name.toLowerCase().replace(/[^a-z0-9]+/ig, '').trim())
		})
	})
}

async function promptForEnterKey() {
	return new Promise((resolve, reject) => {
		rl.question('Press ENTER to startv recording!', () => {
			resolve()
		})
	})
}

async function recordSpeaker(file) {
	return new Promise((resolve, reject) => {
		const command = 'sox'
		const args = [
			'--no-show-progress',
			'--buffer=' + chunkSize,
			'--channels=' + channels,
			'--endian=' + endianess,
			'--bits=' + bits,
			'--rate=' + sampleRate
		]

		if ( device ) {
			args.push('--type=alsa')
			args.push(device)
		} else {
			args.push('--default-device')
		}

		args.push('--type=wav')
		args.push(file)

		const capture = Spawn(command, args)

		capture.stderr.pipe(process.stderr)

		rl.question('...recording... Press ENTER to stop recording.', () => {
			capture.on('close', () => {
				capture.removeAllListeners()
				resolve()
			})
			capture.kill()
		})
	})
}