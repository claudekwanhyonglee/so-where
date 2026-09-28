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
