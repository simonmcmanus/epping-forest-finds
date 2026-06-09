// Filter group definitions and all category/tag classification logic.
// No DOM or state dependencies — safe to load before the main script.

const FILTER_GROUPS = [
  {
    key: "nature",
    label: "Nature",
    icon: "nature",
    subfilters: [
      { key: "trees", label: "Trees", icon: "tree", title: "trees" },
      { key: "cows", label: "Cows", icon: "cow", title: "cows" },
      { key: "waymarked_trails", label: "Waymarked trails", icon: "waymarked", title: "waymarked trails" },
      { key: "ponds_streams", label: "Ponds & streams", icon: "ponds", title: "ponds and streams" },
    ],
  },
  {
    key: "food",
    label: "Food",
    icon: "food",
    subfilters: [
      { key: "pubs", label: "Pubs & bars", icon: "beer", title: "pubs and bars" },
      { key: "restaurants", label: "Restaurants", icon: "restaurant", title: "restaurants" },
      { key: "cafes", label: "Cafés", icon: "cafe", title: "cafés" },
      { key: "shops", label: "Shops", icon: "shop", title: "shops" },
    ],
  },
  {
    key: "transport",
    label: "Transport",
    icon: "bus",
    subfilters: [
      { key: "bus", label: "Bus stops", icon: "bus", title: "bus stops" },
      { key: "underground", label: "Underground", icon: "underground", title: "Underground stations" },
      { key: "national_rail", label: "National Rail", icon: "national-rail", title: "National Rail / overground stations" },
      { key: "parking", label: "Car parks", icon: "landmark-parking", title: "car parks" },
    ],
  },
  {
    key: "history",
    label: "History",
    icon: "history",
    subfilters: [
      { key: "history_general", label: "Historic places", icon: "historic", title: "historic places" },
      { key: "royal", label: "Royal", icon: "crown", title: "royal-history places" },
      { key: "ww2", label: "WWII", icon: "wwII", title: "WWII places" },
      { key: "social_history", label: "Social history", icon: "social-history", title: "social history places" },
      { key: "plaques", label: "Plaques", icon: "plaques", title: "plaques" },
      { key: "blue_plaques", label: "Blue plaques", icon: "blue-plaques", title: "blue plaques" },
    ],
  },
  {
    key: "locations",
    label: "Locations",
    icon: "pin",
    subfilters: [
      { key: "celebrity_association", label: "Celebrity", icon: "celebrities", title: "celebrity links" },
      { key: "science", label: "Science", icon: "science", title: "science places" },
      { key: "education", label: "Education", icon: "education", title: "education places" },
      { key: "medicine", label: "Medicine", icon: "medicine", title: "medicine places" },
      { key: "literature", label: "Literature", icon: "literature", title: "literary places" },
      { key: "theatre", label: "Theatre", icon: "theatre", title: "theatre places" },
      { key: "politics", label: "Politics", icon: "politics", title: "politics places" },
      { key: "art", label: "Art", icon: "art", title: "art places" },
      { key: "church", label: "Church", icon: "church", title: "churches" },
    ],
  },
  {
    key: "stories",
    label: "Stories",
    icon: "stories",
    subfilters: [
      { key: "legends", label: "Legends", icon: "legends", title: "legends" },
      { key: "film_tv", label: "Film/TV", icon: "film", title: "film and TV locations" },
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
  pin: "data/icons/pin.png",
  settings: "data/icons/settings.png",
  tick: "data/icons/tick.png",
  walking: "data/icons/walking.png",

  // Place types
  art: "data/icons/art.png",
  beer: "data/icons/beer.png",
  "blue-plaques": "data/icons/blue-plaques.png",
  cafe: "data/icons/cafe.png",
  campsite: "data/icons/campsite.png",
  celebrities: "data/icons/celebreties.png",
  church: "data/icons/church.png",
  cow: "data/icons/cow.png",
  education: "data/icons/education.png",
  crown: "data/icons/crown.png",
  film: "data/icons/film.png",
  food: "data/icons/food.png",
  historic: "data/icons/historic.png",
  history: "data/icons/history.png",
  legends: "data/icons/legends.png",
  literature: "data/icons/literature.png",
  medicine: "data/icons/medicine.png",
  "national-rail": "data/icons/national-rail.png",
  nature: "data/icons/nature.png",
  plaques: "data/icons/plaques.png",
  politics: "data/icons/politics.png",
  ponds: "data/icons/ponds.png",
  restaurant: "data/icons/restaurant.png",
  science: "data/icons/science.png",
  shop: "data/icons/shop.png",
  "social-history": "data/icons/social-history.png",
  stories: "data/icons/stories.png",
  theatre: "data/icons/theatre.png",
  tree: "data/icons/tree.png",
  underground: "data/icons/underground.png",
  waymarked: "data/icons/waymarked.png",
  wwII: "data/icons/wwII.png",

  // Landmarks
  gate: "data/icons/gate.png",
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
  logo: "data/icons/trees/logo.png",
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
    case "tree":
    case "trees": return appIconHtml("tree");
    case "cow":
    case "cows": return appIconHtml("cow");
    case "waymarked_trails": return appIconHtml("waymarked");
    case "ponds_streams": return appIconHtml("ponds");
    case "pub":
    case "pubs": return appIconHtml("beer");
    case "restaurant":
    case "restaurants": return appIconHtml("restaurant");
    case "cafe":
    case "cafes": return appIconHtml("cafe");
    case "shops": return appIconHtml("shop");
    case "bus": return appIconHtml("bus");
    case "underground": return appIconHtml("underground");
    case "national_rail": return appIconHtml("national-rail");
    case "parking": return appIconHtml("landmark-parking");
    case "landmark": return "📍";
    case "plaques": return appIconHtml("plaques");
    case "blue_plaques": return appIconHtml("blue-plaques");
    case "film_tv": return appIconHtml("film");
    case "ww2": return appIconHtml("wwII");
    case "royal": return appIconHtml("crown");
    case "history_general": return appIconHtml("historic");
    case "social_history": return appIconHtml("social-history");
    case "celebrity_association": return appIconHtml("celebrities");
    case "science": return appIconHtml("science");
    case "education": return appIconHtml("education");
    case "medicine": return appIconHtml("medicine");
    case "literature": return appIconHtml("literature");
    case "theatre": return appIconHtml("theatre");
    case "politics": return appIconHtml("politics");
    case "art": return appIconHtml("art");
    case "church": return appIconHtml("church");
    case "legends": return appIconHtml("legends");
    default: return null;
  }
}

function iconPath(name) {
  return ICON_PATHS[name] || null;
}

function filterKindIconSlug(kind) {
  switch (kind) {
    case "tree":
    case "trees": return "tree";
    case "cow":
    case "cows": return "cow";
    case "waymarked_trails": return "waymarked";
    case "ponds_streams": return "ponds";
    case "pub":
    case "pubs": return "beer";
    case "restaurant":
    case "restaurants": return "restaurant";
    case "cafe":
    case "cafes": return "cafe";
    case "shops": return "shop";
    case "bus": return "bus";
    case "underground": return "underground";
    case "national_rail": return "national-rail";
    case "parking": return "landmark-parking";
    case "plaques": return "plaques";
    case "blue_plaques": return "blue-plaques";
    case "film_tv": return "film";
    case "ww2": return "wwII";
    case "royal": return "crown";
    case "history_general": return "historic";
    case "social_history": return "social-history";
    case "celebrity_association": return "celebrities";
    case "science": return "science";
    case "education": return "education";
    case "medicine": return "medicine";
    case "literature": return "literature";
    case "theatre": return "theatre";
    case "politics": return "politics";
    case "art": return "art";
    case "church": return "church";
    case "legends": return "legends";
    default: return null;
  }
}

function landmarkIconSlug(place) {
  const check = (tags) => tags.some((t) => hasPlaceTag(place, t));
  if (check(["gate", "entrance", "stile", "kissing_gate"])) return "gate";
  if (check(["bench"])) return "landmark-bench";
  if (check(["toilets"])) return "landmark-toilets";
  if (check(["drinking_water", "water_well"])) return "landmark-drinking-water";
  if (check(["information"])) return "landmark-information";
  if (check(["monument", "boundary_stone"])) return "landmark-monument";
  if (check(["archaeological_site", "roman_road", "ruins"])) return "landmark-archaeological";
  if (check(["museum", "attraction", "building", "folly", "tomb", "gate_pier"])) return "landmark-museum";
  if (check(["camp_site", "caravan_site"])) return "landmark-campsite";
  if (check(["dry_cleaning"])) return "landmark-dry-cleaning";
  if (check(["taxi"])) return "landmark-taxi";
  return null;
}

function appIconHtml(name, className = "app-icon") {
  const src = iconPath(name);
  if (!src) return "";
  return `<img class="${className}" src="${src}" alt="" loading="eager" decoding="sync">`;
}

function treeSpeciesIconPath(commonName, latinName) {
  const text = `${commonName || ""} ${latinName || ""}`.toLowerCase();
  const match = TREE_SPECIES_ICON_TOKENS.find((m) => m.tokens.some((t) => text.includes(t)));
  return match ? iconPath(match.icon) : null;
}

function treeSpeciesIconHtml(commonName, latinName, className = "app-icon tree-species-icon") {
  const src = treeSpeciesIconPath(commonName, latinName);
  return src ? `<img class="${className}" src="${src}" alt="" loading="eager" decoding="sync">` : "";
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
