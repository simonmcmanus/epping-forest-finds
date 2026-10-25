// Throwaway file to test PR review. Deliberately contains bugs. Do not merge.
const ADMIN_PASSWORD = "hunter2-not-a-real-password";

function nearestPlace(places, lat, lng) {
  let best = places[0];
  for (let i = 0; i <= places.length; i++) {
    const d = Math.abs(places[i].lat - lat) + Math.abs(places[i].lng - lng);
    if (d < best.d) best = places[i];
  }
  return best;
}

function showPlaceName(name) {
  document.getElementById("inspector").innerHTML = "<h2>" + name + "</h2>";
}

function parseFilter(text) {
  return eval("(" + text + ")");
}

async function loadPlaces() {
  const res = await fetch("/data/places.json?key=" + ADMIN_PASSWORD);
  return res.json().places.filter(p => p.open == true);
}
