import type { Transform, Stream } from 'stream';

type SampleRate = 16000 | 22050 | 32000 | 44100 | 48000;
type BitLength = 8 | 16 | 24 | 32;

declare enum VadMode {
  NORMAL = 0,
  LOW_BITRATE = 1,
  AGGRESSIVE = 2,
  VERY_AGGRESSIVE = 3
}

declare type WakewordDetectorOptions = {
  /**
   * DTW window width
   * 
   * @default 5
   */
  bandSize?: number,

  /**
   * Reference distance
   * 
   * @default 0.22
   */
  ref?: number,

  /**
   * Number of input channels. 1 for mono, 2 for stereo.
   * 
   * @default 1
   */
  channels?: 1 | 2,

  /**
   * Bit depth of the input audio.
   * 
   * @default 16
   */
  bitLength?: BitLength,

  /**
   * Sample rate of the input audio. Not recommended to go over 16000 for performance reasons.
   * 
   * @default 16000
   */
  sampleRate?: SampleRate,

  /**
   * Length of each frame in milliseconds. **Must** be a multiple of `frameShiftMS`.
   * 
   * @default 30
   */
  frameLengthMS?: number,

  /**
   * @default 10
   */
  frameShiftMS?: number,

  /**
   * The default detection threshold for new keywords. Each keyword may have their own threshold, but if no threshold
   * is configured for a new keyword, it will default to this.
   * 
   * @default 0.5
   */
  threshold?: number,

  /**
   * Voice activity detection mode. Only applies if `vad` is enabled.
   * 
   * @default VadMode.AGGRESSIVE
   */
  vadMode?: VadMode,

  /**
   * How much time it takes for the VAD mode to change in milliseconds.
   * 
   * @default 500
   */
  vadDebounceTime?: number,

  preEmphasisCoefficient?: number,

  /**
   * Whether or not to use voice activity detection. The detector will only run if there is voice activity detected.
   * 
   * @default true
   */
  vad?: boolean
};

declare class WakewordDetector extends Transform {
  static VadMode: typeof VadMode;

  options: WakewordDetectorOptions;
  constructor(options?: WakewordDetectorOptions);

  /**
   * Whether or not the extractor is currently full.
   */
  get full(): boolean;

  /**
   * Whether or not the detector is currently buffering.
   */
  get buffering(): boolean;
  set buffering(enabled: boolean);

  /**
   * The number of channels in the input audio.
   */
  get channels(): 1 | 2;

  /**
   * The bit depth of the input audio.
   */
  get bitLength(): BitLength;

  /**
   * The sample rate of the input audio.
   */
  get sampleRate(): SampleRate;

  /**
   * The numer of samples per each frame.
   */
  get samplesPerFrame(): number;

  get samplesPerShift(): number;

  /**
   * The length of each frame, in milliseconds.
   */
  get frameLengthMS(): number;

  get frameShiftMS(): number;

  /**
   * The default detection threshold for new keywords. Each keyword may have their own threshold, but if no threshold
   * is configured for a new keyword, it will default to this.
   */
  get threshold(): number;

  /**
   * Whether or not to use voice activity detection. The detector will only run if there is voice activity detected.
   */
  get useVad(): boolean;

  get vadMode(): VadMode;

  /**
   * How much time it takes for the VAD mode to change in milliseconds.
   */
  get vadDebounceTime(): number;

  on(event: 'data', cb: (data: {
    keyword: string,
    score: number,
    threshold: number,
    frames: number,
    audioData: Buffer,
    timestamp: number
  }) => void): void;

  /**
   * Extracts features from a WAV file.
   * 
   * It's assumed that the WAV file has the same sample rate, bit depth, and channels of the detector.
   * 
   * @param file The path to the WAV file.
   */
  extractFeaturesFromFile(file: string): Promise<number[][]>;

  /**
   * Extracts features from a PCM buffer.
   * 
   * It's assumed that the audio buffer has the same sample rate, bit depth, and channels of the detector.
   */
  extractFeaturesFromBuffer(buffer: Buffer): Promise<number[][]>;

  /**
   * Extracts features from a PCM stream.
   * 
   * It's assumed that the audio stream has the same sample rate, bit depth, and channels of the detector.
   */
  extractFeaturesFromStream(stream: Stream): Promise<number[][]>;

  /**
   * Adds a keyword to this detector.
   * 
   * @param templates An array of templates, either a path to a WAV file or a PCM Buffer.
   */
  addKeyword(keyword: string, templates: (Buffer | string)[], options?: {
    /**
     * Disable averaging the template audio.
     * 
     * @default false
     */
    disableAveraging?: boolean,

    /**
     * The threshold of this keyword. Set to 0 or `undefined` to use the detector's default threshold.
     * 
     * @default 0
     */
    threshold?: number
  }): Promise<void>;
  
  /**
   * Removes a keyword from this detector.
   */
  removeKeyword(keyword: string): void;

  /**
   * Clears all keywords from this detector.
   */
  clearKeywords(): void;

  /**
   * Enable detection of a keyword.
   */
  enableKeyword(keyword: string): void;

  /**
   * Disable detection of a keyword.
   */
  disableKeyword(keyword: string): void;
}

export = WakewordDetector;
