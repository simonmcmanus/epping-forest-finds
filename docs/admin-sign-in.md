# Setting up admin sign-in

The `/admin` dashboard signs in with Auth0, the same provider as community sign-in, and only lets in the people you list.

## Environment variables (Netlify, per deploy context; or the shell for `npm run dev`)

- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH_SECRET` (32 or more characters): already needed for community sign-in. Admin sign-in uses the same values.
- `ADMIN_SUBJECTS`: comma-separated Auth0 subject ids, for example `auth0|abc123,google-oauth2|1234567890`. Spaces and empty entries are ignored; matching is exact. Leave it unset or empty and nobody can sign in to the dashboard (it fails closed).
- `ADMIN_PASSWORD` (optional): only for scripts that send `Authorization: Bearer <password>` and for `POST /api/community/delete`. The dashboard does not use it.

## Auth0 settings

Nothing new. The callback URL is the existing `https://<site>/api/auth/callback` (add `http://localhost:8080/api/auth/callback` for local use, and each preview origin you use). Admin sign-in reuses that callback.

## Finding your subject id

`GET /api/auth/me` does **not** return it: it returns `{ signedIn, name, picture?, account }`, where `account` is a one-way hash of the subject, so it cannot be used in `ADMIN_SUBJECTS`. Use the Auth0 dashboard instead: **User Management > Users**, open your user and copy **user_id** (for example `auth0|abc123` or `google-oauth2|123...`). That value is the `sub`.

## Signing in and out

Open `/admin` and choose "Sign in with Auth0". Auth0 always asks you to sign in again. If your account is listed, you land on the dashboard and stay signed in for 8 hours. If not, the page says "This account isn't on the admin list". To revoke someone, remove their id from `ADMIN_SUBJECTS`: it takes effect on their next request. **Log out** ends the dashboard sign-in only, not your Auth0 or community sign-in.
