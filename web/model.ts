export type Place = {
  id: number;
  key: string;
  name: string;
  lat: number | null;
  lng: number | null;
  suburb: string | null;
  note: string;
};

/** Card colours with the ink that reads on them. Things get one by id, so a place is always the same colour. */
const SWATCH = [
  { bg: '#e8432c', fg: '#fff4ec' },
  { bg: '#ffc93c', fg: '#2a1712' },
  { bg: '#1f8a70', fg: '#fff4ec' },
  { bg: '#6a3d6e', fg: '#fff4ec' },
  { bg: '#ff8a5b', fg: '#2a1712' },
  { bg: '#2f5d9e', fg: '#fff4ec' },
];

export const swatch = (id: number) => SWATCH[Math.abs(id) % SWATCH.length];

export const googleMapsUrl = (place: Pick<Place, 'key'>) => `https://maps.google.com/?cid=${place.key}`;

export const transitDirectionsUrl = (place: Pick<Place, 'lat' | 'lng' | 'name'>) => {
  const destination = place.lat !== null && place.lng !== null ? `${place.lat},${place.lng}` : encodeURIComponent(place.name);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=transit`;
};
