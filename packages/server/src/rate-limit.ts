interface Bucket {
	tokens: number;
	last: number;
}

/**
 * Token bucket rate limiter.
 * Supports both keyed (IP-based for HTTP) and object-keyed (WebSocket connections).
 */
export class RateLimiter {
	private limit: number;
	private ipBuckets = new Map<string, Bucket>();
	private wsBuckets = new WeakMap<object, Bucket>();

	constructor(limitPerSecond: number) {
		this.limit = limitPerSecond;
	}

	/** Check and consume a token. Returns true if allowed. */
	checkIp(ip: string): boolean {
		const now = Date.now();
		let bucket = this.ipBuckets.get(ip);
		if (!bucket) {
			bucket = { tokens: this.limit, last: now };
			this.ipBuckets.set(ip, bucket);
		}
		return this.consume(bucket, now);
	}

	/** Check and consume a token for a WebSocket connection. */
	checkWs(ws: object): boolean {
		const now = Date.now();
		let bucket = this.wsBuckets.get(ws);
		if (!bucket) {
			bucket = { tokens: this.limit, last: now };
			this.wsBuckets.set(ws, bucket);
		}
		return this.consume(bucket, now);
	}

	private consume(bucket: Bucket, now: number): boolean {
		const elapsed = (now - bucket.last) / 1000;
		bucket.tokens = Math.min(this.limit, bucket.tokens + elapsed * this.limit);
		bucket.last = now;
		if (bucket.tokens < 1) return false;
		bucket.tokens -= 1;
		return true;
	}
}
