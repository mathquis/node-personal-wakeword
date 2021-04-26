import type { Transform, Stream } from 'stream';

declare enum VadMode {
	NORMAL = 0,
	LOW_BITRATE = 1,
	AGGRESSIVE = 2,
	VERY_AGGRESSIVE = 3
}

declare type DetectorOptions = {
	bandSize?: number,
	ref?: number,
	channels?: number,
	bitLength?: number,
	sampleRate?: number,
	frameLengthMS?: number,
	frameShiftMS?: number,
	threshold?: number,
	vadMode?: number,
	vadDebounceTime?: number
};

declare class Detector extends Transform {
	static VadMode: typeof VadMode;

	options: DetectorOptions;
	constructor(options?: DetectorOptions);

	get full(): boolean;
	get buffering(): boolean;
	set buffering(enabled: boolean);
	get channels(): number;
	get bitLength(): number;
	get sampleRate(): number;
	get samplesPerFrame(): number;
	get samplesPerShift(): number;
	get frameLengthMS(): number;
	get frameShiftMS(): number;
	get threshold(): number;
	get useVad(): boolean;
	get vadMode(): number;
	get vadDebounceTime(): number;

	extractFeaturesFromFile(file: string): Promise<number[][]>;
	extractFeaturesFromBuffer(buffer: Buffer): Promise<number[][]>;
	extractFeaturesFromStream(stream: Stream): Promise<number[][]>;

	addKeyword(keyword: string, templates: (Buffer|string)[], options?: { disableAveraging?: boolean, threshold?: number }): Promise<void>;
	removeKeyword(keyword: string): void;
	clearKeywords(keyword: string): void;
	enableKeyword(keyword: string): void;
	disableKeyword(keyword: string): void;
}

export = Detector;