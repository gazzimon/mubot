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
  assert.equal(formatText('Hola', 'bold'), '**Hola**');
});

test('formatText applies italic markers', () => {
  assert.equal(italic('Hola'), '*Hola*');
});

test('formatText applies underline markers', () => {
  assert.equal(underline('MENU'), '__MENU__');
});

test('formatText applies strikethrough markers', () => {
  assert.equal(strikethrough('Descartado'), '~~Descartado~~');
});

test('joinFormattedText concatenates formatted fragments', () => {
  assert.equal(
    joinFormattedText(['Escriba ', underline('MENU'), ' para continuar.']),
    'Escriba __MENU__ para continuar.'
  );
});

test('formatText returns plain text for unknown styles', () => {
  assert.equal(formatText('Hola', 'unknown'), 'Hola');
});

test('bold helper keeps compatibility with existing string building', () => {
  assert.equal(bold('Importante'), '**Importante**');
});
