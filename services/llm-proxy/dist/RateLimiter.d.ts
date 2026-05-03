/**
 * DarkHorse LLM Proxy — Rate Limiter
 *
 * Token bucket algorithm. Single global counter for MVP-5.
 * Per-user rate limiting added in CPI-1.
 *
 * Token bucket behaviour:
 *   - Bucket starts full (maxTokens)
 *   - Each request consumes 1 token
 *   - Tokens refill continuously at refillRate tokens/second
 *   - If bucket is empty, request is rejected with 429
 *   - No queuing — rejected requests must be retried by the caller
 *
 * Why token bucket over fixed window?
 *   - Smoother handling of bursts (developer pastes large file, asks 5 questions)
 *   - No cliff edge at window boundary
 *   - Simple to reason about and test
 */
export declare class RateLimiter {
    private readonly maxTokens;
    private readonly refillRate;
    private tokens;
    private lastRefillTime;
    /**
     * @param maxTokens   Maximum tokens in the bucket (also the starting value)
     * @param refillRate  Tokens added per second (may be fractional, e.g. 20/60 = 0.333/s)
     */
    constructor(maxTokens: number, refillRate: number);
    /**
     * Attempt to consume one token.
     * Returns true if the request is allowed, false if rate limit is exceeded.
     */
    tryConsume(): boolean;
    /**
     * Returns the number of seconds until at least one token will be available.
     * Used to populate the Retry-After header in 429 responses.
     * Returns 0 if a token is already available.
     */
    secondsUntilNextToken(): number;
    /**
     * Returns current token count — useful for health checks and testing.
     */
    currentTokens(): number;
    /**
     * Reset the bucket to full — used in tests and on proxy restart.
     */
    reset(): void;
    /**
     * Add tokens based on elapsed time since last refill.
     * Called before every consume or query operation.
     */
    private refill;
}
//# sourceMappingURL=RateLimiter.d.ts.map