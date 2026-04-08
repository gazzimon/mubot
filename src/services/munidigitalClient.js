const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 30000;

function normalizeBaseUrl(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function buildAuthorizationHeader(access, secret, timestamp) {
  const message = `${timestamp}.${access}`;
  const hashHex = crypto
    .createHmac('sha1', secret)
    .update(message, 'utf8')
    .digest('hex');
  const hashBase64 = Buffer.from(hashHex, 'utf8').toString('base64');
  return `MD ${access}:${hashBase64}`;
}

function withTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return promiseFactory(controller.signal).finally(() => {
    clearTimeout(timeout);
  });
}

async function appendImage(form, filePath, index) {
  const content = await fs.promises.readFile(filePath);
  const fileName = path.basename(filePath) || `image-${index + 1}.jpg`;
  const blob = new Blob([content]);
  form.append('request', blob, fileName);
}

function parseResponseBody(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function createMuniDigitalClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const access = String(options.access || '').trim();
  const secret = String(options.secret || '').trim();
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;

  function assertConfigured() {
    if (!baseUrl) {
      throw new Error('MUNIDIGITAL_BASE_URL no esta configurado.');
    }

    if (!access) {
      throw new Error('MUNIDIGITAL_ACCESS no esta configurado.');
    }

    if (!secret) {
      throw new Error('MUNIDIGITAL_SECRET no esta configurado.');
    }
  }

  async function submitIncident({ payload, images = [] }) {
    assertConfigured();

    const timestamp = Date.now().toString();
    const authorization = buildAuthorizationHeader(access, secret, timestamp);
    const form = new FormData();
    form.append('Incidente', JSON.stringify(payload));

    for (let index = 0; index < images.length; index += 1) {
      await appendImage(form, images[index], index);
    }

    const endpoint = `${baseUrl}/api/incidentes`;
    const response = await withTimeout(
      (signal) =>
        fetch(endpoint, {
          method: 'POST',
          headers: {
            'x-md-timestamp': timestamp,
            Authorization: authorization
          },
          body: form,
          signal
        }),
      timeoutMs
    );

    const bodyText = await response.text();
    const parsedBody = parseResponseBody(bodyText);

    if (!response.ok) {
      const error = new Error(`MuniDigital respondio ${response.status}`);
      error.status = response.status;
      error.responseBody = parsedBody;
      throw error;
    }

    return {
      ok: true,
      status: response.status,
      body: parsedBody,
      timestamp
    };
  }

  return {
    submitIncident
  };
}

module.exports = {
  createMuniDigitalClient,
  buildAuthorizationHeader
};
