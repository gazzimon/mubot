require('dotenv').config();
const crypto = require('crypto');

function buildTimestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

function buildHexBase64Auth(access, secret, timestamp) {
  const message = `${timestamp}.${access}`;
  const hashHex = crypto.createHmac('sha1', secret).update(message, 'utf8').digest('hex');
  const hashBase64 = Buffer.from(hashHex, 'utf8').toString('base64');

  return {
    message,
    hashHex,
    hashBase64,
    authorization: `MD ${access}:${hashBase64}`
  };
}

function main() {
  const access = String(process.env.MUNIDIGITAL_ACCESS || '');
  const secret = String(process.env.MUNIDIGITAL_SECRET || '');
  const timestamp = process.argv[2] || buildTimestamp();

  if (!access || !secret) {
    console.error('Faltan MUNIDIGITAL_ACCESS o MUNIDIGITAL_SECRET en .env');
    process.exit(1);
  }

  const auth = buildHexBase64Auth(access, secret, timestamp);

  console.log(JSON.stringify({
    timestamp,
    access,
    ...auth
  }, null, 2));
}

main();
