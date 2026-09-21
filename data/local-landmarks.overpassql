[out:json][timeout:90];
(
  nwr["amenity"~"^(pub|bar)$"](51.545,-0.035,51.745,0.145);
  nwr["amenity"~"^(cafe|tea)$"](51.545,-0.035,51.745,0.145);
  nwr["amenity"="restaurant"]["name"](51.545,-0.035,51.745,0.145);
  nwr["shop"~"^(convenience|supermarket|grocery|general|greengrocer|butcher|bakery|deli|farm|pastry|confectionery)$"]["name"](51.545,-0.035,51.745,0.145);
  nwr["amenity"~"^(parking|toilets|bicycle_parking|bench|drinking_water)$"](51.545,-0.035,51.745,0.145);
  nwr["tourism"~"^(picnic_site|camp_site|caravan_site|information)$"](51.545,-0.035,51.745,0.145);
  nwr["barrier"~"^(gate|stile|kissing_gate|cattle_grid|lift_gate|swing_gate|cycle_barrier)$"](51.545,-0.035,51.745,0.145);
  nwr["entrance"~"^(main|yes)$"](51.545,-0.035,51.745,0.145);
  nwr["amenity"~"^(bus_station|taxi|train_station)$"](51.545,-0.035,51.745,0.145);
  // The places a town actually uses that are not food -- the village hall, the
  // library, the arts centre. Left out until Sep 2026, which is why Loughton's
  // own Lopping Hall was never on the map. scripts/osm_business_diff.py watches
  // the same set, so a regeneration and a weekly change agree on what is in scope.
  nwr["amenity"~"^(community_centre|public_hall|arts_centre|theatre|cinema|townhall|library|social_centre)$"]["name"](51.545,-0.035,51.745,0.145);
  nwr["highway"="bus_stop"](51.545,-0.035,51.745,0.145);
  nwr["railway"~"^(station|halt|tram_stop)$"](51.545,-0.035,51.745,0.145);
  nwr["tourism"~"^(attraction|viewpoint|museum|picnic_site)$"]["name"](51.545,-0.035,51.745,0.145);
  nwr["historic"](51.545,-0.035,51.745,0.145);
  nwr["heritage"](51.545,-0.035,51.745,0.145);
);
out center tags;
