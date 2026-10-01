// Subject-specific artwork motion. No application state or scheduling lives here.
// Callers opt in via draw(); ordinary icons continue to use their original PNG.
const IconMotion = (() => {
  const supported = new Set([
    "bus",
    "pin",
    "walking",
    "art",
    "beer",
    "blue-plaques",
    "cafe",
    "celebrities",
    "church",
    "cow",
    "education",
    "crown",
    "film",
    "historic",
    "legends",
    "literature",
    "medicine",
    "national-rail",
    "plaques",
    "politics",
    "ponds",
    "restaurant",
    "science",
    "shop",
    "social-history",
    "theatre",
    "tree",
    "underground",
    "waymarked",
    "wwII",
    "gate",
    "landmark-archaeological",
    "landmark-bench",
    "landmark-bicycle-parking",
    "landmark-campsite",
    "landmark-drinking-water",
    "landmark-dry-cleaning",
    "landmark-information",
    "landmark-memorial",
    "landmark-monument",
    "landmark-museum",
    "landmark-parking",
    "landmark-picnic",
    "landmark-taxi",
    "landmark-telephone",
    "landmark-toilets",
    "landmark-viewpoint",
    "tree-ash",
    "tree-common-beech",
    "tree-holly",
    "tree-hornbeam",
    "tree-english-oak",
    "tree-wild-service",
    "underground-roundel",
    "national-rail-logo",
  ]);
  const cache = new Map();
  const effectBuffers = [];
  let effectIndex = 0;
  const energy = 0.55;
  function effectCanvas() {
    const c =
      effectBuffers[effectIndex] || (effectBuffers[effectIndex] = canvas());
    effectIndex += 1;
    const ctx = c.getContext("2d");
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, 256, 256);
    return c;
  }
  const PI = Math.PI;
  const phase = (t, period = 6, offset = 0) => ((t + offset) % period) / period;
  const beat = (t, period = 6, offset = 0) => {
    const p = phase(t, period, offset);
    return p < 0.55 ? Math.sin((PI * p) / 0.55) : 0;
  };
  function polygon(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }
  const rect = (x, y, w, h) => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  const circle = (x, y, r) =>
    Array.from({ length: 40 }, (_, i) => [
      x + Math.cos((i / 40) * PI * 2) * r,
      y + Math.sin((i / 40) * PI * 2) * r,
    ]);
  const doorShapes = {
    church: [
      [94, 228],
      [94, 202],
      [98, 193],
      [104, 189],
      [111, 195],
      [114, 203],
      [114, 228],
    ],
    historic: [
      [112, 190],
      [112, 153],
      [116, 142],
      [127, 136],
      [138, 142],
      [143, 153],
      [143, 190],
    ],
    "landmark-telephone": [
      [119, 79],
      [175, 81],
      [174, 215],
      [119, 222],
    ],
  };
  function canvas() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    return c;
  }
  function layer(a, pts) {
    const c = canvas(),
      x = c.getContext("2d");
    polygon(x, pts);
    x.clip();
    x.drawImage(a.image, 0, 0, 256, 256);
    return c;
  }
  function masks(a) {
    let parts = [];
    switch (a.id) {
      case "cow":
        parts = [rect(0, 112, 36, 78)];
        break;
      case "cafe":
        parts = [rect(85, 0, 38, 86), rect(123, 0, 48, 86)];
        break;
      case "walking":
        parts = [rect(0, 0, 256, 72)];
        break;
      case "tree":
        parts = [rect(0, 0, 256, 155)];
        break;
      case "education":
        parts = [rect(194, 132, 42, 90)];
        break;
      case "film":
        parts = [
          [
            [30, 76],
            [218, 25],
            [239, 78],
            [77, 113],
            [64, 127],
            [30, 127],
          ],
        ];
        break;
      case "gate":
        parts = [rect(47, 77, 165, 113)];
        break;
      case "landmark-viewpoint":
        parts = [
          [
            [38, 110],
            [197, 24],
            [231, 81],
            [146, 118],
            [82, 140],
            [38, 142],
          ],
        ];
        break;
      case "landmark-drinking-water":
        parts = [rect(158, 171, 54, 67)];
        break;
      case "restaurant":
        parts = [rect(0, 0, 59, 256), rect(201, 0, 55, 256)];
        break;
      case "literature":
        parts = [
          [
            [129, 79],
            [148, 66],
            [175, 59],
            [208, 65],
            [216, 178],
            [176, 174],
            [149, 177],
            [129, 187],
          ],
        ];
        break;
      case "science":
        parts = [circle(149, 166, 15), circle(122, 188, 10)];
        break;
      case "social-history":
        parts = [rect(0, 178, 256, 78)];
        break;
      case "landmark-memorial":
        parts = [rect(99, 97, 50, 48)];
        break;
      case "landmark-campsite":
        parts = [
          [
            [103, 83],
            [172, 84],
            [217, 188],
            [135, 188],
          ],
        ];
        break;
      case "historic":
      case "church":
      case "landmark-telephone":
        parts = [doorShapes[a.id]];
        break;
    }
    const base = canvas(),
      ctx = base.getContext("2d");
    ctx.drawImage(a.image, 0, 0, 256, 256);
    for (const pts of parts) {
      if (a.id === "science") continue;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      polygon(ctx, pts);
      ctx.fill();
      ctx.restore();
    }
    if (a.id === "science") {
      // Reconstruct only the liquid behind the two movable bubbles in this runtime layer.
      const pixels = ctx.getImageData(0, 0, 256, 256),
        original = new Uint8ClampedArray(pixels.data);
      for (const [cx, cy, r] of [
        [149, 166, 15],
        [122, 188, 10],
      ]) {
        for (let y = cy - r - 2; y <= cy + r + 2; y++)
          for (let x = cx - r - 2; x <= cx + r + 2; x++) {
            const distance = Math.hypot(x - cx, y - cy),
              mix = Math.min(1, Math.max(0, (r + 2 - distance) / 1.5));
            if (!mix) continue;
            const left = cx - r - 3,
              right = cx + r + 3,
              u = (x - left) / (right - left),
              idx = (y * 256 + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
              const value =
                original[(y * 256 + left) * 4 + channel] * (1 - u) +
                original[(y * 256 + right) * 4 + channel] * u;
              pixels.data[idx + channel] =
                original[idx + channel] * (1 - mix) + value * mix;
            }
          }
      }
      ctx.putImageData(pixels, 0, 0);
    }
    let wheelBase = null,
      wheelFrame = null;
    if (a.id === "landmark-bicycle-parking") {
      wheelBase = canvas();
      const wc = wheelBase.getContext("2d");
      wc.drawImage(a.image, 0, 0, 256, 256);
      wc.globalCompositeOperation = "destination-out";
      for (const x of [56, 201]) {
        wc.beginPath();
        wc.arc(x, 156, 38, 0, PI * 2);
        wc.fill();
      }
      wheelFrame = canvas();
      const fc = wheelFrame.getContext("2d");
      fc.strokeStyle = "#000";
      fc.lineWidth = 11;
      fc.lineCap = "round";
      for (const points of [
        [
          [56, 156],
          [94, 104],
        ],
        [
          [56, 156],
          [118, 165],
        ],
        [
          [201, 156],
          [175, 104],
        ],
      ]) {
        fc.beginPath();
        fc.moveTo(...points[0]);
        fc.lineTo(...points[1]);
        fc.stroke();
      }
      for (const x of [56, 201]) {
        fc.beginPath();
        fc.arc(x, 156, 5, 0, PI * 2);
        fc.fill();
      }
      fc.globalCompositeOperation = "source-in";
      fc.drawImage(a.image, 0, 0, 256, 256);
    }
    return {
      base,
      parts: parts.map((p) => layer(a, p)),
      wheelBase,
      wheelFrame,
    };
  }
  function part(
    ctx,
    img,
    x,
    y,
    angle = 0,
    sx = 1,
    sy = 1,
    dx = 0,
    dy = 0,
    alpha = 1,
  ) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + dx, y + dy);
    ctx.rotate(angle);
    ctx.scale(sx, sy);
    ctx.drawImage(img, -x, -y);
    ctx.restore();
  }
  function sparkle(ctx, x, y, v) {
    if (v <= 0) return;
    ctx.save();
    ctx.globalAlpha = v * 0.8;
    ctx.strokeStyle = "#284830";
    ctx.lineWidth = 1.8;
    const r = 2 + 4 * v;
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.stroke();
    ctx.restore();
  }
  function gleam(ctx, a, t, area, alpha = 0.35) {
    const p = phase(t, 6);
    if (p > 0.55) return;
    const temp = effectCanvas(),
      x = temp.getContext("2d");
    x.drawImage(a.image, 0, 0, 256, 256);
    x.globalCompositeOperation = "source-in";
    const pos = -70 + (p / 0.55) * 400,
      g = x.createLinearGradient(pos - 25, 0, pos + 25, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
    ctx.save();
    if (area) {
      polygon(ctx, area);
      ctx.clip();
    }
    ctx.globalAlpha = alpha * energy;
    ctx.drawImage(temp, 0, 0);
    ctx.restore();
  }
  function glow(ctx, a, x, y, r, value) {
    if (value <= 0) return;
    const c = effectCanvas(),
      k = c.getContext("2d");
    k.drawImage(a.image, 0, 0, 256, 256);
    k.globalCompositeOperation = "source-in";
    const g = k.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,229,146,.9)");
    g.addColorStop(1, "rgba(255,229,146,0)");
    k.fillStyle = g;
    k.fillRect(0, 0, 256, 256);
    ctx.save();
    ctx.globalAlpha = value * energy;
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }
  function bubbles(ctx, t, science = false) {
    for (let i = 0; i < 4; i++) {
      const p = phase(t, 3.3, i * 0.83);
      const x = (science ? 109 : 108) + i * 12 + Math.sin(p * PI * 3 + i) * 2,
        y = (science ? 207 : 207) - p * (science ? 34 : 130);
      ctx.save();
      ctx.globalAlpha = Math.sin(PI * p) * 0.48;
      ctx.strokeStyle = "rgba(255,244,205,.9)";
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.arc(x, y, (i % 2 ? 2.1 : 3) * energy, 0, PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  function openingDoor(ctx, a, t) {
    const points = doorShapes[a.id],
      hinge = points[0][0],
      p = phase(t, 5.5);
    const ease = (x) => x * x * (3 - 2 * x);
    const open =
      p < 0.12
        ? 0
        : p < 0.35
          ? ease((p - 0.12) / 0.23)
          : p < 0.62
            ? 1
            : p < 0.85
              ? 1 - ease((p - 0.62) / 0.23)
              : 0;
    ctx.save();
    polygon(ctx, points);
    ctx.fillStyle = "#243a2d";
    ctx.fill();
    ctx.restore();
    part(
      ctx,
      a.layers.parts[0],
      hinge,
      points[0][1],
      0,
      1 - open * (0.68 + 0.17 * energy),
      1,
    );
  }
  function turnPage(ctx, a, t) {
    ctx.drawImage(a.image, 0, 0, 256, 256);
    const p = phase(t, 5.1);
    if (p < 0.1 || p > 0.96) return;
    const u = Math.min(1, (p - 0.1) / 0.54),
      angle = PI * (u * u * (3 - 2 * u)),
      projection = Math.cos(angle),
      lift = Math.sin(angle);
    ctx.save();
    ctx.globalAlpha = p > 0.8 ? (1 - p) / 0.2 : 1;
    for (let x = 129; x < 217; x += 2) {
      const fraction = (x - 129) / 88,
        dx = 129 + (x - 129) * projection,
        dy = -lift * (9 * Math.sin(fraction * PI) + 5 * fraction);
      ctx.save();
      ctx.translate(dx, dy);
      ctx.scale(projection, 1);
      ctx.drawImage(a.layers.parts[0], x, 0, 2, 256, 0, 0, 2, 256);
      ctx.restore();
    }
    if (Math.abs(projection) < 0.08) {
      ctx.strokeStyle = "#c0a068";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(129, 69);
      ctx.lineTo(129, 180);
      ctx.stroke();
    }
    ctx.restore();
  }

  function wheelAngle(t) {
    const p = Math.min(1, phase(t, 5.7) / 0.9),
      u = p * p * (3 - 2 * p);
    return u * PI * 4;
  }
  function spinWheels(ctx, a, t) {
    const angle = wheelAngle(t),
      bike = a.id === "landmark-bicycle-parking";
    const tyreMarks = a.id === "bus" || a.id === "landmark-taxi";
    const centers = bike
      ? [
          [56, 156],
          [201, 156],
        ]
      : a.id === "bus"
        ? [
            [64, 183],
            [199, 183],
          ]
        : a.id === "landmark-taxi"
          ? [
              [58, 165],
              [202, 165],
            ]
          : [
              [65, 163],
              [192, 163],
            ];
    if (bike) {
      ctx.clearRect(0, 0, 256, 256);
      ctx.drawImage(a.layers.wheelBase, 0, 0);
    }
    for (const [x, y] of centers) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.strokeStyle = bike
        ? "#466545"
        : a.id === "landmark-parking"
          ? "#466545"
          : "#f3e6bb";
      ctx.lineWidth = bike ? 1.5 : 3.3;
      ctx.lineCap = "round";
      if (tyreMarks) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2.8;
        for (const start of [-0.6, 2.25]) {
          ctx.beginPath();
          ctx.arc(0, 0, 16, start, start + 0.19);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }
      for (let i = 0; i < (bike ? 16 : 3); i++) {
        const theta = (i * PI * 2) / (bike ? 16 : 3);
        ctx.beginPath();
        ctx.moveTo(
          Math.cos(theta) * (bike ? 5 : 2),
          Math.sin(theta) * (bike ? 5 : 2),
        );
        ctx.lineTo(
          Math.cos(theta) * (bike ? 38 : 11.5),
          Math.sin(theta) * (bike ? 38 : 11.5),
        );
        ctx.stroke();
      }
      if (!bike) {
        ctx.strokeStyle = "#9aaa7a";
        ctx.lineWidth = 2.7;
        ctx.beginPath();
        ctx.arc(0, 0, 16, -0.8, -0.2);
        ctx.stroke();
        ctx.fillStyle = a.id === "landmark-parking" ? "#466545" : "#f3e6bb";
        ctx.beginPath();
        ctx.arc(0, 0, 2.6, 0, PI * 2);
        ctx.fill();
      }
      if (bike) {
        ctx.fillStyle = "#e6cf95";
        ctx.beginPath();
        ctx.arc(0, -34, 2, 0, PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (bike) ctx.drawImage(a.layers.wheelFrame, 0, 0);
    if (tyreMarks) {
      const p = phase(t, 5.7);
      if (p < 0.9) {
        for (let i = 0; i < 4; i++) {
          const age = phase(t, 1.3, i * 0.29),
            x = centers[0][0] - 19 - age * 19,
            y = centers[0][1] + 15 - age * 12;
          ctx.save();
          ctx.globalAlpha = Math.sin(age * PI) * 0.22;
          ctx.fillStyle = "#b9aa87";
          ctx.beginPath();
          ctx.ellipse(x, y, 2 + age * 5, 1.5 + age * 3, 0, 0, PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }
  function pullHandle(ctx, a, t) {
    const p = phase(t, 4.4),
      pull =
        p < 0.15
          ? 0
          : p < 0.28
            ? (p - 0.15) / 0.13
            : p < 0.4
              ? 1
              : p < 0.58
                ? 1 - (p - 0.4) / 0.18
                : 0;
    // The source handle sits on the front of the cistern, immediately below its lid.
    ctx.save();
    ctx.fillStyle = "#f3edcd";
    ctx.beginPath();
    ctx.ellipse(89, 61, 11, 6, 0, 0, PI * 2);
    ctx.fill();
    ctx.translate(95, 60);
    ctx.rotate(-pull * 0.48);
    ctx.fillStyle = "#f8f0d0";
    ctx.strokeStyle = "#284830";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(-15, -2.5, 15, 5, 2.5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  function fishJump(ctx, t) {
    const p = phase(t, 6.2),
      start = 0.12,
      end = 0.53;
    if (p >= start && p <= end) {
      const u = (p - start) / (end - start),
        x = 110 + 42 * u,
        y = 168 + 5 * u - Math.sin(PI * u) * 18,
        angle = Math.atan2(5 - 18 * PI * Math.cos(PI * u), 42);
      ctx.save();
      ctx.globalAlpha = Math.min(1, u * 12, (1 - u) * 12);
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = "#cfa35e";
      ctx.strokeStyle = "#284830";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(-13, -5);
      ctx.lineTo(-12, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, 8.5, 4.6, 0, 0, PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#284830";
      ctx.beginPath();
      ctx.arc(4, -1.2, 1.1, 0, PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (const [when, x, y] of [
      [start, 110, 168],
      [end, 152, 173],
    ]) {
      const age = (p - when) / 0.14;
      if (age < 0 || age > 1) continue;
      ctx.save();
      ctx.globalAlpha = (1 - age) * 0.75;
      ctx.strokeStyle = "#d3edf0";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + age * 8, 1 + age * 2, 0, 0, PI * 2);
      ctx.stroke();
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * (2 + age * 4), y - 1 - Math.sin(age * PI) * 3);
        ctx.lineTo(x + i * (3 + age * 4), y - 2 - Math.sin(age * PI) * 3);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  function draw(ctx, a, t, active = true) {
    ctx.clearRect(0, 0, 256, 256);
    if (!active || !a.layers) {
      ctx.drawImage(a.image, 0, 0, 256, 256);
      return;
    }
    const id = a.id,
      L = a.layers,
      b = beat(t),
      e = energy;
    ctx.drawImage(L.parts.length ? L.base : a.image, 0, 0, 256, 256);
    if (id.startsWith("tree-")) {
      ctx.clearRect(0, 0, 256, 256);
      const factor =
        id === "tree-holly" ? 0.4 : id === "tree-hornbeam" ? 1.2 : 1;
      part(
        ctx,
        a.image,
        130,
        225,
        Math.sin(t * 2.1) * 0.09 * b * factor * e,
        1 - 0.025 * b * e,
        1,
      );
      return;
    }
    switch (id) {
      case "fallback":
        break;
      case "cow": {
        const p = phase(t, 6.8),
          v =
            p > 0.18 && p < 0.53
              ? Math.sin(((p - 0.18) / 0.35) * PI * 5) *
                Math.sin(((p - 0.18) / 0.35) * PI)
              : 0;
        part(ctx, L.parts[0], 30, 114, v * 0.29 * e);
        break;
      }
      case "cafe":
        L.parts.forEach((im, i) =>
          part(
            ctx,
            im,
            110 + i * 26,
            82,
            Math.sin(t * 1.8 + i) * 0.08 * e,
            1,
            1,
            Math.sin(t * 1.4 + i) * 2 * e,
            -(1 + Math.sin(t * 1.1 + i)) * 2 * e,
            0.78 + 0.2 * Math.sin(t + i),
          ),
        );
        break;
      case "walking":
        part(
          ctx,
          L.parts[0],
          139,
          73,
          b * 0.13 * e,
          1,
          1,
          b * 1.4 * e,
          -b * 0.7 * e,
        );
        break;
      case "tree":
        part(ctx, L.parts[0], 129, 155, Math.sin(t * 2) * 0.024 * b * e);
        break;
      case "education":
        part(ctx, L.parts[0], 207, 136, Math.sin(t * 3) * 0.2 * b * e);
        break;
      case "film": {
        const p = phase(t, 6.5),
          q =
            p < 0.15
              ? 0
              : p < 0.24
                ? (p - 0.15) / 0.09
                : p < 0.38
                  ? 1
                  : p < 0.65
                    ? 1 - (p - 0.38) / 0.27
                    : 0;
        part(ctx, L.parts[0], 55, 107, q * 0.28 * e);
        break;
      }
      case "gate":
        part(ctx, L.parts[0], 47, 155, 0, 1 - 0.24 * b * e, 1);
        break;
      case "historic":
      case "church":
      case "landmark-telephone":
        openingDoor(ctx, a, t);
        break;
      case "landmark-viewpoint":
        part(ctx, L.parts[0], 116, 111, -0.13 * b * e);
        break;
      case "landmark-drinking-water": {
        const p = phase(t, 1.2),
          growth = p < 0.38 ? 0.35 + (p / 0.38) * 0.65 : 1,
          fall = Math.max(0, (p - 0.38) / 0.48);
        part(
          ctx,
          L.parts[0],
          184,
          175,
          0,
          growth,
          growth,
          0,
          -4 + fall * fall * 34,
          p < 0.73 ? 1 : Math.max(0, 1 - (p - 0.73) / 0.15),
        );
        break;
      }
      case "restaurant":
        part(ctx, L.parts[0], 35, 214, 0.045 * b * e);
        part(ctx, L.parts[1], 222, 214, -0.055 * b * e);
        break;
      case "literature":
        turnPage(ctx, a, t);
        break;
      case "social-history":
        part(ctx, L.parts[0], 128, 178, 0, 1, 1 + 0.06 * b * e, 0, 0);
        break;
      case "landmark-memorial":
        part(ctx, L.parts[0], 124, 122, Math.sin(t * 1.8) * 0.05 * b * e);
        break;
      case "landmark-campsite":
        part(
          ctx,
          L.parts[0],
          105,
          84,
          Math.sin(t * 2) * 0.015 * b * e,
          1 + 0.025 * Math.sin(t * 2) * b * e,
          1,
        );
        break;
      case "landmark-dry-cleaning":
        ctx.clearRect(0, 0, 256, 256);
        part(ctx, a.image, 127, 35, Math.sin(t * 1.7) * 0.04 * b * e);
        break;
      case "beer":
        bubbles(ctx, t);
        break;
      case "science":
        L.parts.forEach((im, i) => {
          const p = phase(t, i ? 2.3 : 1.9, i * 0.7),
            x = (i ? 112 : 151) + Math.sin(p * PI * 2 + i) * 4,
            y = 207 - p * (i ? 49 : 58),
            scale = 0.38 + p * 0.42;
          part(
            ctx,
            im,
            i ? 122 : 149,
            i ? 188 : 166,
            0,
            scale,
            scale,
            x - (i ? 122 : 149),
            y - (i ? 188 : 166),
            Math.min(1, p * 7, (1 - p) * 7),
          );
        });
        break;
      case "ponds":
        gleam(
          ctx,
          a,
          t,
          [
            [55, 143],
            [158, 136],
            [192, 165],
            [215, 179],
            [191, 208],
            [63, 192],
          ],
          0.45,
        );
        fishJump(ctx, t);
        break;
      case "shop":
        ctx.clearRect(0, 0, 256, 256);
        part(ctx, a.image, 128, 128, 0, 1, 1, Math.sin(t * 1.8) * 6 * b * e, 0);
        break;
      case "bus":
      case "landmark-parking":
      case "landmark-taxi":
      case "landmark-bicycle-parking":
        spinWheels(ctx, a, t);
        break;
      case "art":
        [
          [88, 94],
          [144, 70],
          [199, 98],
        ].forEach(([x, y], i) =>
          glow(ctx, a, x, y, 19, beat(t, 6, i * 0.65) * 0.55),
        );
        break;
      case "crown":
        [
          [69, 187],
          [119, 196],
          [167, 192],
          [195, 180],
        ].forEach(([x, y], i) => sparkle(ctx, x, y, beat(t, 6, i * 0.8) * 0.7));
        break;
      case "celebrities":
        sparkle(ctx, 130, 35, beat(t, 6));
        sparkle(ctx, 210, 99, beat(t, 6, 2.2) * 0.65);
        break;
      case "legends":
        gleam(ctx, a, t, rect(50, 45, 158, 166), 0.4);
        sparkle(ctx, 178, 65, b * 0.7);
        break;
      case "politics": {
        ctx.save();
        ctx.translate(127, 132);
        ctx.fillStyle = "#f8f0d0";
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#284830";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        const angle = t * 2.8;
        ctx.save();
        ctx.rotate(angle / 12 + 0.75);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -8);
        ctx.stroke();
        ctx.restore();
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -13);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case "theatre": {
        ctx.clearRect(0, 0, 256, 256);
        ctx.save();
        polygon(ctx, rect(0, 0, 134, 256));
        ctx.clip();
        part(ctx, a.image, 95, 98, 0.03 * b * e);
        ctx.restore();
        ctx.save();
        polygon(ctx, rect(134, 0, 122, 256));
        ctx.clip();
        part(ctx, a.image, 174, 106, -0.025 * b * e);
        ctx.restore();
        break;
      }
      case "medicine":
        gleam(ctx, a, t, null, 0.16);
        break;
      case "landmark-museum":
        glow(ctx, a, 127, 159, 24, b * 0.5);
        break;
      case "landmark-toilets":
        pullHandle(ctx, a, t);
        break;
      case "landmark-bench":
        gleam(ctx, a, t, rect(42, 147, 168, 38), 0.38);
        break;
      case "landmark-picnic":
        gleam(ctx, a, t, rect(44, 65, 171, 70), 0.38);
        break;
      case "landmark-information":
        gleam(ctx, a, t, rect(123, 93, 79, 43), 0.45);
        break;
      case "waymarked":
        gleam(ctx, a, t, rect(41, 71, 176, 94), 0.65);
        break;
      default:
        gleam(
          ctx,
          a,
          t,
          null,
          id === "wwII" || id === "landmark-monument" ? 0.18 : 0.35,
        );
    }
  }

  return Object.freeze({
    has: (slug) => supported.has(slug),
    // elapsed is seconds since activation; size is artwork width, excluding its pin.
    // The same method can later serve other canvases without knowing about navigation.
    draw(ctx, image, slug, x, y, size, elapsed) {
      if (
        !supported.has(slug) ||
        !image ||
        !(image.naturalWidth || image.width) ||
        !Number.isFinite(elapsed)
      )
        return false;
      let entry = cache.get(image);
      if (!entry || entry.id !== slug) {
        entry = { id: slug, image, frame: canvas() };
        entry.layers = masks(entry);
        cache.set(image, entry);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
      }
      const frame = Math.floor(Math.max(0, elapsed) * 15);
      if (entry.lastFrame !== frame) {
        effectIndex = 0;
        draw(entry.frame.getContext("2d"), entry, Math.max(0, elapsed));
        entry.lastFrame = frame;
      }
      ctx.drawImage(entry.frame, x, y, size, size);
      return true;
    },
    clear() {
      cache.clear();
      effectBuffers.length = 0;
    },
  });
})();
