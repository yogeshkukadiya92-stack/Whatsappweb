# Give someone dashboard access

1. Sign in as the administrator using the existing admin API key (select **API Key** on the login screen).
2. Open **API Keys**, then select **Add user** under **User subscriptions**.
3. Enter the person's name, email and a unique password of at least eight characters.
4. Set the account's plan, subscription status and allowed number of WhatsApp sessions, then save.
5. Privately give the person the dashboard URL and their email/password. They can use **Sign In** to log in.

New accounts are ordinary users, not administrators. Existing account session ownership rules apply. Administrators can revoke the associated gateway key from API Keys to stop that account's API access.

Public registration is enabled by default. Visitors can select **Sign Up**, enter their name, email and password, and immediately start using their own account. Returning users select **Sign In**. Set `DASHBOARD_SIGNUP_ENABLED=false` if you later want administrator-only account creation. Administrator account creation uses a separate protected endpoint and remains available with public signup disabled.

Local email authentication uses an installation-specific signing secret saved in `data/.jwt-secret` with owner-only permissions. Persist this directory across restarts. Multiple replicas must share a strong random `JWT_SECRET`. Changing the signing secret invalidates existing email login tokens; users can sign in again. Existing API keys continue to work.

Deploy the rebuilt server and dashboard together. If this installation uses Supabase authentication, its existing signup and account-linking flow remains in effect; local email account creation is unavailable in that mode.
