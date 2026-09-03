[out:json][timeout:90];
(
  way["highway"~"^(path|footway|bridleway|cycleway|track|byway)$"](51.545,-0.035,51.745,0.145);
  way["designation"~"bridleway|Bridleway|public bridleway|Public bridleway|public footpath|Public Footpath|byway|Byway|restricted byway|Restricted Byway"](51.545,-0.035,51.745,0.145);
  way["foot"="permissive"](51.545,-0.035,51.745,0.145);
  way["horse"="permissive"](51.545,-0.035,51.745,0.145);
  way["access"="permissive"](51.545,-0.035,51.745,0.145);
  way["osmc:symbol"](51.545,-0.035,51.745,0.145);
);
out geom tags;
