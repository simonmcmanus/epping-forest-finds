[out:json][timeout:90];
(
  way["waterway"~"^(river|stream|ditch|drain|canal)$"](51.545,-0.035,51.745,0.145);
  way["natural"~"^(water|wetland)$"](51.545,-0.035,51.745,0.145);
  way["water"](51.545,-0.035,51.745,0.145);
  way["landuse"="reservoir"](51.545,-0.035,51.745,0.145);
  way["leisure"="nature_reserve"](51.545,-0.035,51.745,0.145);
  way["leisure"="garden"](51.545,-0.035,51.745,0.145);
  way["leisure"="park"](51.545,-0.035,51.745,0.145);
  way["leisure"="common"](51.545,-0.035,51.745,0.145);
  way["natural"~"^(grassland|heath|scrub)$"](51.545,-0.035,51.745,0.145);
  way["landuse"~"^(meadow|recreation_ground)$"](51.545,-0.035,51.745,0.145);
  way["boundary"="protected_area"](51.545,-0.035,51.745,0.145);
  way["designation"~"SSSI|Site of Special Scientific Interest|Local Nature Reserve|nature reserve|Ancient Woodland"](51.545,-0.035,51.745,0.145);
  way["building"](51.610,0.000,51.710,0.090);
  way["railway"~"^(rail|light_rail|subway|tram)$"](51.545,-0.035,51.745,0.145);
  // Named informal open-ground points with no mapped boundary of their own (e.g. a forest
  // "plain" like Deershelter Plain) -- place=locality is OSM's tag for exactly this: a known,
  // named place with nothing to draw a polygon around.
  node["place"="locality"]["name"](51.545,-0.035,51.745,0.145);
);
out geom tags;
