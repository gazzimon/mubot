const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_TIMEOUT_MS = 10000;

function normalizeString(value = '') {
  return String(value || '').trim();
}

function buildPosadasQuery(text) {
  const normalized = normalizeString(text);
  if (!normalized) {
    return '';
  }

  const parts = normalized.toLowerCase();
  if (parts.includes('posadas') && parts.includes('argentina')) {
    return normalized;
  }

  if (parts.includes('posadas')) {
    return `${normalized}, Misiones, Argentina`;
  }

  return `${normalized}, Posadas, Misiones, Argentina`;
}

function withTimeout(promiseFactory, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return promiseFactory(controller.signal).finally(() => {
    clearTimeout(timeout);
  });
}

function getAddressText(item = {}) {
  const address = item.address || {};
  const road = address.road || address.pedestrian || address.footway || address.cycleway || '';
  const houseNumber = address.house_number || '';
  const suburb = address.suburb || address.neighbourhood || address.city_district || '';
  const city = address.city || address.town || address.village || '';
  const state = address.state || '';
  const country = address.country || '';

  const firstLine = [road, houseNumber].filter(Boolean).join(' ').trim();
  const secondLine = [suburb, city, state, country].filter(Boolean).join(', ').trim();
  return [firstLine, secondLine].filter(Boolean).join(', ') || normalizeString(item.display_name);
}

function normalizeCandidate(item = {}) {
  const address = item.address || {};
  return {
    address: getAddressText(item),
    latitude: Number(item.lat),
    longitude: Number(item.lon),
    barrio: normalizeString(address.suburb || address.neighbourhood || address.city_district || ''),
    localidad: normalizeString(address.city || address.town || address.village || ''),
    pais: normalizeString(address.country || '')
  };
}

function isInsidePosadas(candidate = {}) {
  const localidad = normalizeString(candidate.localidad).toLowerCase();
  return localidad.includes('posadas');
}

async function searchAddress(text, options = {}) {
  const query = buildPosadasQuery(text);
  if (!query) {
    return [];
  }

  const baseUrl = normalizeString(options.baseUrl) || DEFAULT_BASE_URL;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const url = new URL('/search', baseUrl);

  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'ar');

  const response = await withTimeout(
    (signal) =>
      fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'OpenClaw/1.0 (Movilidad Urbana Posadas)'
        },
        signal
      }),
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`Geocoding respondio ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data.map(normalizeCandidate).filter(isInsidePosadas) : [];
}

async function reverseGeocode(latitude, longitude, options = {}) {
  const baseUrl = normalizeString(options.baseUrl) || DEFAULT_BASE_URL;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const url = new URL('/reverse', baseUrl);

  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');

  const response = await withTimeout(
    (signal) =>
      fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'OpenClaw/1.0 (Movilidad Urbana Posadas)'
        },
        signal
      }),
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`Reverse geocoding respondio ${response.status}`);
  }

  const data = await response.json();
  if (!data) {
    return null;
  }

  const candidate = normalizeCandidate(data);
  return isInsidePosadas(candidate) ? candidate : null;
}

module.exports = {
  searchAddress,
  reverseGeocode
};
