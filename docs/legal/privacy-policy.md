# AgentShield Privacy Policy
Last Updated: 2026-03-13

This Privacy Policy explains how AgentShield handles personal data when you use the desktop application, website, checkout flow, and support channels.

## 1. Who We Are
- Product: AgentShield
- Contact for privacy requests: `privacy@your-domain.com`
- Support contact: `support@your-domain.com`

Replace these placeholders with your real contacts before launch.

## 2. Data We Process
- Account and purchase data: email, order ID, plan, payment status (from checkout provider).
- License data: activation code metadata, issue/reissue/revoke status, expiry time.
- App diagnostics: crash logs, operation logs, scan summary statistics, webhook failures.
- Optional support data: messages and attachments that you send to support.

## 3. Data We Do Not Collect by Default
- We do not upload your local files, MCP configs, or key values by default.
- Key Vault secrets are stored in the local system keychain and are not transmitted to our servers unless you explicitly export/share them.

## 4. Purposes of Processing
- Deliver license activation and reissue.
- Prevent abuse, fraud, and unauthorized activations.
- Provide security updates, incident notifications, and support.
- Meet legal obligations such as tax, accounting, and law-enforcement requests.

## 5. Legal Basis (Where Required)
- Contract performance (service delivery).
- Legitimate interests (fraud prevention, service security, observability).
- Legal obligations (financial records, compliance duties).
- Consent (optional marketing emails, if enabled).

## 6. Processors and Third Parties
- Payment and Merchant of Record: Lemon Squeezy.
- Transactional email delivery: Resend.
- Hosting/logging providers used by the license gateway and release infrastructure.

Keep this list accurate and update when vendors change.

## 7. Data Retention
- Purchase and license records: retained for accounting/compliance period required by law.
- Operational logs: retained only as long as needed for reliability and security.
- Support tickets: retained until resolved, then archived according to policy.

## 8. Security Controls
- Signed webhook verification.
- Hashed activation code storage (no plaintext code persistence in gateway DB).
- Admin API authentication for manual reissue/revoke operations.
- Access controls for production secrets and release signing keys.

## 9. Your Rights
Depending on your location, you may request access, correction, deletion, portability, or restriction.

To request: email `privacy@your-domain.com` with subject `AgentShield Privacy Request`.

## 10. Cross-Border Transfers
If data is transferred across regions, we apply appropriate safeguards required by applicable law.

## 11. Children
AgentShield is not intended for children under the minimum age required by applicable law.

## 12. Changes
We may update this policy from time to time. Material changes will be announced in-app or on the website.
