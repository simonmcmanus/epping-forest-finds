[out:json][timeout:90];
(
  way["waterway"~"^(river|stream|ditch|drain|canal)$"](51.545,-0.035,51.745,0.145);
  way["natural"~"^(water|wetland)$"](51.545,-0.035,51.745,0.145);
  way["water"](51.545,-0.035,51.745,0.145);
  way["landuse"="reservoir"](51.545,-0.035,51.745,0.145);
  way["leisure"="nature_reserve"](51.545,-0.035,51.745,0.145);
  way["leisure"="garden"](51.545,-0.035,51.745,0.145);
  way["leisure"="park"](51.545,-0.035,51.745,0.145);
  way["boundary"="protected_area"](51.545,-0.035,51.745,0.145);
  way["designation"~"SSSI|Site of Special Scientific Interest|Local Nature Reserve|nature reserve|Ancient Woodland"](51.545,-0.035,51.745,0.145);
  way["building"](51.610,0.000,51.710,0.090);
  way["railway"~"^(rail|light_rail|subway|tram)$"](51.545,-0.035,51.745,0.145);
);
out geom tags;
