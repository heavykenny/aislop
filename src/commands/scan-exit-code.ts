// Error diagnostics always fail CI; the score threshold only applies when the score is scoreable (a withheld score can't be compared to failBelow).
export const computeScanExitCode = (opts: {
	hasErrors: boolean;
	scoreable: boolean;
	score: number;
	failBelow: number;
}): number => (opts.hasErrors || (opts.scoreable && opts.score < opts.failBelow) ? 1 : 0);
