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

'use strict';

export class RateLimiter {

  private tokens: number;
  private lastRefillTime: number;  // high-resolution ms timestamp

  /**
   * @param maxTokens   Maximum tokens in the bucket (also the starting value)
   * @param refillRate  Tokens added per second (may be fractional, e.g. 20/60 = 0.333/s)
   */
  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number  // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefillTime = Date.now();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Attempt to consume one token.
   * Returns true if the request is allowed, false if rate limit is exceeded.
   */
  public tryConsume(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Returns the number of seconds until at least one token will be available.
   * Used to populate the Retry-After header in 429 responses.
   * Returns 0 if a token is already available.
   */
  public secondsUntilNextToken(): number {
    this.refill();

    if (this.tokens >= 1) {
      return 0;
    }

    // How many more tokens do we need? (1 - current fraction)
    const deficit = 1 - this.tokens;
    return Math.ceil(deficit / this.refillRate);
  }

  /**
   * Returns current token count — useful for health checks and testing.
   */
  public currentTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Reset the bucket to full — used in tests and on proxy restart.
   */
  public reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefillTime = Date.now();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Add tokens based on elapsed time since last refill.
   * Called before every consume or query operation.
   */
  private refill(): void {
    const now     = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000;  // convert ms to seconds

    if (elapsed <= 0) {
      return;
    }

    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }
}
