// Bounded-concurrency map for work that is one subprocess per item (the repo has
// no p-limit-style dependency and does not need one). The point is single-
// threaded tools like clang-format: an engine only gets the machine's width by
// running several invocations at once, but an unbounded fan-out over a huge
// tree would spawn thousands of processes.
//
// Ordering guarantees, which every caller depends on for deterministic output:
// results are stored at the item's own index, so the returned array matches the
// input order no matter which item finishes first; and a rejection is held
// until the whole batch has settled, then the LOWEST-index failure is rethrown,
// which is the same error a serial loop would have surfaced first. Later items
// still run after a failure - in-flight subprocesses are never abandoned, since
// killing them would leave partially written files behind.
export const mapWithConcurrencyLimit = async <Item, Result>(
	items: readonly Item[],
	concurrencyLimit: number,
	worker: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> => {
	const results = Array.from<Result>({ length: items.length });
	let firstFailureIndex = -1;
	let firstFailure: unknown;
	let nextIndex = 0;

	// Each runner pulls the next unclaimed index until the queue drains, so a
	// slow item holds up only its own runner rather than a fixed-size batch.
	const runNextItem = async (): Promise<void> => {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			try {
				results[index] = await worker(items[index], index);
			} catch (error) {
				if (firstFailureIndex === -1 || index < firstFailureIndex) {
					firstFailureIndex = index;
					firstFailure = error;
				}
			}
		}
	};

	const runnerCount = Math.min(Math.max(1, Math.floor(concurrencyLimit)), items.length);
	await Promise.all(Array.from({ length: runnerCount }, () => runNextItem()));
	// Index check, not a truthiness check on the value: a worker is free to
	// reject with undefined and that must still propagate.
	if (firstFailureIndex !== -1) throw firstFailure;
	return results;
};
