# Razorpay billing setup

New local signup accounts receive the trial duration and session limit configured by the administrator. Supabase self-signup accounts are provisioned on their first verified sign-in when SUPABASE_SIGNUP_ENABLED=true. Existing unlinked email accounts require administrator linking; existing account permissions are never silently replaced.

1. Apply the main database migrations (automatically on PostgreSQL startup, or `npm run migration:run:main` for SQLite with synchronization disabled). Back up the database first.
2. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET on the server and restart. Begin with Razorpay test mode keys. Never put the secret in dashboard build variables.
3. In Razorpay, enable automatic capture and register `https://YOUR-API/api/billing/webhook` for `payment.captured`. Replace `/api` with your configured API prefix. Use the same webhook signing secret as RAZORPAY_WEBHOOK_SECRET.
4. Sign in as an administrator, open Subscription & billing, set a trial of 3, 5, 10 or any 0–365 days, add plan prices in INR and choose 1, 3, 6 or 12 months. Save. The initial catalog uses the account owner’s prices: monthly ₹299, quarterly ₹599, half yearly ₹1,499 and yearly ₹2,499, with one WhatsApp session per plan and a 3-day trial. Saved administrator settings override this initial catalog.
5. Make a test purchase from a customer account. Confirm a captured payment activates access; retry the callback/webhook and confirm expiry is extended only once. Test expiry, failure, dismissal, and renewal. Switch to live keys and the corresponding live webhook after validation.

All workspace features remain visible. Account API operations are blocked after expiry, with billing and profile endpoints available to let customers renew. The dashboard checks expiry every 30 seconds. Existing accounts with no expiry must be assigned an expiry by an administrator; they do not receive another trial automatically. Changing trial settings applies only to new accounts. Purchasing a plan snapshots its price, period and session allowance, so later edits do not change an existing payment order. Renewals extend a paid, unexpired term; trial purchases start their paid term immediately. Calendar month arithmetic clamps month-end dates.

Checkout creates a server-side Razorpay Order. Both the signed browser callback and signed raw-body webhook fetch payment status from Razorpay and require captured status, matching order, amount and INR currency. Fulfillment and account expiry updates share a database transaction and serialize per account. Duplicate callbacks do not grant additional months. Abandoned checkout orders remain pending and grant no access.

These are prepaid subscriptions with manual renewal payments, not recurring debit mandates. There are no automatic card debits. Refund and chargeback revocation is currently managed by the administrator through the existing user subscription controls. An expiry sweep pauses running WhatsApp engines on each node within 30 seconds of expiry, including background automation activity. After renewal, customers can restart their sessions from the dashboard.

Official integration reference: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/

## Validation

- Backend and dashboard production builds pass.
- 426 focused auth, billing, scheduling and deployment-configuration tests pass; the global route-fence audit now passes, including separate-controller regression cases.
- Four real HTTP integration scenarios cover signup, administrator-only settings, trial expiry and recovery, captured-payment verification, signed raw-body webhook fulfillment, browser abandonment and duplicate delivery. Only Razorpay's external API is mocked; no real money was charged.
- All SQLite main migrations run successfully against a disposable database with synchronization disabled.
- Full backend unit suite: 6,498 passed, 12 skipped. Dashboard: 429 passed. Backend/dashboard production builds, lint (no errors), dashboard typecheck and dependency security audit pass. These isolated tests do not prove a live merchant payment.
- Razorpay credentials, production SMTP for confirmed self-signup, provider webhook registration, production backup/deployment and a real provider test still require the account owner's secure account setup. No merchant keys are stored in Git.

The default catalog reflects the owner's chosen prices. Keep the same Razorpay account keys, webhook secret and application JWT secret across both production nodes. Leave SUPABASE_SIGNUP_ENABLED=false until confirmation email delivery has been configured and tested. Do not replace the existing JWT secret during deployment: doing so would invalidate existing local tokens.

## Production activation for Waply

The account owner will enter Razorpay credentials and SMTP secrets directly on the server. Configure the three Razorpay variables on both Waply A and Waply B, with identical values. Register `https://wa.yogeshaihub.in/api/billing/webhook` for `payment.captured` in the corresponding Razorpay mode. Reuse the existing merchant key; do not regenerate the key used by other websites. Add the Waply domain to the merchant account and complete the provider review before treating live checkout as verified.

Configure confirmation email delivery in the separate Supabase Auth service, preserving email verification. Confirm signup email delivery and callback URLs before setting `SUPABASE_SIGNUP_ENABLED=true` on both Waply nodes. Keep signup disabled until that check succeeds.

Before a rolling release, take and validate private PostgreSQL backups of `waply_main` and `waply_data`, record both old application images and preserve the shared data volume and existing signing secrets. Deploy one Waply node, verify database migrations and readiness, then deploy the other. If Coolify cannot connect to the host, resolve the host/Redis persistence problem before attempting deployment. Never bypass Redis persistence protection as a substitute for diagnosing the disk or permissions error.
