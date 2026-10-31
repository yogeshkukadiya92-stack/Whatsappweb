# Waply billing release preparation

Target: `https://wa.yogeshaihub.in`, served by the existing Waply A and B resources in Coolify. The preparation script does not deploy, restart services, modify secrets or charge a payment.

## Before changing either node

- Select the reviewed commit from the subscription release branch and require the release checks to pass.
- Resolve Coolify host access and any Redis snapshot failure. Do not disable persistence protection to get past the error.
- Confirm the existing PostgreSQL resource is the intended host, verify adequate free disk space, and run `prepare-billing-backups.sh <reviewed-commit>` on that host. Retain its private backup directory and checksums. A failed or partial archive is not a usable release backup.
- Record the current image reference and commit for both Waply resources from Coolify. Preserve the existing shared volume and application signing, API-key pepper and Studio vault secrets. Do not put credentials into the release log.
- Have the owner enter identical `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` values on both Waply nodes. Reuse the existing merchant key rather than replacing a key shared by other sites.
- Have the owner configure SMTP in the separate Supabase Auth service. Keep `SUPABASE_SIGNUP_ENABLED=false` on both Waply nodes until confirmed email delivery has passed.

## Rolling application release

1. Deploy the reviewed commit to Waply A through its existing Coolify resource. Keep Waply B serving the previous image during this step.
2. Check A's deployment log for successful migrations and its private readiness endpoint for both databases. Verify application login, an existing account and billing settings. If A fails, return A to the recorded old image before proceeding.
3. Deploy the same commit to Waply B only after A is healthy. Repeat the private readiness, login and billing checks on B.
4. Verify the public domain, session routing and realtime connection through the existing proxy. Preserve its current two-node routing and storage configuration.
5. Confirm initial prices: monthly ₹299, quarterly ₹599, six months ₹1,499, yearly ₹2,499. Existing saved billing settings take precedence; review them instead of blindly replacing them. The initial trial is 3 days with one WhatsApp session; the administrator may change it.

## Provider and signup activation

- Finish Razorpay approval for the Waply domain. Register `https://wa.yogeshaihub.in/api/billing/webhook` for `payment.captured` in the matching provider mode, using the same signing secret as the nodes. Confirm the merchant's capture configuration without disrupting its other sites.
- Verify signup confirmation delivery and callback URLs using an empty customer fixture account. Only then enable public Supabase signup on both nodes.
- Verify that an expired fixture account can reach billing and its own profile, but cannot start a WhatsApp session or send through background automation.
- Let the owner complete a payment. Verify captured status, exact price, term and session limit; repeat the callback/webhook without extending access twice. Never use a real customer's account or message recipients for this check.

## If a check fails

Keep public signup disabled and stop the rollout. Revert the affected node to its recorded old application image when compatible with the additive database changes. Do not run destructive down migrations or restore databases over live writers as an automatic rollback. A coordinated database restore needs a separate maintenance window, validated backups and stopped writers. Preserve the failure evidence without credentials.

Local and CI payment tests use a mocked provider. No real payment, merchant approval, production backup or production deployment is implied by passing those tests.
