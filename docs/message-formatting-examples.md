# Message Formatting Examples

The chatbot now supports these visible formatting markers:

- `**texto**` for bold
- `*texto*` for italic
- `__texto__` for underline
- `~~texto~~` for strikethrough

Examples with the reusable helper from `src/utils/messageFormatting.js`:

```js
const {
  bold,
  italic,
  underline,
  strikethrough,
  joinFormattedText
} = require('../src/utils/messageFormatting');

const example = [
  bold('Titulo importante'),
  italic('Texto de apoyo'),
  joinFormattedText(['Escriba ', underline('MENU'), ' para continuar.']),
  strikethrough('Texto descartado')
].join('\n');
```

Before:

```text
Escriba MENU para continuar.
```

After:

```text
Escriba __MENU__ para continuar.
```
