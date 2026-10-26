/**
 * Centralized DTO Adapters
 *
 * Source: docs/API_SPEC.md (v1.2) §16.1, docs/DATABASE_SCHEMA.md (v1.1)
 *
 * Re-exports bidirectional adapters for:
 * - Business profiles and narrow merchant update serialization
 * - Customer survey questions, options, and privacy-scrubbed feedback
 * - Analytics telemetry, standardized funnel rates, subscriptions, and quota ledgers
 */

export * from './business.ts';
export * from './feedback.ts';
export * from './analytics.ts';
