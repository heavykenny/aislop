import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrencyLimit } from "../src/utils/concurrency.js";

const sleep = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("mapWithConcurrencyLimit", () => {
	it("never runs more items at once than the limit allows", async () => {
		let inFlight = 0;
		let peakInFlight = 0;
		const items = Array.from({ length: 12 }, (_, index) => index);

		const results = await mapWithConcurrencyLimit(items, 3, async (item) => {
			inFlight += 1;
			peakInFlight = Math.max(peakInFlight, inFlight);
			await sleep(10);
			inFlight -= 1;
			return item * 2;
		});

		expect(peakInFlight).toBe(3);
		expect(results).toEqual(items.map((item) => item * 2));
	});

	it("keeps results in input order when items finish out of order", async () => {
		const items = ["a", "b", "c", "d", "e"];
		const completionOrder: string[] = [];

		// Later items finish first, so completion order is the reverse of input order.
		const results = await mapWithConcurrencyLimit(items, items.length, async (item, index) => {
			await sleep((items.length - index) * 10);
			completionOrder.push(item);
			return item.toUpperCase();
		});

		expect(completionOrder).toEqual(["e", "d", "c", "b", "a"]);
		expect(results).toEqual(["A", "B", "C", "D", "E"]);
	});

	it("propagates a rejection without abandoning work that is already in flight", async () => {
		const items = [0, 1, 2, 3, 4, 5];
		const finished: number[] = [];

		await expect(
			mapWithConcurrencyLimit(items, 2, async (item) => {
				await sleep(5);
				if (item === 1) throw new Error("item 1 failed");
				finished.push(item);
				return item;
			}),
		).rejects.toThrow("item 1 failed");

		// Every other item still ran to completion: the pool waits for the whole
		// batch to settle before surfacing the failure.
		expect(finished.sort((a, b) => a - b)).toEqual([0, 2, 3, 4, 5]);
	});

	it("reports the lowest-index failure even when a later item fails first in time", async () => {
		await expect(
			mapWithConcurrencyLimit([0, 1, 2, 3], 4, async (item) => {
				// Item 3 rejects immediately, item 1 only after a delay.
				if (item === 3) throw new Error("item 3 failed");
				if (item === 1) {
					await sleep(20);
					throw new Error("item 1 failed");
				}
				return item;
			}),
		).rejects.toThrow("item 1 failed");
	});

	it("propagates a rejection whose value is undefined", async () => {
		await expect(
			mapWithConcurrencyLimit([0], 1, async () => {
				throw undefined;
			}),
		).rejects.toBeUndefined();
	});

	it("returns [] for an empty item list without invoking the worker", async () => {
		const worker = vi.fn();
		expect(await mapWithConcurrencyLimit([], 4, worker)).toEqual([]);
		expect(worker).not.toHaveBeenCalled();
	});

	it("runs serially for a limit below 1 instead of stalling", async () => {
		let inFlight = 0;
		let peakInFlight = 0;

		const results = await mapWithConcurrencyLimit([1, 2, 3], 0, async (item) => {
			inFlight += 1;
			peakInFlight = Math.max(peakInFlight, inFlight);
			await sleep(5);
			inFlight -= 1;
			return item;
		});

		expect(peakInFlight).toBe(1);
		expect(results).toEqual([1, 2, 3]);
	});
});
