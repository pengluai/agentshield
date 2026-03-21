# Creem Promo Rollout Browser Ops (2026-03-20)

## Objective and scope
Use browser automation plus local service execution to complete the AgentShield promo-code rollout flow end to end:
1. Retrieve the Creem API key from the Creem dashboard.
2. Write the key into `.env.license-gateway.local`.
3. Start `license-gateway` with the repository-specified env-loading command and verify health.
4. Create an affiliate + promo code through the local Admin API and verify Creem discount creation succeeded.
5. Start the frontend dev server and verify promo validation, discounted pricing, and checkout URL parameters in the app UI.
6. Re-check the Creem dashboard Discounts list and confirm the new promo code exists.
7. Save screenshots for each major step into `/tmp`.

This plan covers operational rollout and verification. It does not change application source code unless a blocker forces a minimal fix.

## Skill routing
- Primary skill: `playwright`
- Why: the task requires headed browser automation, navigation, screenshots, and a user-assisted login wait state.

## Assumptions and constraints
- The user can complete Creem login manually if the dashboard session is not already authenticated.
- The existing implementation in `scripts/license-gateway.mjs` and `src/components/pages/upgrade-pro.tsx` is the intended rollout target.
- `CREEM_API_KEY` must be treated as a secret: do not print it in the final response or save screenshots that visibly expose the full key.
- Tavily research may be unavailable; official-domain web fallback is acceptable.
- Context7 is not applicable for this task because no additional library/framework implementation guidance is required beyond the existing repo code and Playwright CLI workflow.
- Screenshots will be saved under `/tmp` with descriptive names.

## Local implementation evidence
- `scripts/license-gateway.mjs`:
  - `POST /api/promos/validate` validates promo codes from local state.
  - `POST /admin/affiliates` creates the affiliate locally and attempts `POST https://api.creem.io/v1/discounts` when `CREEM_API_KEY` is present.
- `src/components/pages/upgrade-pro.tsx`:
  - promo validation calls `VITE_LICENSE_GATEWAY_URL || http://localhost:8787`.
  - checkout URLs add `discount_code`, `metadata[affiliate_id]`, `metadata[promo_code]`, `metadata[sku_code]`, `metadata[campaign]`, and `metadata[source]`.

## Step-by-step execution plan
1. Confirm the current local configuration and relevant code paths.
2. Use official Creem documentation to verify where API keys are retrieved and how discounts/checkouts are expected to work.
3. Open the Creem dashboard in a headed browser session; if login is required, pause and wait for the user to finish login.
4. Navigate to `Dashboard > Developers`, create or reveal/copy the Creem API key (`creem_...` for production or `creem_test_...` for sandbox), and update `.env.license-gateway.local`.
5. Start `license-gateway` in a persistent shell session using the repository-provided Node inline loader, then wait for `[license-gateway] listening on :8787`.
6. Verify `http://localhost:8787/health`.
7. Call `POST /admin/affiliates` with the provided admin credentials and target promo data.
8. Confirm `creem_discount_id` is not `null`; if it is `null`, stop and retry API-key retrieval before proceeding.
9. Call `POST /api/promos/validate` and confirm the response reports `valid: true` with the expected discount percent.
10. Start the frontend dev server in a persistent shell session.
11. Open the local app in a headed browser session, navigate to `Upgrade Pro`, enter `TEST30`, validate it, and capture:
    - the success state with green discount text
    - the discounted pricing display with original price struck through
12. Click a purchase button and confirm the outbound Creem checkout URL carries the expected `discount_code` and `metadata` parameters.
13. Return to the Creem dashboard Discounts page and confirm `TEST30` appears with a 30% discount.
14. Reconcile results against the checklist before final delivery.

## Validation plan
- Structured decomposition: Sequential Thinking MCP.
- External verification: official Creem documentation via official-domain web lookup.
- Local verification:
  - `curl -s http://localhost:8787/health`
  - `POST /admin/affiliates`
  - `POST /api/promos/validate`
  - headed browser verification of the frontend flow
  - headed browser verification of the Creem Discounts dashboard
- Artifact capture:
  - save screenshots for the dashboard/API-key step, health/backend step where practical, frontend promo-applied step, checkout-URL verification step, and Creem discounts-list step to `/tmp`.

## Reverse review pass 1: assumptions / dependency / contradiction check
- The official Creem docs point to `Dashboard > Developers`, and live dashboard verification in this task also resolved to `/dashboard/developers`; do not keep relying on `/dashboard/api-keys`.
- The API key may already exist, may require a reveal action, or may need a copy button rather than visible text scraping.
- The env file already contains the target `CREEM_API_KEY=` line, so the task is a replacement, not an append.
- The backend command must not use shell dotenv parsing because this env file contains JSON with braces.
- The frontend may read checkout URLs from `.env.public-sale.local`; if Vite does not auto-load the needed file, the dev server may need an explicit env strategy or existing default behavior must be verified.

## Reverse review pass 2: failure modes / security / rollback check
- Revealing the API key on-screen risks leaking the full secret in screenshots; avoid saving screenshots that show the full key value.
- If `POST /admin/affiliates` partially succeeds locally but Creem creation fails, rerunning with the same promo code can cause a local `409`; choose cleanup or a new code only if needed.
- If port `8787` or `5173` is already in use, inspect the existing process before restarting to avoid disrupting unrelated user work.
- Clicking the buy button may open a new tab or external browser; capture the navigated URL carefully without completing a payment.
- Rollback is limited and should be conservative: if a step fails after local state mutation, stop, inspect `data/license-gateway.json`, and avoid destructive cleanup unless explicitly needed.

## Risks, rollback, and completion criteria
### Risks
- Manual login timing may delay automation.
- Creem dashboard UI labels may differ from the documented structure.
- The project may already contain test promo data that collides with `TEST30`.

### Rollback
- If backend/frontend startup fails, stop the spawned sessions and leave source code unchanged.
- If the new promo record is created locally with a broken Creem sync, pause before creating a second code and report the mismatch.

### Completion criteria
- `CREEM_API_KEY` is populated in `.env.license-gateway.local`.
- `license-gateway` listens on port `8787` and `/health` succeeds.
- The affiliate creation response includes a non-null `creem_discount_id`.
- Promo validation returns a valid 30% discount for `TEST30`.
- The frontend shows the promo-applied success state and discounted pricing.
- The outbound Creem checkout URL includes `discount_code=TEST30` and metadata parameters.
- The Creem dashboard Discounts page shows the created promo code with a 30% discount.
- Screenshots for the executed steps exist under `/tmp`.

## Official sources (accessed 2026-03-20)
- https://docs.creem.io/llms-full.txt
- https://docs.creem.io/getting-started/quickstart
- https://docs.creem.io/features/discounts
- https://docs.creem.io/code/webhooks
- https://www.creem.io/dashboard

## Notes on research path
- Tavily search was attempted first but was unavailable due usage limits, so official-domain web fallback was used.
