const fs = require('fs');
const path = require('path');

function ensureDirectoryExists(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function sanitizeFileSegment(value, fallbackValue) {
  const normalized = String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallbackValue;
}

function fileExtensionForMimeType(mimeType = '') {
  const lower = String(mimeType).toLowerCase();
  if (lower === 'image/jpeg') {
    return '.jpg';
  }

  if (lower === 'image/png') {
    return '.png';
  }

  if (lower === 'image/webp') {
    return '.webp';
  }

  return '';
}

async function storeIncomingImage(message, options = {}) {
  if (!message || !message.hasMedia || typeof message.downloadMedia !== 'function') {
    return null;
  }

  const media = await message.downloadMedia();
  if (!media || !String(media.mimetype || '').toLowerCase().startsWith('image/')) {
    return null;
  }

  const uploadsRoot = options.uploadsRoot || path.join(process.cwd(), 'data', 'uploads');
  const userDirectory = path.join(uploadsRoot, sanitizeFileSegment(options.userId, 'unknown-user'));
  ensureDirectoryExists(userDirectory);

  const rawName = String(media.filename || `photo-${Date.now()}`);
  const originalExtension = path.extname(rawName);
  const baseName = sanitizeFileSegment(
    originalExtension ? rawName.slice(0, -originalExtension.length) : rawName,
    `photo-${Date.now()}`
  );
  const extension = originalExtension || fileExtensionForMimeType(media.mimetype) || '.bin';
  const fileName = `${baseName}${extension}`;
  const filePath = path.join(userDirectory, fileName);

  fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));

  return {
    path: filePath,
    mimeType: media.mimetype,
    fileName,
    storedAt: new Date().toISOString()
  };
}

module.exports = {
  storeIncomingImage
};
