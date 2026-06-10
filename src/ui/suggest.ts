const editDistance = (a: string, b: string): number => {
	const rows = a.length + 1;
	const cols = b.length + 1;
	const dist = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
	for (let i = 0; i < rows; i += 1) dist[i][0] = i;
	for (let j = 0; j < cols; j += 1) dist[0][j] = j;
	for (let i = 1; i < rows; i += 1) {
		for (let j = 1; j < cols; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost);
		}
	}
	return dist[a.length][b.length];
};

export const suggestClosest = (token: string, candidates: string[]): string | null => {
	const needle = token.toLowerCase();
	let best: string | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const distance = editDistance(needle, candidate.toLowerCase());
		if (distance < bestDistance) {
			bestDistance = distance;
			best = candidate;
		}
	}
	if (best === null) return null;
	const budget = Math.max(2, Math.ceil(best.length / 3));
	return bestDistance <= budget ? best : null;
};
