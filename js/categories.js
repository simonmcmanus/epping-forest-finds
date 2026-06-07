// Filter group definitions and all category/tag classification logic.
// No DOM or state dependencies — safe to load before the main script.

const FILTER_GROUPS = [
  {
    key: "nature",
    label: "🌿 Nature",
    subfilters: [
      { key: "trees", label: "🌳 Trees", title: "trees" },
      { key: "cows", label: "🐄 Cows", title: "cows" },
      { key: "waymarked_trails", label: "🥾 Waymarked trails", title: "waymarked trails" },
      { key: "ponds_streams", label: "💧 Ponds & streams", title: "ponds and streams" },
    ],
  },
  {
    key: "food",
    label: "🍽️ Food",
    subfilters: [
      { key: "pubs", label: "🍺 Pubs & bars", title: "pubs and bars" },
      { key: "restaurants", label: "🍽️ Restaurants", title: "restaurants" },
      { key: "cafes", label: "☕ Cafés", title: "cafés" },
      { key: "shops", label: "🛒 Shops", title: "shops" },
    ],
  },
  {
    key: "transport",
    label: "🚌 Transport",
    subfilters: [
      { key: "bus", label: "🚌 Bus stops", title: "bus stops" },
      { key: "underground", label: "🔴 Underground", title: "Underground stations" },
      { key: "national_rail", label: "⇄ National Rail", title: "National Rail / overground stations" },
      { key: "parking", label: "🅿️ Car parks", title: "car parks" },
    ],
  },
  {
    key: "history",
    label: "📜 History",
    subfilters: [
      { key: "history_general", label: "🏛️ Historic places", title: "historic places" },
      { key: "royal", label: "👑 Royal", title: "royal-history places" },
      { key: "ww2", label: "🪖 WWII", title: "WWII places" },
      { key: "social_history", label: "🧺 Social history", title: "social history places" },
      { key: "plaques", label: "🪧 Plaques", title: "plaques" },
      { key: "blue_plaques", label: "🔵 Blue plaques", title: "blue plaques" },
    ],
  },
  {
    key: "locations",
    label: "📍 Locations",
    subfilters: [
      { key: "celebrity_association", label: "⭐ Celebrity", title: "celebrity links" },
      { key: "science", label: "🔭 Science", title: "science places" },
      { key: "education", label: "🎓 Education", title: "education places" },
      { key: "medicine", label: "⚕️ Medicine", title: "medicine places" },
      { key: "literature", label: "📚 Literature", title: "literary places" },
      { key: "theatre", label: "🎭 Theatre", title: "theatre places" },
      { key: "politics", label: "🏛️ Politics", title: "politics places" },
      { key: "art", label: "🎨 Art", title: "art places" },
      { key: "church", label: "⛪ Church", title: "churches" },
    ],
  },
  {
    key: "stories",
    label: "✨ Stories",
    subfilters: [
      { key: "legends", label: "✨ Legends", title: "legends" },
      { key: "film_tv", label: "🎬 Film/TV", title: "film and TV locations" },
    ],
  },
];

const FILTER_GROUPS_BY_KEY = new Map(FILTER_GROUPS.map((group) => [group.key, group]));
const FILTER_SUBFILTERS = FILTER_GROUPS.flatMap((group) =>
  group.subfilters.map((subfilter) => ({ ...subfilter, groupKey: group.key, groupLabel: group.label }))
);
const FILTER_SUBFILTERS_BY_KEY = new Map(FILTER_SUBFILTERS.map((subfilter) => [subfilter.key, subfilter]));
const ALL_OVERVIEW_FILTER_KEYS = new Set(FILTER_SUBFILTERS.map((subfilter) => subfilter.key));
// Base layers (paths, hydrology, nature designations, buildings) are always visible
const LAYER_FILTER_KEYS = new Set([]);
const TREE_FILTER_KEYS = new Set(["trees"]);
const COW_FILTER_KEYS = new Set(["cows"]);
const PATH_FILTER_KEYS = new Set(["waymarked_trails"]);
const WATER_FILTER_KEYS = new Set(["ponds_streams"]);
const PLACE_FILTER_KEYS = new Set(
  FILTER_SUBFILTERS.map((subfilter) => subfilter.key).filter(
    (key) => !LAYER_FILTER_KEYS.has(key) && !TREE_FILTER_KEYS.has(key) &&
             !COW_FILTER_KEYS.has(key) && !PATH_FILTER_KEYS.has(key) && !WATER_FILTER_KEYS.has(key)
  )
);

const PLACE_FILTER_PRIORITY = [
  "pubs", "restaurants", "cafes", "shops",
  "bus", "underground", "national_rail", "parking",
  "blue_plaques", "plaques", "film_tv", "royal", "ww2", "social_history", "history_general",
  "celebrity_association", "science", "education", "medicine", "literature",
  "theatre", "politics", "art", "church", "legends",
];

// Single source of truth for all icon paths. To add an icon: drop the file
// in data/icons/ (or data/icons/trees/) and add one line here.
const ICON_PATHS = {
  // App UI
  bus: "data/icons/bus.png",
  feedback: "data/icons/feedback.png",
  filter: "data/icons/filter.png",
  home: "data/icons/home.png",
  nearby: "data/icons/nearby.png",
  settings: "data/icons/settings.png",
  tick: "data/icons/tick.png",
  walking: "data/icons/walking.png",

  // Landmarks
  "landmark-archaeological": "data/icons/landmark-archaeological.png",
  "landmark-bench": "data/icons/landmark-bench.png",
  "landmark-campsite": "data/icons/landmark-campsite.png",
  "landmark-drinking-water": "data/icons/landmark-drinking-water.png",
  "landmark-dry-cleaning": "data/icons/landmark-dry-cleaning.png",
  "landmark-information": "data/icons/landmark-information.png",
  "landmark-monument": "data/icons/landmark-monument.png",
  "landmark-museum": "data/icons/landmark-museum.png",
  "landmark-parking": "data/icons/landmark-parking.png",
  "landmark-taxi": "data/icons/landmark-taxi.png",
  "landmark-toilets": "data/icons/landmark-toilets.png",

  // Tree species (leaf icons)
  "tree-ash": "data/icons/trees/ash.png",
  "tree-common-beech": "data/icons/trees/beach.png",
  "tree-holly": "data/icons/trees/holly.png",
  "tree-hornbeam": "data/icons/trees/hornbeam.png",
  "tree-english-oak": "data/icons/trees/oak.png",
  "tree-wild-service": "data/icons/trees/wild.png",
};

// Matches a tree's common/latin name text to a leaf icon slug.
const TREE_SPECIES_ICON_TOKENS = [
  { tokens: ["beech", "fagus"], icon: "tree-common-beech" },
  { tokens: ["oak", "quercus"], icon: "tree-english-oak" },
  { tokens: ["hornbeam", "carpinus"], icon: "tree-hornbeam" },
  { tokens: ["holly", "ilex"], icon: "tree-holly" },
  { tokens: ["ash", "fraxinus"], icon: "tree-ash" },
  { tokens: ["wild service", "sorbus torminalis"], icon: "tree-wild-service" },
];

// --- Tag normalization ---

function normalizeTag(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function addExpandedTag(set, value) {
  const tag = normalizeTag(value);
  if (!tag) return;
  set.add(tag);
  if (tag === "place_of_worship") set.add("church");
  if (tag === "blue_plaque") set.add("plaque");
  if (tag === "heritage_plaque") set.add("plaque");
  if (tag === "royal_history") set.add("royal");
  if (tag === "social_history") set.add("social_history");
  if (tag === "victorian_history") set.add("social_history");
  if (tag === "public_access") set.add("social_history");
  if (tag === "public_health") set.add("medicine");
  if (tag === "poetry") set.add("literature");
  if (tag === "music") set.add("art");
  if (tag === "natural_history") set.add("science");
  if (tag === "ecology") set.add("science");
  if (tag === "church_history") set.add("church");
  if (tag === "local_legend" || tag === "ghost_story" || tag === "paranormal") set.add("folklore");
}

// --- Category tag builders ---

function buildFolkloreCategoryTags(item) {
  const tags = new Set();
  const rawCategories = Array.isArray(item && item.category)
    ? item.category
    : item && item.category
      ? [item.category]
      : [];
  rawCategories.forEach((value) => addExpandedTag(tags, value));
  if (Array.isArray(item && item.notable_people) && item.notable_people.length) addExpandedTag(tags, "celebrity_association");
  if (item && item.address && item.plaque && item.plaque.public_location) addExpandedTag(tags, "plaque");
  return Array.from(tags);
}

function buildOsmCategoryTags(properties) {
  const tags = new Set();
  [
    properties && properties.category,
    properties && properties.categoryLabel,
    properties && properties.amenity,
    properties && properties.shop,
    properties && properties.tourism,
    properties && properties.historic,
    properties && properties.railway,
  ].forEach((value) => addExpandedTag(tags, value));
  return Array.from(tags);
}

function hasPlaceTag(place, tag) {
  if (!place) return false;
  const normalized = normalizeTag(tag);
  return Array.isArray(place.categoryTags) && place.categoryTags.includes(normalized);
}

// --- Folklore classification ---

function classifyFolkloreCategory(item) {
  const blob = [
    item && item.type,
    item && item.name,
    Array.isArray(item && item.category) ? item.category.join(" ") : item && item.category,
  ].filter(Boolean).join(" ").toLowerCase();
  if (blob.includes("plaque")) return "plaque";
  if (blob.includes("legend") || blob.includes("folklore") || blob.includes("ghost") || blob.includes("haunt")) return "legend";
  return "history";
}

function classifyFolkloreTopics(item) {
  const blob = [
    item && item.type,
    item && item.name,
    item && item.folklore_summary,
    item && item.story_summary,
    item && item.story,
    item && item.historical_status,
    Array.isArray(item && item.category) ? item.category.join(" ") : item && item.category,
  ].filter(Boolean).join(" ").toLowerCase();

  const topics = [];
  if (blob.includes("blue plaque")) topics.push("blue_plaque");
  if (blob.includes("film") || blob.includes("television") || blob.includes("tv") || blob.includes("netflix") || blob.includes("filming") || blob.includes("imdb")) topics.push("film_tv");
  if (blob.includes("second world war") || blob.includes("ww2") || blob.includes("wwii") || blob.includes("wartime") || blob.includes("anti-aircraft") || blob.includes("v2") || blob.includes("pow camp") || blob.includes("bomb")) topics.push("ww2");
  if (blob.includes("royal") || blob.includes("queen victoria") || blob.includes("queen elizabeth") || blob.includes("henry viii") || blob.includes("hunting lodge") || blob.includes("forest law")) topics.push("royal");
  if (blob.includes("social history") || blob.includes("victorian history") || blob.includes("public access") || blob.includes("recreation") || blob.includes("day-tripper") || blob.includes("epping forest act")) topics.push("social_history");
  return topics;
}

// --- Display mappings ---

function filterKindEmoji(kind) {
  switch (kind) {
    case "tree": return "🌳";
    case "cow": return "🐄";
    case "waymarked_trails": return "🥾";
    case "ponds_streams": return "💧";
    case "pub":
    case "pubs": return "🍺";
    case "restaurant":
    case "restaurants": return "🍽️";
    case "cafe":
    case "cafes": return "☕";
    case "shops": return "🛒";
    case "bus": return appIconHtml("bus", "app-icon nearest-icon");
    case "underground": return '<svg width="1em" height="1em" viewBox="0 0 24 24" style="vertical-align: middle; display: inline-block;"><path fill="#C9181E" d="M12 2.25a9.73 9.73 0 0 0-9.49 7.5H0v4.5h2.51a9.73 9.73 0 0 0 9.49 7.5c4.62 0 8.48-3.2 9.49-7.5H24v-4.5h-2.51A9.73 9.73 0 0 0 12 2.25zM12 6c2.5 0 4.66 1.56 5.56 3.75H6.44A6.02 6.02 0 0 1 12 6zm-5.56 8.25h11.12A6.02 6.02 0 0 1 12 18a6.02 6.02 0 0 1-5.56-3.75Z"/></svg>';
    case "national_rail": return '<svg width="1em" height="1em" viewBox="0 0 24 24" style="vertical-align: middle; display: inline-block;"><circle cx="12" cy="12" r="12" fill="#FFFFFF"/><path fill="#C9181E" d="M0 12C0 5.373 5.372 0 12 0c6.627 0 11.999 5.373 11.999 12 0 6.628-5.372 12-11.999 12-6.628 0-12-5.372-12-12Zm6.195-5.842 6.076 2.794H2.835v1.884h9.499l-4.616 2.246H2.835v1.868h4.883l5.778 2.795h4.333l-6.092-2.795h9.469v-1.868h-9.453l4.616-2.246h4.837V8.952h-4.868l-5.777-2.794H6.195"/></svg>';
    case "parking": return "🅿️";
    case "landmark": return "📍";
    case "plaques": return "🪧";
    case "blue_plaques": return "🔵";
    case "film_tv": return "🎬";
    case "ww2": return "🪖";
    case "royal": return "👑";
    case "history_general": return "📜";
    case "social_history": return "🧺";
    case "celebrity_association": return "⭐";
    case "science": return "🔭";
    case "education": return "🎓";
    case "medicine": return "⚕️";
    case "literature": return "📚";
    case "theatre": return "🎭";
    case "politics": return "🏛️";
    case "art": return "🎨";
    case "church": return "⛪";
    case "legends": return "✨";
    default: return null;
  }
}

function iconPath(name) {
  return ICON_PATHS[name] || null;
}

function appIconHtml(name, className = "app-icon") {
  const src = iconPath(name);
  if (!src) return "";
  return `<img class="${className}" src="${src}" alt="" loading="lazy" decoding="async">`;
}

function treeSpeciesIconHtml(commonName, latinName, className = "app-icon tree-species-icon") {
  const text = `${commonName || ""} ${latinName || ""}`.toLowerCase();
  const match = TREE_SPECIES_ICON_TOKENS.find((m) => m.tokens.some((t) => text.includes(t)));
  return match ? appIconHtml(match.icon, className) : "";
}

function filterKindColor(kind) {
  switch (kind) {
    case "tree": return "rgba(47, 111, 78, 0.85)";
    case "cow": return "rgba(154, 106, 47, 0.85)";
    case "waymarked_trails": return "rgba(109, 68, 140, 0.9)";
    case "pub":
    case "pubs": return "rgba(127, 79, 159, 0.85)";
    case "cafe":
    case "cafes": return "rgba(139, 69, 19, 0.85)";
    case "shops": return "rgba(46, 125, 50, 0.85)";
    case "bus": return "rgba(255, 140, 0, 0.85)";
    case "underground": return "rgba(201, 24, 24, 0.85)";
    case "national_rail": return "rgba(0, 47, 167, 0.85)";
    case "parking": return "rgba(0, 90, 180, 0.85)";
    case "landmark": return "rgba(118, 112, 47, 0.85)";
    case "plaques": return "rgba(78, 93, 135, 0.85)";
    case "blue_plaques": return "rgba(62, 103, 196, 0.85)";
    case "film_tv": return "rgba(134, 74, 162, 0.85)";
    case "ww2": return "rgba(114, 108, 66, 0.85)";
    case "royal": return "rgba(156, 118, 41, 0.85)";
    case "history_general": return "rgba(109, 92, 58, 0.85)";
    case "social_history": return "rgba(150, 108, 74, 0.85)";
    case "celebrity_association": return "rgba(164, 127, 38, 0.85)";
    case "science": return "rgba(54, 113, 176, 0.85)";
    case "education": return "rgba(69, 109, 146, 0.85)";
    case "medicine": return "rgba(39, 135, 118, 0.85)";
    case "literature": return "rgba(122, 86, 48, 0.85)";
    case "theatre": return "rgba(155, 84, 124, 0.85)";
    case "politics": return "rgba(79, 91, 134, 0.85)";
    case "art": return "rgba(198, 108, 52, 0.85)";
    case "church": return "rgba(111, 121, 89, 0.85)";
    case "legends": return "rgba(111, 77, 140, 0.85)";
    default: return "rgba(118, 112, 47, 0.85)";
  }
}
