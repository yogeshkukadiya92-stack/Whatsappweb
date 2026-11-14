# Signing in with email, username or mobile number

The sign-in field accepts all three identifiers with the existing password. Signup still requires an email address. The request field remains named `email` for compatibility with existing clients.

## Supabase installations

Set an account's `user_metadata.username` (or `preferred_username`) to its login username using the Supabase administration interface. Set its Supabase `phone` field for mobile login. Phone matching ignores spaces, punctuation and a leading plus; include the country code. Display names are not login usernames.

The Waply server needs `SUPABASE_SERVICE_ROLE_KEY` to resolve usernames and mobile numbers. This credential is used only on the server. Email login continues to use the public authentication endpoint. Aliases resolve to the account's email, then Supabase verifies its password and email confirmation as before. Duplicate aliases are rejected. This does not reactivate imported `dashboard_users` credentials or bypass Supabase identity linking.

Alias resolution currently scans paginated Supabase users and can be slower on large installations; email login avoids that lookup.

## Local authentication

Run the main database migration `1794630000000-AddLoginIdentifiers` before deploying the new server. Both SQLite and PostgreSQL main database migration directories include it. Assign unique `users.username` and `users.phone` values through database administration. Store phone numbers as digits with country code, optionally prefixed by `+`. Existing email and password records continue to work. Existing accounts are not automatically assigned usernames or phone numbers.

Inactive accounts, ambiguous identifiers and incorrect passwords are rejected. Existing account role and API key checks still apply. These changes must be deployed before the live site accepts the new identifiers.
