# Stage 10-H: Business API Path Regression

## Problem

In `apps/web`, a business page can be rendered directly by the unified frontend while still reusing legacy frontend code. In that mode the legacy iframe auth bridge is unavailable. If the reused code falls back to a generic API base such as `/api/v1` and then appends legacy paths like `/api/reviews`, the final request becomes `/api/v1/api/reviews` instead of the `apps/api` business entrypoint. This causes user-facing `Not Found` errors, such as contract review failing when clicking "开始审查".

## Scope

This stage covers API path and auth-header regression protection for the current unified frontend:

- Contract review direct page and reused legacy contract-review frontend code.
- RAG native frontend API and stream requests.
- Competitor analysis native frontend API and stream requests.
- Bid generator native frontend API, stream requests, and protected asset paths.

This stage does not redesign UI, change backend business behavior, remove iframe fallback, or migrate additional legacy runtime code.

## Expected API Entrypoints

- Contract review: `/api/v1/contract-review/api/**`.
- RAG: `/api/v1/rag/api/v1/**`.
- Competitor analysis: `/api/v1/competitor-analysis/api/**`.
- Bid generator: `/api/v1/bid-generator/**`, including `/health` and `/api/**`.

When `VITE_API_BASE_URL` is `/api/v1` or `http://host/api/v1`, module-specific frontend code must append its module prefix exactly once. When the base already includes a module prefix, it must not duplicate it. Legacy standalone backend bases such as `http://127.0.0.1:18125` must remain unchanged.

## Auth Requirements

All direct JSON, stream, and blob requests to `apps/api` must include:

- `Authorization: Bearer <session token>` when a token exists.
- `X-Portal-Client-Id`.
- `credentials: "include"` where the existing shared client or stream helpers already use cookie-compatible requests.

The token must not be placed in URLs, query strings, hash fragments, or long-lived `localStorage`.

## TDD Acceptance

Automated tests must cover:

- Contract review legacy fallback in unified frontend mode builds `/api/v1/contract-review/api/reviews`.
- Absolute platform base `http://127.0.0.1:5220/api/v1` builds `http://127.0.0.1:5220/api/v1/contract-review/api/reviews`.
- Already-prefixed contract review base is not double-prefixed.
- Standalone legacy backend base is not modified.
- Contract review fallback target includes the unified frontend session token and client id headers.
- Contract review also normalizes a complete base such as `/api/v1/contract-review/api` back to `/api/v1/contract-review` before appending legacy paths.
- Bid generator legacy fallback is disabled in top-level unified frontend mode, so platform API failures are not retried as unauthenticated platform requests.
- Native module prefixes for contract review, RAG, competitor analysis, and bid generator match the expected entrypoints above.

## Verification Commands

```bash
npm --prefix apps/web run test:api-paths
npm --prefix apps/web run build
```
