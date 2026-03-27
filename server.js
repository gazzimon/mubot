const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const app = express();
app.use(express.json());

const PORT = parsePort(process.env.PORT || '3000');
const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === 'true';
const WHATSAPP_AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || path.join(__dirname, '.wwebjs_auth');
const WHATSAPP_PRINT_QR = process.env.WHATSAPP_PRINT_QR !== 'false';
const WHATSAPP_BROWSER_PATH = process.env.WHATSAPP_BROWSER_PATH || findBrowserExecutable();
const DATA_FILE_PATH = process.env.DATA_FILE_PATH || path.join(__dirname, 'data', 'runtime-store.json');
const LOG_MESSAGE_BODIES = process.env.LOG_MESSAGE_BODIES === 'true';
const ADMIN_DEBUG_ENABLED = process.env.ADMIN_DEBUG_ENABLED !== 'false';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ADMIN_TOKEN_HEADER = 'x-admin-token';

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

validateRuntimeConfig();

const runtimeStore = loadRuntimeStore(DATA_FILE_PATH);
const sessions = new Map(runtimeStore.sessions.map((session) => [session.userId, session]));
const reiterations = runtimeStore.reiterations;
const operatorQueue = runtimeStore.operatorQueue;

const whatsappRuntime = {
  enabled: WHATSAPP_ENABLED,
  status: WHATSAPP_ENABLED ? 'booting' : 'disabled',
  authDir: WHATSAPP_AUTH_DIR,
  lastQrAt: null,
  lastClientEvent: null,
  client: null
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
  persistRuntimeStore();
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

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT invalido: ${value}`);
  }

  return port;
}

function validateRuntimeConfig() {
  if (ADMIN_DEBUG_ENABLED && !ADMIN_TOKEN) {
    throw new Error('ADMIN_TOKEN es obligatorio cuando ADMIN_DEBUG_ENABLED no es false.');
  }
}

function loadRuntimeStore(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      sessions: [],
      reiterations: [],
      operatorQueue: []
    };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      reiterations: Array.isArray(parsed.reiterations) ? parsed.reiterations : [],
      operatorQueue: Array.isArray(parsed.operatorQueue) ? parsed.operatorQueue : []
    };
  } catch (error) {
    throw new Error(`No se pudo cargar el archivo de datos ${filePath}: ${error.message}`);
  }
}

function persistRuntimeStore() {
  const directory = path.dirname(DATA_FILE_PATH);
  fs.mkdirSync(directory, { recursive: true });

  const payload = {
    sessions: Array.from(sessions.values()),
    reiterations,
    operatorQueue
  };

  fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

function findBrowserExecutable() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return '';
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
    'Volve a intentar con una opcion valida o escribi MENU para volver al menu principal.'
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

function retryMessage(nextStepMessage) {
  return [fallbackMessage(), '', nextStepMessage].join('\n');
}

function shouldReturnToMenuOnNextMessage(state) {
  return [
    STATES.REITERATION_CONFIRMATION,
    STATES.REGISTER_HELP,
    STATES.CLAIM_TUTORIAL,
    STATES.SYSTEM_PROBLEM,
    STATES.PHONE_SUPPORT
  ].includes(state);
}

function processMessage(userId, rawText, options = {}) {
  const text = normalizeInput(rawText);
  const session = getSession(userId);
  const channel = options.channel || 'unknown';

  if (isMenuCommand(text)) {
    setState(userId, STATES.MAIN_MENU);
    return showMainMenu();
  }

  if (session.state === STATES.WELCOME) {
    setState(userId, STATES.MAIN_MENU);
    return welcomeMessage();
  }

  if (shouldReturnToMenuOnNextMessage(session.state)) {
    setState(userId, STATES.MAIN_MENU);
    return showMainMenu();
  }

  switch (session.state) {
    case STATES.MAIN_MENU:
      return handleMainMenu(userId, text, channel);
    case STATES.CLAIM_NEW:
      return handleClaimNew(userId, text);
    case STATES.CLAIM_REITERATION:
      return handleClaimReiteration(userId, text, channel);
    case STATES.MUNIDIGITAL_HELP:
      return handleMuniDigitalHelp(userId, text);
    case STATES.OPERATOR_CONTACT:
      return handleOperatorContact(userId, text, channel);
    default:
      setState(userId, STATES.MAIN_MENU);
      return showMainMenu();
  }
}

function handleMainMenu(userId, text, channel) {
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
        reason: 'operator_requested_from_main_menu',
        channel
      });
      persistRuntimeStore();
      setState(userId, STATES.OPERATOR_CONTACT);
      return operatorContactMessage();
    default:
      return retryMessage(showMainMenu());
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
      return retryMessage(claimNewMessage());
  }
}

function handleClaimReiteration(userId, text, channel) {
  if (!isValidClaimNumber(text)) {
    return retryMessage(reiterationMessage());
  }

  const normalizedClaimNumber = normalizeClaimNumber(text);
  reiterations.push({
    userId,
    claimNumber: normalizedClaimNumber,
    createdAt: new Date().toISOString(),
    channel
  });
  persistRuntimeStore();

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
      return retryMessage(muniDigitalHelpMessage());
  }
}

function handleOperatorContact(userId, text, channel) {
  operatorQueue.push({
    userId,
    createdAt: new Date().toISOString(),
    reason: 'message_while_waiting_operator',
    message: text,
    channel
  });
  persistRuntimeStore();

  return [
    'Tu mensaje fue registrado para el operador.',
    '',
    'Si necesitas volver al menu principal, escribi MENU.'
  ].join('\n');
}

function summarizeBodyForLogs(text) {
  if (LOG_MESSAGE_BODIES) {
    return `body="${text}"`;
  }

  return `bodyLength=${text.length}`;
}

function adminAuthMiddleware(req, res, next) {
  if (!ADMIN_DEBUG_ENABLED) {
    return res.status(404).json({ error: 'Ruta no disponible' });
  }

  const token = normalizeInput(req.header(ADMIN_TOKEN_HEADER));
  if (!token) {
    return res.status(401).json({ error: `Falta header ${ADMIN_TOKEN_HEADER}` });
  }

  if (token !== ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Token admin invalido' });
  }

  return next();
}

async function startWhatsAppBridge() {
  if (!WHATSAPP_ENABLED) {
    return;
  }

  let Client;
  let LocalAuth;
  let qrcode;

  try {
    ({ Client, LocalAuth } = require('whatsapp-web.js'));

    if (WHATSAPP_PRINT_QR) {
      ({ default: qrcode } = await import('qrcode-terminal'));
    }
  } catch (error) {
    whatsappRuntime.status = 'dependency_error';
    console.error('No se pudo iniciar whatsapp-web.js. Instala sus dependencias primero.', error);
    return;
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: WHATSAPP_AUTH_DIR
    }),
    puppeteer: {
      headless: true,
      executablePath: WHATSAPP_BROWSER_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  whatsappRuntime.client = client;
  whatsappRuntime.status = 'connecting';

  if (WHATSAPP_BROWSER_PATH) {
    console.log(`Usando navegador local: ${WHATSAPP_BROWSER_PATH}`);
  } else {
    console.log('No se encontro Chrome o Edge local. Puppeteer intentara usar su cache.');
  }

  client.on('qr', (qr) => {
    whatsappRuntime.status = 'qr_pending';
    whatsappRuntime.lastQrAt = new Date().toISOString();
    whatsappRuntime.lastClientEvent = {
      type: 'qr',
      timestamp: whatsappRuntime.lastQrAt
    };

    console.log('QR recibido. Escanealo desde WhatsApp > Dispositivos vinculados.');
    if (qrcode) {
      qrcode.generate(qr, { small: true });
    }
  });

  client.on('loading_screen', (percent, message) => {
    whatsappRuntime.status = 'loading';
    whatsappRuntime.lastClientEvent = {
      type: 'loading_screen',
      timestamp: new Date().toISOString(),
      percent,
      message
    };
    console.log(`WhatsApp cargando: ${percent}% ${message}`);
  });

  client.on('authenticated', () => {
    whatsappRuntime.status = 'authenticated';
    whatsappRuntime.lastClientEvent = {
      type: 'authenticated',
      timestamp: new Date().toISOString()
    };
    console.log('WhatsApp autenticado.');
  });

  client.on('ready', () => {
    whatsappRuntime.status = 'connected';
    whatsappRuntime.lastClientEvent = {
      type: 'ready',
      timestamp: new Date().toISOString()
    };
    console.log('WhatsApp conectado.');
  });

  client.on('auth_failure', (message) => {
    whatsappRuntime.status = 'auth_failure';
    whatsappRuntime.lastClientEvent = {
      type: 'auth_failure',
      timestamp: new Date().toISOString(),
      message
    };
    console.error(`Fallo de autenticacion de WhatsApp: ${message}`);
  });

  client.on('disconnected', (reason) => {
    whatsappRuntime.status = 'disconnected';
    whatsappRuntime.lastClientEvent = {
      type: 'disconnected',
      timestamp: new Date().toISOString(),
      reason: String(reason)
    };
    console.error(`WhatsApp desconectado: ${reason}`);
  });

  client.on('message', async (incoming) => {
    const text = normalizeInput(incoming.body);
    console.log(`Mensaje entrante desde ${incoming.from}. fromMe=${incoming.fromMe} ${summarizeBodyForLogs(text)}`);

    if (incoming.fromMe) {
      return;
    }

    if (incoming.from === 'status@broadcast' || incoming.from.endsWith('@g.us')) {
      console.log(`Mensaje ignorado de ${incoming.from}`);
      return;
    }

    if (!text) {
      console.log(`Mensaje sin texto util desde ${incoming.from}`);
      return;
    }

    const reply = processMessage(incoming.from, text, { channel: 'whatsapp' });
    if (!reply) {
      console.log(`Sin respuesta generada para ${incoming.from}`);
      return;
    }

    try {
      console.log(`Respondiendo a ${incoming.from}`);
      await client.sendMessage(incoming.from, reply);
    } catch (error) {
      console.error(`No se pudo responder a ${incoming.from}:`, error);
    }
  });

  await client.initialize();
}

app.post('/webhook/message', (req, res) => {
  try {
    const userId = normalizeInput(req.body.userId);
    const message = normalizeInput(req.body.message);

    if (!userId) {
      return res.status(400).json({ error: 'userId es obligatorio' });
    }

    const reply = processMessage(userId, message, { channel: 'api' });
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
  try {
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
  } catch (error) {
    console.error('Error iniciando sesion:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/admin/debug', adminAuthMiddleware, (_req, res) => {
  res.json({
    sessions: Array.from(sessions.values()),
    reiterations,
    operatorQueue,
    whatsapp: {
      enabled: whatsappRuntime.enabled,
      status: whatsappRuntime.status,
      authDir: whatsappRuntime.authDir,
      lastQrAt: whatsappRuntime.lastQrAt,
      lastClientEvent: whatsappRuntime.lastClientEvent
    }
  });
});

const server = app.listen(PORT, () => {
  console.log(`Chatbot escuchando en http://localhost:${PORT}`);
});

server.on('error', (error) => {
  console.error('No se pudo iniciar el servidor HTTP:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('Cerrando servidor...');
  try {
    if (whatsappRuntime.client) {
      await whatsappRuntime.client.destroy();
    }
  } catch (error) {
    console.error('Error cerrando cliente de WhatsApp:', error);
  } finally {
    process.exit(0);
  }
});

startWhatsAppBridge().catch((error) => {
  whatsappRuntime.status = 'boot_error';
  console.error('No se pudo iniciar el puente de WhatsApp:', error);
});
