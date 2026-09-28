export type Place = {
  id: number;
  key: string;
  name: string;
  lat: number | null;
  lng: number | null;
  suburb: string | null;
  note: string;
};

export const googleMapsUrl = (place: Pick<Place, 'key'>) => `https://maps.google.com/?cid=${place.key}`;

export const transitDirectionsUrl = (place: Pick<Place, 'lat' | 'lng' | 'name'>) => {
  const destination = place.lat !== null && place.lng !== null ? `${place.lat},${place.lng}` : encodeURIComponent(place.name);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=transit`;
};
