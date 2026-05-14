const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatText,
  bold,
  italic,
  underline,
  strikethrough,
  joinFormattedText
} = require('../src/utils/messageFormatting');

test('formatText applies bold markers', () => {
  assert.equal(formatText('Hola', 'bold'), '*Hola*');
});

test('formatText applies italic markers', () => {
  assert.equal(italic('Hola'), '_Hola_');
});

test('underline returns plain text because WhatsApp does not support underline', () => {
  assert.equal(underline('MENU'), 'MENU');
});

test('formatText applies strikethrough markers', () => {
  assert.equal(strikethrough('Descartado'), '~Descartado~');
});

test('joinFormattedText concatenates formatted fragments', () => {
  assert.equal(
    joinFormattedText(['Escriba ', underline('MENU'), ' para continuar.']),
    'Escriba MENU para continuar.'
  );
});

test('formatText returns plain text for unknown styles', () => {
  assert.equal(formatText('Hola', 'unknown'), 'Hola');
});

test('bold helper keeps compatibility with existing string building', () => {
  assert.equal(bold('Importante'), '*Importante*');
});
