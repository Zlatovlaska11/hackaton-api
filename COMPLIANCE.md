# Compliance Notes

This codebase now includes code-level hardening for privacy and AI use:

- public-profile data minimization
- opt-in location sharing
- opt-in external AI processing
- data export and account deletion endpoints
- automatic retention cleanup
- safer `POST` request bodies for coordinate-bearing endpoints
- tighter CORS and basic security headers
- application-level rate limiting
- no default public OSRM endpoint
- less precise friend-location sharing

## Still Required Outside the Codebase

These items still need operational work and cannot be solved by code alone:

- privacy notice and user-facing disclosures
- controller/processor and subprocessor records
- transfer assessment and contractual handling for OpenAI and hosting/vendors
- record of processing activities
- incident response and breach reporting process
- lawful-basis analysis for messaging, location, and AI features
- staff AI-literacy and operational training

## Rollout Order

1. Apply the Prisma migration.
2. Set `JWT_SECRET`, `CORS_ORIGIN`, and `OSRM_BASE_URL`.
3. Update the frontend to the new `POST` route and question endpoints.
4. Add a UI for `/users/privacy`.
5. Publish privacy and vendor disclosures before production use.
