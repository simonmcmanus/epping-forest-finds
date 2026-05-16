[out:json][timeout:60];
(
  nwr["amenity"~"^(pub|bar)$"](51.595,-0.035,51.745,0.145);
  nwr["amenity"~"^(cafe|tea)$"](51.595,-0.035,51.745,0.145);
  nwr["amenity"="restaurant"]["name"](51.595,-0.035,51.745,0.145);
  nwr["amenity"~"^(bus_station|taxi|train_station)$"](51.595,-0.035,51.745,0.145);
  nwr["highway"="bus_stop"](51.595,-0.035,51.745,0.145);
  nwr["railway"~"^(station|halt|tram_stop)$"](51.595,-0.035,51.745,0.145);
  nwr["tourism"~"^(attraction|viewpoint|museum|picnic_site)$"]["name"](51.595,-0.035,51.745,0.145);
  nwr["historic"]["name"](51.595,-0.035,51.745,0.145);
);
out center tags;
