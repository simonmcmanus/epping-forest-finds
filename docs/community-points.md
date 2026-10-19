# Community points: how the game works

Every number below lives in one file: `netlify/functions/lib/community-points.js`. Change it there and the scoring, the reward check and the ranks follow. After editing, update the same numbers in `contribute/index.html` (the public explainer) and run `npm run test:unit`, which checks the Community screen's ranks still match.

## Points you earn straight away

| Action | Points | Config key | Notes |
|---|---|---|---|
| Verify a tree you are standing next to | 1 | `verify` | Must be within 60 m (`NEAR_METRES`). |
| ...and a different person independently confirms the same tree | +1 | `verifyConfirmed` | Paid to the first verifier. |
| Add a missing tree (tag number and an accurate GPS fix, 30 m or better) | 1 | `newTree` | Tag "0" is not valid. |
| ...and a second person finds the same new tree | +3 | `newTreeSecondFinder` | |
| Report a problem (not here, different tree, moved...) that others agree with | 2 | `correction` | Two independent people must agree. |

## Points that arrive later (after a person or the City of London acts)

| Action | Points | Config key | How it is checked |
|---|---|---|---|
| The City of London updates its register and it agrees with your report | 10 | `register` | Daily check against the new register: a new tree's tag now exists, a "not here" tree has gone, a moved tree now sits where you put it. |
| Feedback or a bug report you sent is fixed | 1 | `fix` | The GitHub issue is closed as completed. |
| You report a place (pub, cafe, shop...) as wrong and a person confirms it | 3 | `placeConfirmed` | The GitHub issue is closed as completed. |

The first register check only records a baseline, so differences that already exist never pay out. A report made after a register was first seen cannot claim a reward from it.

## Points you do not earn

- Confirming a place is still right earns nothing. It only hides that place's check card on your device.
- Reports made from more than 60 m away, and your own repeat reports about the same thing.

## Ranks

| Rank | From |
|---|---|
| Seedling | 0 |
| Sapling | 5 |
| Woodward | 20 |
| Warden | 50 |

Config key: `RANKS` in the same file (the Community screen mirrors it in `COMMUNITY_RANKS`, `js/community.js`; a unit test fails if they drift).

## Running the reward check

It runs daily (`community-validate-scheduled`). To run it now: the **Run reward check now** button on the admin Community panel. It is safe to run twice. Issue rewards need a GitHub token in the Netlify environment (`GITHUB_TOKEN`); without one, only register rewards are paid.
