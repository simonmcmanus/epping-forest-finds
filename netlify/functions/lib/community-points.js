// The one place every community point value and rank threshold lives. Change a number here and the
// scoring, the reward check and the Community screen all follow (docs/community-points.md explains
// each line in plain language; test/forest-finds.test.js checks js/community.js ranks still match).
const POINTS = {
  verify: 1,              // verify a tree you are standing next to
  verifyConfirmed: 1,     // extra, when a different person independently confirms the same tree
  newTree: 1,             // add a missing tree (tag number + accurate GPS)
  newTreeSecondFinder: 3, // extra, when a second person finds the same new tree
  correction: 2,          // a "this is wrong" report that others agree with
  register: 10,           // after the fact: the City of London register now agrees with your report
  fix: 1,                 // after the fact: your feedback / bug report was fixed
  placeConfirmed: 3,      // after the fact: your "this place is wrong" report was confirmed
};

// Highest threshold first match wins; keep ascending. `icon` is a key of COMMUNITY_ICONS in js/community.js.
const RANKS = [
  { min: 0, name: "Seedling", icon: "sprout" },
  { min: 5, name: "Sapling", icon: "leaf" },
  { min: 20, name: "Woodward", icon: "tree" },
  { min: 50, name: "Warden", icon: "shield" },
];

// A reporter further than this from the thing they report is not counted as an independent check.
const NEAR_METRES = 10;

module.exports = { POINTS, RANKS, NEAR_METRES };
