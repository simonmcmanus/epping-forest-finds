# Deleting someone's Community data

The privacy page (`/terms.html`, section 13) says a person can ask us to delete their Community reports, score and account link. This is the procedure. The code is `netlify/functions/community-delete.js` and `lib/community-delete.js`; it is covered by unit tests.

## 1. Check who is asking
Email requests come to the address on the privacy page with "Privacy request" in the subject. Ask for the **recovery code** shown on their Community screen (Back up or restore your progress). Possession of the code is the proof, the same trust the app itself uses. If they are signed in and have several devices, one code is enough: use `includeAccount` below.

## 2. Run the deletion
`ADMIN_PASSWORD` is the same one the admin dashboard uses. Use the production site for real requests.

```
curl -X POST https://<site>/api/community/delete \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"<recovery code, no dashes>","confirm":"delete","includeAccount":true,"redactIssues":true}'
```

- `confirm` must be `"delete"`: this cannot be undone.
- `includeAccount: true` also removes every other device on the same account and its link records. Leave it out to remove only the one device.
- `redactIssues: true` edits and closes the public GitHub issues filed from their place changes and feedback (the body becomes "The reporter asked for this report to be removed."). It is honoured only on the production deploy and needs `GITHUB_TOKEN`; otherwise the issue numbers are returned under `issues.pending`.

The recovery code is shown with dashes in the app; remove them (and lowercase it) before sending.

## 3. What it removes
From the Community store: the reports, the per-device index, the device's link and the account's membership markers, the per-day counters, the reporter references that credit rewards, the reward records, and the device's entry in its score shard. It then rebuilds the snapshot, so the overlay (the combined results other people see) and the scores no longer include them. The response is a count of each, plus `issues.redacted`, `issues.pending` and `issues.failed`.

## 4. What you have to do by hand
- **Issues listed under `pending` or `failed`:** open each on GitHub and edit or close it. They contain no device id, but their text is the person's.
- **Auth0:** if they signed in, delete their user in the Auth0 dashboard. The deletion above removes our link to it, not Auth0's record.
- **Not covered here:** usage tracking events (privacy page section 1, own retention), Google Analytics, and the mailing list (EmailOctopus, section 12). Handle those through their own routes if the request includes them.

## 5. Reply
Tell the person it is done and what was and was not covered. Keep no copy of the recovery code.

## Open policy questions (owner / legal)
The retention wording on the privacy page ("kept until you ask us to delete them") is a commitment, as is the promise to act on a request. Whether to add a retention period, and any response-time promise, are decisions for the owner. The usage-tracking data's 24-month retention (section 5) is a separate, older commitment with no purge job in this repository.
