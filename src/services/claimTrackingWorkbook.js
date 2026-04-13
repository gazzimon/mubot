const fs = require('fs');
const path = require('path');

function ensureDirectoryExists(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function normalizeString(value = '') {
  return String(value ?? '').trim();
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function serializeErrorBody(value) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function claimNumberFromSubmission(submission) {
  const body = submission && submission.body;
  if (!body || typeof body !== 'object') {
    return '';
  }

  const candidates = [body.result, body.numero, body.id, body.incidenteId, body.reclamoId];
  const match = candidates.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return match == null ? '' : String(match);
}

function loadEntries(storePath) {
  if (!fs.existsSync(storePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function buildWorkbookHtml(entries) {
  const headers = [
    'Fecha',
    'Usuario',
    'Canal',
    'Estado',
    'Numero de reclamo',
    'Estado MuniDigital',
    'Codigo respuesta',
    'Mensaje de error',
    'Detalle error',
    'Area',
    'Tipo de incidente',
    'Direccion',
    'Barrio',
    'Latitud',
    'Longitud',
    'Observaciones',
    'Telefono',
    'DNI',
    'Tiene foto',
    'Ruta foto'
  ];

  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const rowsHtml = entries
    .map((entry) => {
      const values = [
        entry.createdAt,
        entry.userId,
        entry.channel,
        entry.status,
        entry.claimNumber,
        entry.muniDigitalStatus,
        entry.responseCode,
        entry.errorMessage,
        entry.errorDetail,
        entry.serviceArea,
        entry.incidentType,
        entry.address,
        entry.neighborhood,
        entry.latitude,
        entry.longitude,
        entry.observations,
        entry.phone,
        entry.dni,
        entry.hasPhoto,
        entry.photoPath
      ];

      return `<tr>${values.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Seguimiento de reclamos</title>
  <style>
    table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
    th, td { border: 1px solid #999; padding: 6px; vertical-align: top; }
    th { background: #e6f0f8; }
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>${headerHtml}</tr>
    </thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
}

function normalizeEntry(entry = {}) {
  const submission = entry.submission || null;
  const submissionBody = submission && submission.body && typeof submission.body === 'object' ? submission.body : null;
  const error = entry.error || null;

  return {
    createdAt: normalizeString(entry.createdAt || new Date().toISOString()),
    userId: normalizeString(entry.userId),
    channel: normalizeString(entry.channel),
    status: normalizeString(entry.status),
    claimNumber: claimNumberFromSubmission(submission),
    muniDigitalStatus: normalizeString(
      submission && submission.status != null
        ? submission.status
        : error && error.status != null
          ? error.status
          : ''
    ),
    responseCode: normalizeString(submissionBody && submissionBody.code ? submissionBody.code : ''),
    errorMessage: normalizeString(error && error.message ? error.message : ''),
    errorDetail: serializeErrorBody(error && error.responseBody),
    serviceArea: normalizeString(entry.claim && entry.claim.serviceAreaLabel),
    incidentType: normalizeString(entry.claim && entry.claim.incidentTypeLabel),
    address: normalizeString(entry.payload && entry.payload.direccion),
    neighborhood: normalizeString(entry.payload && entry.payload.barrio),
    latitude: normalizeString(entry.payload && entry.payload.latitud),
    longitude: normalizeString(entry.payload && entry.payload.longitud),
    observations: normalizeString(entry.payload && entry.payload.observaciones),
    phone: normalizeString(entry.claim && entry.claim.phone),
    dni: normalizeString(entry.claim && entry.claim.dni),
    hasPhoto: entry.claim && entry.claim.photo && entry.claim.photo.path ? 'SI' : 'NO',
    photoPath: normalizeString(entry.claim && entry.claim.photo && entry.claim.photo.path)
  };
}

function createClaimTrackingWorkbook(options = {}) {
  const workbookPath = options.workbookPath;
  const storePath = options.storePath || workbookPath.replace(/\.xls$/i, '.json');

  async function appendEntry(entry = {}) {
    ensureDirectoryExists(path.dirname(workbookPath));
    const entries = loadEntries(storePath);
    entries.push(normalizeEntry(entry));
    fs.writeFileSync(storePath, JSON.stringify(entries, null, 2), 'utf8');
    fs.writeFileSync(workbookPath, buildWorkbookHtml(entries), 'utf8');
  }

  return {
    appendEntry
  };
}

module.exports = {
  createClaimTrackingWorkbook
};
