const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === 'true';
const WHATSAPP_AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || path.join(__dirname, '.baileys_auth');
const WHATSAPP_PAIRING_NUMBER = normalizePhoneNumber(process.env.WHATSAPP_PAIRING_NUMBER || '');
const WHATSAPP_PRINT_QR = process.env.WHATSAPP_PRINT_QR !== 'false';
const WHATSAPP_USE_PAIRING_CODE = Boolean(WHATSAPP_PAIRING_NUMBER);

const STATES = {
  WELCOME: 'WELCOME',
  MAIN_MENU: 'MAIN_MENU',
  CLAIM_NEW: 'CLAIM_NEW',
  CLAIM_REITERATION: 'CLAIM_REITERATION',
  REITERATION_CONFIRMATION: 'REITERATION_CONFIRMATION',
  MUNIDIGITAL_HELP: 'MUNIDIGITAL_HELP',
  REGISTER_HELP: 'REGISTER_HELP',
  CLAIM_TUTORIAL: 'CLAIM_TUTORIAL',
  SYSTEM_PROBLEM: 'SYSTEM_PROBLEM',
  PHONE_SUPPORT: 'PHONE_SUPPORT',
  OPERATOR_CONTACT: 'OPERATOR_CONTACT',
  FALLBACK: 'FALLBACK'
};

const sessions = new Map();
const reiterations = [];
const operatorQueue = [];

const whatsappRuntime = {
  enabled: WHATSAPP_ENABLED,
  status: WHATSAPP_ENABLED ? 'booting' : 'disabled',
  authDir: WHATSAPP_AUTH_DIR,
  lastConnectionUpdate: null,
  lastQrAt: null,
  lastPairingCode: null,
  socket: null
};

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      userId,
      state: STATES.WELCOME,
      lastValidState: STATES.WELCOME,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      context: {}
    });
  }

  return sessions.get(userId);
}

function updateSession(userId, patch) {
  const session = getSession(userId);
  const updated = {
    ...session,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  sessions.set(userId, updated);
  return updated;
}

function setState(userId, newState) {
  const session = getSession(userId);
  return updateSession(userId, {
    lastValidState: newState === STATES.FALLBACK ? session.lastValidState : newState,
    state: newState
  });
}

function normalizeInput(text = '') {
  return String(text).trim();
}

function normalizePhoneNumber(value = '') {
  return String(value).replace(/\D+/g, '');
}

function isMenuCommand(text = '') {
  return normalizeInput(text).toUpperCase() === 'MENU';
}

function isValidClaimNumber(text = '') {
  const value = normalizeInput(text).toUpperCase();
  return /^MU-?\d{3,20}$/.test(value) || /^\d{3,20}$/.test(value);
}

function showMainMenu() {
  return [
    'Hola. Gracias por comunicarte con Movilidad Urbana Posadas.',
    '',
    'Elegi una opcion:',
    '1. Hacer un reclamo',
    '2. Reiterar un reclamo existente',
    '3. Ayuda para usar MuniDigital',
    '4. Atencion telefonica',
    '5. Hablar con un operador',
    '',
    'Escribi MENU para volver al menu principal en cualquier momento.'
  ].join('\n');
}

function fallbackMessage() {
  return [
    'No pude entender tu respuesta.',
    '',
    'Escribi MENU para volver al menu principal.'
  ].join('\n');
}

function welcomeMessage() {
  return showMainMenu();
}

function claimNewMessage() {
  return [
    'Vamos a ayudarte a iniciar un reclamo.',
    '',
    'Los reclamos se cargan en la plataforma MuniDigital, donde tambien podras consultar su estado.',
    '',
    'Elegi una opcion:',
    '1. No tengo usuario de MuniDigital',
    '2. Tengo usuario, pero no se como cargar el reclamo',
    '',
    'Escribi MENU para volver al menu principal.'
  ].join('\n');
}

function reiterationMessage() {
  return [
    'Si ya realizaste un reclamo en MuniDigital y el problema aun no fue resuelto, podes reiterarlo aqui.',
    '',
    'Por favor escribi el numero de reclamo.',
    'Ejemplo: MU-12345',
    '',
    'Escribi MENU para volver al menu principal.'
  ].join('\n');
}

function reiterationConfirmationMessage() {
  return [
    'Tu reiteracion fue registrada correctamente.',
    '',
    'La informacion sera enviada al area correspondiente.',
    'Recorda que el seguimiento del reclamo se realiza desde la plataforma MuniDigital.',
    '',
    'Si necesitas realizar otra accion, escribi MENU para volver al menu principal.'
  ].join('\n');
}

function muniDigitalHelpMessage() {
  return [
    'Si necesitas ayuda para usar MuniDigital, elegi una opcion:',
    '',
    '1. No tengo usuario de MuniDigital',
    '2. No se como cargar un reclamo',
    '3. Tengo problemas con el sistema',
    '',
    'Escribi MENU para volver al menu principal.'
  ].join('\n');
}

function registerHelpMessage() {
  return [
    'Para hacer un reclamo primero debes crear una cuenta en MuniDigital.',
    '',
    'Podes registrarte aqui:',
    'https://munidigital.com/citizenv2/posadas/register',
    '',
    'Durante el registro te solicitaran:',
    '- Nombre y apellido',
    '- DNI',
    '- Telefono',
    '- Correo electronico',
    '- Fecha de nacimiento',
    '- Contrasena',
    '',
    'Escribi MENU para volver al menu principal.'
  ].join('\n');
}

function claimTutorialMessage() {
  return [
    'Para cargar un reclamo en MuniDigital segui estos pasos:',
    '',
    '1. Ingresa a la plataforma',
    '2. Inicia sesion con tu usuario',
    '3. Selecciona Solicitudes / Reclamos',
    '4. Elegi el area correspondiente',
    '5. Completa los datos del problema',
    '6. Podes adjuntar fotos si es necesario',
    '',
    'Accede aqui:',
    'https://munidigital.com/citizenv2/posadas/login',
    '',
    'Escribi MENU para volver al menu principal.'
  ].join('\n');
}

function systemProblemMessage() {
  return [
    'Si estas teniendo problemas con la plataforma MuniDigital, podes intentar lo siguiente:',
    '',
    '- Verificar tu conexion a internet',
    '- Intentar nuevamente mas tarde',
    '- Probar desde otro navegador o dispositivo',
    '',
    'Si el problema continua, podes comunicarte con un operador desde este chat.',
    '',
    'Escribi MENU para volver al menu principal.'
  ].join('\n');
}

function phoneSupportMessage() {
  return [
    'Si preferis realizar tu consulta o reclamo por telefono, podes comunicarte con el 0800 de la Municipalidad de Posadas.',
    '',
    '0800-888-2483 (CIUDAD)',
    '',
    'Horario de atencion:',
    'Lunes a viernes',
    '07:00 a 19:00 hs',
    '',
    'A traves de este numero podes realizar:',
    '- consultas',
    '- reclamos',
    '- sugerencias',
    '',
    'Para urgencias de transito (Guardia 24 hs):',
    '3765-268999',
    '',
    'Escribi MENU para volver al menu principal.'
  ].join('\n');
}

function operatorContactMessage() {
  return [
    'Tu consulta sera derivada a un operador de Movilidad Urbana.',
    '',
    'Un agente revisara tu mensaje y respondera por este mismo medio.',
    'Debido a la cantidad de consultas, la respuesta puede demorar.',
    '',
    'Recorda que:',
    '- Los reclamos se cargan en MuniDigital',
    '- El seguimiento del reclamo se realiza desde esa plataforma',
    '',
    'Si necesitas volver al menu principal escribi MENU.'
  ].join('\n');
}

function processMessage(userId, rawText) {
  const text = normalizeInput(rawText);
  const session = getSession(userId);

  if (isMenuCommand(text)) {
    setState(userId, STATES.MAIN_MENU);
    return showMainMenu();
  }

  if (session.state === STATES.WELCOME) {
    setState(userId, STATES.MAIN_MENU);
    return welcomeMessage();
  }

  switch (session.state) {
    case STATES.MAIN_MENU:
      return handleMainMenu(userId, text);
    case STATES.CLAIM_NEW:
      return handleClaimNew(userId, text);
    case STATES.CLAIM_REITERATION:
      return handleClaimReiteration(userId, text);
    case STATES.REITERATION_CONFIRMATION:
      setState(userId, STATES.FALLBACK);
      return fallbackMessage();
    case STATES.MUNIDIGITAL_HELP:
      return handleMuniDigitalHelp(userId, text);
    case STATES.REGISTER_HELP:
    case STATES.CLAIM_TUTORIAL:
    case STATES.SYSTEM_PROBLEM:
    case STATES.PHONE_SUPPORT:
      setState(userId, STATES.FALLBACK);
      return fallbackMessage();
    case STATES.OPERATOR_CONTACT:
      return handleOperatorContact(userId, text);
    case STATES.FALLBACK:
      return fallbackMessage();
    default:
      setState(userId, STATES.MAIN_MENU);
      return showMainMenu();
  }
}

function handleMainMenu(userId, text) {
  switch (text) {
    case '1':
      setState(userId, STATES.CLAIM_NEW);
      return claimNewMessage();
    case '2':
      setState(userId, STATES.CLAIM_REITERATION);
      return reiterationMessage();
    case '3':
      setState(userId, STATES.MUNIDIGITAL_HELP);
      return muniDigitalHelpMessage();
    case '4':
      setState(userId, STATES.PHONE_SUPPORT);
      return phoneSupportMessage();
    case '5':
      operatorQueue.push({
        userId,
        createdAt: new Date().toISOString(),
        reason: 'operator_requested_from_main_menu'
      });
      setState(userId, STATES.OPERATOR_CONTACT);
      return operatorContactMessage();
    default:
      setState(userId, STATES.FALLBACK);
      return fallbackMessage();
  }
}

function handleClaimNew(userId, text) {
  switch (text) {
    case '1':
      setState(userId, STATES.REGISTER_HELP);
      return registerHelpMessage();
    case '2':
      setState(userId, STATES.CLAIM_TUTORIAL);
      return claimTutorialMessage();
    default:
      setState(userId, STATES.FALLBACK);
      return fallbackMessage();
  }
}

function handleClaimReiteration(userId, text) {
  if (!isValidClaimNumber(text)) {
    setState(userId, STATES.FALLBACK);
    return fallbackMessage();
  }

  const normalizedClaimNumber = normalizeClaimNumber(text);
  reiterations.push({
    userId,
    claimNumber: normalizedClaimNumber,
    createdAt: new Date().toISOString(),
    channel: 'whatsapp'
  });

  updateSession(userId, {
    context: {
      ...getSession(userId).context,
      lastClaimNumber: normalizedClaimNumber
    }
  });

  setState(userId, STATES.REITERATION_CONFIRMATION);
  return reiterationConfirmationMessage();
}

function normalizeClaimNumber(text) {
  const value = normalizeInput(text).toUpperCase().replace(/\s+/g, '');
  if (/^\d+$/.test(value)) {
    return `MU-${value}`;
  }

  if (/^MU\d+$/.test(value)) {
    return value.replace(/^MU/, 'MU-');
  }

  return value;
}

function handleMuniDigitalHelp(userId, text) {
  switch (text) {
    case '1':
      setState(userId, STATES.REGISTER_HELP);
      return registerHelpMessage();
    case '2':
      setState(userId, STATES.CLAIM_TUTORIAL);
      return claimTutorialMessage();
    case '3':
      setState(userId, STATES.SYSTEM_PROBLEM);
      return systemProblemMessage();
    default:
      setState(userId, STATES.FALLBACK);
      return fallbackMessage();
  }
}

function handleOperatorContact(userId, text) {
  operatorQueue.push({
    userId,
    createdAt: new Date().toISOString(),
    reason: 'message_while_waiting_operator',
    message: text
  });

  return [
    'Tu mensaje fue registrado para el operador.',
    '',
    'Si necesitas volver al menu principal, escribi MENU.'
  ].join('\n');
}

function extractMessageText(message) {
  if (!message) {
    return '';
  }

  if (message.conversation) {
    return message.conversation;
  }

  if (message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text;
  }

  if (message.imageMessage?.caption) {
    return message.imageMessage.caption;
  }

  if (message.videoMessage?.caption) {
    return message.videoMessage.caption;
  }

  if (message.buttonsResponseMessage?.selectedButtonId) {
    return message.buttonsResponseMessage.selectedButtonId;
  }

  if (message.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return message.listResponseMessage.singleSelectReply.selectedRowId;
  }

  if (message.templateButtonReplyMessage?.selectedId) {
    return message.templateButtonReplyMessage.selectedId;
  }

  return '';
}

async function startWhatsAppBridge() {
  if (!WHATSAPP_ENABLED) {
    return;
  }

  let makeWASocket;
  let useMultiFileAuthState;
  let DisconnectReason;
  let Browsers;
  let pino;
  let qrcode;

  try {
    ({ default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = await import('@whiskeysockets/baileys'));
    ({ default: pino } = await import('pino'));

    if (WHATSAPP_PRINT_QR) {
      ({ default: qrcode } = await import('qrcode-terminal'));
    }
  } catch (error) {
    whatsappRuntime.status = 'dependency_error';
    console.error('No se pudo iniciar Baileys. Instala sus dependencias primero.', error);
    return;
  }

  const { state, saveCreds } = await useMultiFileAuthState(WHATSAPP_AUTH_DIR);
  let pairingCodeRequested = false;

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Google Chrome'),
    markOnlineOnConnect: false,
    getMessage: async () => undefined
  });

  whatsappRuntime.socket = sock;
  whatsappRuntime.status = 'connecting';

  sock.ev.on('creds.update', saveCreds);

  if (WHATSAPP_USE_PAIRING_CODE && !state.creds.registered) {
    pairingCodeRequested = true;
    try {
      const code = await sock.requestPairingCode(WHATSAPP_PAIRING_NUMBER);
      whatsappRuntime.lastPairingCode = code;
      whatsappRuntime.status = 'pairing_code_ready';
      console.log(`Codigo de vinculacion: ${code}`);
    } catch (error) {
      pairingCodeRequested = false;
      whatsappRuntime.status = 'pairing_code_error';
      console.error('No se pudo solicitar el codigo de vinculacion:', error.message);
    }
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    whatsappRuntime.lastConnectionUpdate = {
      connection: connection || null,
      timestamp: new Date().toISOString(),
      hasQr: Boolean(qr)
    };

    if (qr && !WHATSAPP_USE_PAIRING_CODE) {
      whatsappRuntime.status = 'qr_pending';
      whatsappRuntime.lastQrAt = new Date().toISOString();

      if (qrcode) {
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === 'open') {
      whatsappRuntime.status = 'connected';
      console.log('WhatsApp conectado.');
      return;
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect =
        statusCode !== 405 &&
        statusCode !== DisconnectReason.loggedOut &&
        statusCode !== DisconnectReason.restartRequired;

      console.error(`WhatsApp cerro la conexion. statusCode=${statusCode ?? 'unknown'}`);

      if (statusCode === DisconnectReason.restartRequired) {
        whatsappRuntime.status = 'restarting';
        console.log('WhatsApp requiere reinicio de socket. Reconectando...');
        startWhatsAppBridge().catch((error) => {
          console.error('Error reiniciando WhatsApp:', error);
        });
        return;
      }

      if (shouldReconnect) {
        whatsappRuntime.status = 'reconnecting';
        console.log('WhatsApp desconectado. Intentando reconectar...');
        startWhatsAppBridge().catch((error) => {
          console.error('Error reconectando WhatsApp:', error);
        });
        return;
      }

      if (statusCode === 405) {
        whatsappRuntime.status = 'pairing_not_allowed';
        console.error('WhatsApp rechazo este metodo de vinculacion. Proba limpiando la sesion y usando QR en lugar de codigo.');
        return;
      }

      whatsappRuntime.status = 'logged_out';
      console.error('WhatsApp cerro sesion. Hace falta volver a vincular el dispositivo.');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') {
      return;
    }

    for (const incoming of messages) {
      if (!incoming.message) {
        continue;
      }

      if (incoming.key?.fromMe) {
        continue;
      }

      const remoteJid = incoming.key?.remoteJid || '';
      if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) {
        continue;
      }

      const text = normalizeInput(extractMessageText(incoming.message));
      if (!text) {
        continue;
      }

      const reply = processMessage(remoteJid, text);
      if (!reply) {
        continue;
      }

      try {
        await sock.sendMessage(remoteJid, { text: reply });
      } catch (error) {
        console.error(`No se pudo responder a ${remoteJid}:`, error);
      }
    }
  });
}

app.post('/webhook/message', (req, res) => {
  try {
    const userId = normalizeInput(req.body.userId);
    const message = normalizeInput(req.body.message);

    if (!userId) {
      return res.status(400).json({ error: 'userId es obligatorio' });
    }

    const reply = processMessage(userId, message);
    const session = getSession(userId);

    return res.json({
      ok: true,
      userId,
      state: session.state,
      reply
    });
  } catch (error) {
    console.error('Error procesando mensaje:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/webhook/start', (req, res) => {
  const userId = normalizeInput(req.body.userId);
  if (!userId) {
    return res.status(400).json({ error: 'userId es obligatorio' });
  }

  updateSession(userId, {
    state: STATES.MAIN_MENU,
    lastValidState: STATES.MAIN_MENU,
    context: {}
  });

  return res.json({
    ok: true,
    userId,
    state: STATES.MAIN_MENU,
    reply: showMainMenu()
  });
});

app.get('/admin/debug', (_req, res) => {
  res.json({
    sessions: Array.from(sessions.values()),
    reiterations,
    operatorQueue,
    whatsapp: {
      enabled: whatsappRuntime.enabled,
      status: whatsappRuntime.status,
      authDir: whatsappRuntime.authDir,
      lastQrAt: whatsappRuntime.lastQrAt,
      lastPairingCode: whatsappRuntime.lastPairingCode,
      lastConnectionUpdate: whatsappRuntime.lastConnectionUpdate
    }
  });
});

app.listen(PORT, () => {
  console.log(`Chatbot escuchando en http://localhost:${PORT}`);
});

startWhatsAppBridge().catch((error) => {
  whatsappRuntime.status = 'boot_error';
  console.error('No se pudo iniciar el puente de WhatsApp:', error);
});
