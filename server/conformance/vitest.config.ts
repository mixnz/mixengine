import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // One file at a time. Every test makes its own account, so the suite would be correct in
    // parallel — but registration is rate limited per source (D8), and a dozen files opening
    // accounts at once from one runner is exactly the shape that limit exists to refuse. A suite
    // that trips the server's abuse controls is testing the wrong thing.
    fileParallelism: false,
    // A cold Worker, a cold Durable Object and an Argon2-sized body on a shared runner. The
    // protocol says nothing about latency; this is a ceiling on waiting, not a budget.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
