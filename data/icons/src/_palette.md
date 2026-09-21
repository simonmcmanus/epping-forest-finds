Map icon house palette, sampled from the existing set (see spec/spec-icons.md).

  #284830  outline / engraving   deep forest
  #f8f0d0  paper / light fill    cream
  #80a068  secondary fill        sage
  #5f8a55  shaded sage
  #c0a068  wood / bronze         warm tan
  #c0c0b0  stone
  #3e67c4  heritage blue         (matches filterKindColor("blue_plaques"))
  #b23a2e  poppy red / K6 red

Every drawing sits inside a circle of radius 128 centred on (128,128) of the
256x256 viewBox. scripts/generate-map-icons.js enforces it: the renderer draws
the artwork at 1.75x the pin head's radius, so anything beyond r=134 would
poke out of the white pointer.
