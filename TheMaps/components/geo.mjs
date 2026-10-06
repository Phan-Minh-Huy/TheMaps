export function validPlace(place) {
  return (
    place &&
    typeof place.name === "string" &&
    Array.isArray(place.coordinates) &&
    place.coordinates.length === 2 &&
    place.coordinates.every(Number.isFinite) &&
    Math.abs(place.coordinates[0]) <= 180 &&
    Math.abs(place.coordinates[1]) <= 90
  );
}

export function samePlace(a, b) {
  return (
    a &&
    b &&
    a.coordinates.every(
      (number, index) => Math.abs(number - b.coordinates[index]) < 0.00001,
    )
  );
}

export function coordinatesText(coordinates) {
  const [longitude, latitude] = coordinates;

  return (
    `${Math.abs(latitude).toFixed(5)}° ` +
    `${latitude >= 0 ? "N" : "S"} · ` +
    `${Math.abs(longitude).toFixed(5)}° ` +
    `${longitude >= 0 ? "E" : "W"}`
  );
}

export function distanceMeters(a, b) {
  const radians = (number) => (number * Math.PI) / 180;

  const latitude = radians(b[1] - a[1]);
  const longitude = radians(b[0] - a[0]);

  const h =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a[1])) *
      Math.cos(radians(b[1])) *
      Math.sin(longitude / 2) ** 2;

  return (
    6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
  );
}
