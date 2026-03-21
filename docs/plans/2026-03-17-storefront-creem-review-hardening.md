# 2026-03-17 Storefront Creem Review Hardening Plan

## Objective and Scope
Harden the public AgentShield storefront so it better aligns with Creem account-review requirements and avoids sending reviewers or buyers into broken payment flows. Scope is limited to the storefront HTML/CSS content, footer/legal navigation, and Cloudflare redeploy. This task does not include enabling live payments in Creem.

## Why This Change Is Needed
Current storefront risks discovered during review:
1. Paid CTA buttons lead to a Creem error page (`Live payments are not enabled for your account`), which can reasonably be interpreted as `Product not ready`.
2. Homepage includes hard-to-verify or absolute marketing claims (`全球首款`, `The First...`, `3,900万+` / `39M+`) that increase `False information` risk.
3. FAQ copy is not fully aligned with published refund policy and runtime behavior.
4. Refund and EULA pages exist but are not exposed in the footer, making legal coverage less obvious during review.

## Assumptions and Constraints
- Creem live payments are still under review and cannot be used as a production checkout path right now.
- The storefront should remain visually close to the current approved design direction and only tighten content/compliance.
- Support email remains `pengluailll@gmail.com` across website and Creem backend.
- Context7 is applicable for Cloudflare Workers static asset routing; no additional library guidance is required for the plain HTML storefront.
- Tavily was unavailable on 2026-03-17 due account usage-limit errors, so official-doc fallback is used.

## Official Sources (accessed 2026-03-17)
1. Creem full docs: https://docs.creem.io/llms-full.txt
2. Creem contact: https://www.creem.io/contact
3. Cloudflare Workers static assets routing: https://developers.cloudflare.com/workers/static-assets/
4. Cloudflare Wrangler configuration (`run_worker_first`): https://developers.cloudflare.com/workers/wrangler/configuration
5. Context7 summary for Cloudflare Workers static assets: `/websites/developers_cloudflare_workers` query on selective `run_worker_first` routing.

## Source-Backed Requirements
From Creem official docs:
- Support email must match a real, reachable email address shown on the website.
- Most common account-review change requests include: support email mismatch, website not accessible, missing legal pages, false information, and product not ready.
- Website must show Privacy Policy and Terms of Service.
- If KYC is rejected, support contact with Store ID is the official next step.

Derived storefront requirements for this task:
1. Remove or disable paid CTAs that currently land on a broken payment flow.
2. Remove or soften unverified superlatives and unsourced big-number claims.
3. Ensure refund and runtime/privacy messaging are accurate and consistent with legal docs and actual product behavior.
4. Make legal pages more obviously accessible from the footer.
5. Keep Cloudflare routing/deploy behavior intact.

## Step-by-Step Execution Plan
1. Inspect current storefront copy and link targets.
2. Update homepage metadata and hero copy to remove unverifiable claims.
3. Replace paid purchase links with non-checkout review-pending CTAs and a clear note that payments open after merchant review.
4. Align FAQ refund copy with the published refund policy.
5. Align FAQ local/runtime copy with actual product behavior: core scanning local-first, some optional features may contact online services.
6. Remove testimonials/social-proof section if it risks violating `No false information`; replace with neutral compatibility/proof points.
7. Add `Refund Policy` and `EULA` footer links.
8. Deploy storefront to Cloudflare Worker.
9. Re-run online checks for homepage, legal pages, download routes, and ensure no `creem.io/payment` links remain on the homepage.

## Validation Plan
- Content grep checks:
  - no `creem.io/payment` links in homepage
  - no `全球首款`, `The First Desktop Security Suite`, `3,900万+`, `39M+`
  - no `30 天内申请全额退款` / `full refund within 30 days`
  - no `never uploads your data to the cloud`
- HTTP checks:
  - homepage returns 200
  - `privacy`, `terms`, `refund`, `eula` return 200
  - download routes still return redirects/success
- Visual smoke check via screenshot after deploy.

## Reverse Review Pass 1: Assumptions / Contradictions / Missing Dependencies
- Risk: removing purchase links may reduce conversion. Mitigation: preserve pricing display and add explicit "payments unlock after review" state.
- Risk: some feature names may also overclaim. Mitigation: verify major Pro feature labels against codebase before keeping them.
- Risk: hidden English copy may still contain risky strings. Mitigation: grep both zh/en variants.
- Risk: footer-only legal links may still be enough, but adding Refund/EULA improves reviewer clarity without hurting UX.

## Reverse Review Pass 2: Failure Modes / Security / Rollback Gaps
- Failure mode: deploy succeeds locally but cached edge still serves old copy. Mitigation: perform online fetch after deploy and visual screenshot.
- Failure mode: removing checkout links breaks intended future flow. Mitigation: keep pricing structure and only swap CTA targets/text; restoring live links later is small and isolated.
- Failure mode: copy changes become inaccurate vs product. Mitigation: soften claims rather than introduce new specifics.
- Rollback gap: if the new copy underperforms, rollback is limited to storefront files and a single redeploy.

## Risks and Rollback
- Main risk is over-correcting the copy and weakening the landing page. Response: preserve layout and pricing, change only risky claims and broken CTAs.
- Rollback is a git revert of storefront file changes plus redeploy.

## Completion Criteria
- Homepage no longer links to broken Creem payment pages.
- Risky unsupported claims removed or softened.
- Refund/local-runtime statements align with policy and product behavior.
- Footer exposes Privacy, Terms, Refund, and EULA.
- Storefront redeployed successfully and online verification passes.
