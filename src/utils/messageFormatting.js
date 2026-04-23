const TEXT_STYLES = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['__', '__'],
  strikethrough: ['~~', '~~']
};

function normalizeTextFragment(value = '') {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function formatText(text, style) {
  const normalizedText = normalizeTextFragment(text);
  const tokens = TEXT_STYLES[style];

  if (!tokens) {
    return normalizedText;
  }

  if (!normalizedText) {
    return normalizedText;
  }

  return `${tokens[0]}${normalizedText}${tokens[1]}`;
}

function bold(text) {
  return formatText(text, 'bold');
}

function italic(text) {
  return formatText(text, 'italic');
}

function underline(text) {
  return formatText(text, 'underline');
}

function strikethrough(text) {
  return formatText(text, 'strikethrough');
}

function joinFormattedText(parts = []) {
  return parts.map((part) => normalizeTextFragment(part)).join('');
}

module.exports = {
  TEXT_STYLES,
  formatText,
  bold,
  italic,
  underline,
  strikethrough,
  joinFormattedText
};
