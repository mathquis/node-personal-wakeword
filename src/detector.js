const Stream              = require('stream')
const File                = require('fs')
const Path                = require('path')
const debug               = require('debug')('detector')
const debugDetection      = require('debug')('detected')
const FeatureExtractor    = require('./extractor')
const FeatureComparator   = require('./comparator')
const WakewordKeyword     = require('./keyword')
const VoiceActivityFilter = require('./vad')

class WakewordDetector extends Stream.Transform {
  constructor(options) {
    // Take audio buffer in and output keyword detection payload
    super({
      readableObjectMode: true
    })

    this.options  = options || {}
    this._keywords  = new Map()
    this._buffering = true
    this._full    = false
    this._minFrames = 9999
    this._maxFrames = 0

    debug('sampleRate      : %d', this.sampleRate)
    debug('bitLength       : %d', this.bitLength)
    debug('channels        : %d', this.channels)
    debug('samplesPerFrame : %d', this.samplesPerFrame)
    debug('samplesPerShift : %d', this.samplesPerShift)
    debug('frameLengthMS   : %d', this.frameLengthMS)
    debug('frameShiftMS    : %d', this.frameShiftMS)
    debug('threshold       : %d', this.threshold)
    debug('useVad          : %s', this.useVad)
    debug('vadMode         : %s', this.vadMode)
    debug('vadDebounceTime : %d', this.vadDebounceTime)

    this._comparator = new FeatureComparator(options)

    this._extractor = this._createExtractor()

    this._extractor
      .on('data', ({features, audioBuffer}) => {
        this._processFeatures(features, audioBuffer)
      })
      .on('error', err => {
        this.error(err)
      })
      .on('drain', () => {
        debug('Extractor is available')
        this._full = false
      })

    this._vad = new VoiceActivityFilter({
      buffering: true,
      sampleRate: this.sampleRate,
      vadDebounceTime: this.vadDebounceTime
    })

    this.clearKeywords()
    this.reset()
  }

  get full() {
    return this._full
  }

  get buffering() {
    return this._buffering
  }

  set buffering(enabled) {
    this._buffering = !! enabled
  }

  get channels() {
    return this.options.channels || 1
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
    const threshold = parseFloat(this.options.threshold)
    if ( isNaN(threshold) ) return 0.5
    return threshold
  }

  get useVad() {
    return typeof this.options.vad !== 'undefined' ? this.options.vad : true
  }

  get vadMode() {
    return this.options.vadMode || VoiceActivityFilter.Mode.AGGRESSIVE
  }

  get vadDebounceTime() {
    return this.options.vadDebounceTime || 500
  }

  async extractFeaturesFromFile(file) {
    const filePath = Path.resolve( process.cwd(), file )
    debug('Extracting features from file "%s"', filePath)
    let stats
    try {
      stats = await File.promises.stat(filePath)
    } catch (err) {
      throw new Error(`File "${filePath}" not found`)
    }
    if ( !stats.isFile() ) {
      throw new Error(`File "${filePath}" is not a file`)
    }
    const input = File.createReadStream( filePath, {start: 44} )
    return await this.extractFeaturesFromStream(input)
  }

  async extractFeaturesFromBuffer(buffer) {
    debug('Extracting features from buffer (length: %d)', buffer.length)
    const reader = new Stream.Readable({
      read: () => {}
    })

    reader.push(buffer)
    reader.push(null)

    return await this.extractFeaturesFromStream(reader)
  }

  async extractFeaturesFromStream(input) {
    debug('Extracting features from stream')
    const frames = await new Promise(async (resolve, reject) => {
      const frames = []
      const extractor = this._createExtractor()
      extractor.on('data', ({features}) => {
        frames.push(features)
      })
      input
        .on('error', err => {
          reject(err)
        })
        .on('end', () => {
          resolve( this._normalizeFeatures(frames) )
        })

      input.pipe(extractor)
    })
    const firstFrame = frames[0] || []
    debug('Features: %d x %d', frames.length, firstFrame.length)
    return frames
  }

  async addKeyword(keyword, templates, options) {
    if ( this.destroyed ) throw new Error('Unable to add keyword')
    let kw = this._keywords.get(keyword)
    if ( !kw ) {
      kw = new WakewordKeyword(keyword, options)
      this._keywords.set(keyword, kw)
    }
    await Promise.all(
      templates.map(async template => {
        let features
        if ( Buffer.isBuffer(template) ) {
          features = await this.extractFeaturesFromBuffer(template)
        } else {
          features = await this.extractFeaturesFromFile(template)
        }
        this._minFrames = Math.min(this._minFrames, features.length)
        this._maxFrames = Math.max(this._maxFrames, features.length)
        kw.addFeatures(features)
      })
    )
    debug('Added keyword "%s" (templates: %d)', keyword, templates.length)
  }

  removeKeyword(keyword) {
    if ( this.destroyed ) throw new Error('Unable to remove keyword')
    this._keywords.delete(keyword)
    debug('Removed keyword "%s"', keyword)
  }

  clearKeywords() {
    this._keywords = new Map()
    debug('Keywords cleared')
  }

  enableKeyword(keyword) {
    if ( this.destroyed ) throw new Error('Unable to enable keyword')
    const kw = this._keywords.get(keyword)
    if ( !kw ) throw new Error(`Unknown keyword "${keyword}"`)
    kw.enabled = true
    debug('Keyword "%s" enabled', keyword)
  }

  disableKeyword(keyword) {
    if ( this.destroyed ) throw new Error('Unable to disable keyword')
    const kw = this._keywords.get(keyword)
    if ( !kw ) throw new Error(`Unknown keyword "${keyword}"`)
    kw.enabled = false
    debug('Keyword "%s" disabled', keyword)
  }

  async match(audioData) {
    const st = (new Date()).getTime()
    const frames = await this.extractFeaturesFromBuffer(audioData)
    const features = this._normalizeFeatures(frames)
    const result = this._getBestKeyword(features)
    if ( result.keyword !== null ) {
      const timestamp = (new Date()).getTime()
      const et = (new Date()).getTime()
      const match = {
        ...result,
        score: result.score,
        duration: (et-st)
      }
      return match
    }
    return null
  }

  process(audioBuffer) {
    if ( this.destroyed ) throw new Error('Unable to process audio buffer with destroyed stream')
    this.write(audioBuffer)
  }

  reset() {
    this._frames = []
    this._chunks = []
    this._state = {keyword: null, score: 0}
    this.buffering = true
    debug('Reset')
    debug('destroyed', this.destroyed)
    debug('writable.writable', this.writable)
    debug('writable.writableEnded', this.writableEnded)
    debug('writable.writableCorked', this.writableCorked)
    debug('writable.writableFinished', this.writableFinished)
    debug('writable.writableHighWaterMark', this.writableHighWaterMark)
    debug('writable.writableLength', this.writableLength)
    debug('writable.writableNeedDrain', this.writableNeedDrain)
    debug('readable.readable', this.readable)
    debug('readable.readableEncoding', this.readableEncoding)
    debug('readable.readableEnded', this.readableEnded)
    debug('readable.readableFlowing', this.readableFlowing)
    debug('readable.readableHighWaterMark', this.readableHighWaterMark)
    debug('readable.readableLength', this.readableLength)
    debug('readable.readableObjectMode', this.readableObjectMode)
  }

  error(err) {
    this.emit('error', err)
  }

  destroy(err) {
    this._vad.destroy()
    this._vad = null

    this._extractor.removeAllListeners()
    this._extractor.destroy()
    this._extractor = null

    this._comparator.destroy()
    this._comparator = null

    this.clearKeywords()
    this.reset()

    super.destroy(err)

    debug('Destroyed')
  }

  async _transform(buffer, enc, done) {
    if ( this._keywords.size === 0 ) {
      done()
      return
    }
    if ( this.full ) {
      done()
      return
    }
    if ( this._extractor.full ) {
      done()
      return
    }
    let isVoice = true
    if ( this.useVad ) {
      isVoice = await this._vad.processAudio(buffer)
      debug('Voice? %s', isVoice)
    }
    if ( !isVoice ) {
      done()
      return
    }
    debug('Piping buffer (length: %d)', buffer.length)
    const res = this._extractor.write(buffer)
    if ( !res ) {
      debug('Extractor is full')
      this._full = true
    }
    done()
  }

  _processFeatures(features, audioBuffer) {
    this._frames.push(features)
    this._chunks.push(audioBuffer)
    const numFrames = this._frames.length
    // debug('Processing features (frames: %d, min: %d, max: %d', numFrames, this._minFrames, this._maxFrames)
    if ( numFrames >= this._minFrames ) {
      if ( this.buffering ) {
        this.buffering = false
        this.emit('ready')
        debug('Ready')
      }
      this._runDetection()
    }
    if ( numFrames >= this._maxFrames ) {
      this._frames.shift()
      this._chunks.shift()
    }
  }

  _runDetection() {
    const features  = this._normalizeFeatures( this._frames )
    const result  = this._getBestKeyword(features)
    if ( result.keyword !== null ) {
      if ( result.keyword && result.keyword === this._state.keyword ) {
        if ( result.score < this._state.score ) {
          const timestamp = (new Date()).getTime()
          const audioData = Buffer.concat(this._chunks.slice(Math.round(-1.2 * result.frames)))
          const eventPayload = {
            ...result,
            score: this._state.score,
            audioData,
            timestamp
          }
          debugDetection('------------------------------------')
          debugDetection('Detected "%s" (%f)', eventPayload.keyword, eventPayload.score)
          debugDetection('------------------------------------')
          this.push(eventPayload)
          this.reset()
          return
        }
      }
    }
    debug('Detected keyword "%s" (%f)', result.keyword, result.score)
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
    const numFrames = frames.length
    if ( numFrames === 0 ) return []

    const numFeatures   = frames[0].length
    const sum       = new Array(numFeatures).fill(0)
    const normalizedFrames  = new Array(numFrames)
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