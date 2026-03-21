# Creem Store Go-Live Readiness Check (2026-03-17)

## Objective and scope
Answer two concrete questions using official Creem documentation plus the current project codebase:
1. Based on the current verification/payment status, what is still missing before the store can sell live?
2. Once live, how does a customer buy, pay, receive an activation code, and activate AgentShield?

This task includes research, dashboard-state interpretation, code-path verification, and a beginner-friendly runbook. It does not change production config in this pass.

## Assumptions and constraints
- User has already passed at least personal/store review and is now on a verification/payment setup screen.
- Screenshot is recent and accurate.
- Tavily may be unavailable; fallback to official Creem docs and local verified copies is acceptable.
- Context7 is not applicable unless a library/framework integration detail becomes necessary.

## Step-by-step execution plan
1. Reconfirm official Creem requirements for account review, payout account setup, and go-live readiness.
2. Interpret the current dashboard screenshot against official requirements.
3. Inspect current project code and storefront state to determine whether checkout is still disabled and what must be switched for live sales.
4. Inspect license issuance flow in code: webhook -> license record -> email delivery -> app activation.
5. Synthesize a checklist of remaining tasks for go-live.
6. Explain the end-user purchase and activation journey.

## Validation plan
- Sequential Thinking MCP for structured decomposition.
- Official Creem docs via official search / local full-doc export.
- Local code inspection with rg/sed.
- No code changes in this pass, so validation is evidence-based cross-checking rather than build/test.

## Reverse review pass 1: assumptions / dependency / contradiction check
- Passing one review step does not imply live payments are enabled.
- A payout account can exist but still be pending or not linked to the store.
- Website readiness and product readiness do not auto-open checkout if store payment setup is incomplete.
- Frontend storefront may still intentionally disable paid CTAs even after dashboard approval unless env/config is updated.

## Reverse review pass 2: failure modes / security / rollback check
- Risk of telling user to go live before payout account/store link is active.
- Risk of claiming customers see activation code on the payment page when actual delivery is email/webhook based.
- Risk of switching live checkout before validating webhook secret and email delivery.
- Safe rollback: keep storefront purchase buttons disabled until live links + live webhook are verified.

## Risks, rollback, and completion criteria
### Risks
- Screenshot may not show hidden details such as payout account state or linked-store state.
- Creem UI labels may differ from docs, so interpretation must be cautious.

### Rollback
- If any live prerequisite is unclear, keep storefront checkout disabled and instruct user to verify the exact dashboard state.

### Completion criteria
- Provide an evidence-backed list of remaining tasks before live sales.
- Provide an accurate customer payment-to-activation flow based on current code.
- Cite official sources with access date.

## Official sources (accessed 2026-03-17)
- https://docs.creem.io/merchant-of-record/account-reviews/account-reviews
- https://docs.creem.io/getting-started/test-mode
- https://docs.creem.io/code/webhooks
- https://docs.creem.io/merchant-of-record/finance/payout-accounts
- https://docs.creem.io/merchant-of-record/finance/payouts
- https://docs.creem.io/llms-full.txt
