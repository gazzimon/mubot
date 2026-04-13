const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { createFlowHelpers } = require('./src/flows/alumbradoFlow');
const { createMuniDigitalClient } = require('./src/services/munidigitalClient');
const { storeIncomingImage } = require('./src/services/uploadStore');
const app = express();
app.use(express.json());

const PORT = parsePort(process.env.PORT || '3000');
const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === 'true';
const WHATSAPP_AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || path.join(__dirname, '.wwebjs_auth');
const WHATSAPP_PRINT_QR = process.env.WHATSAPP_PRINT_QR !== 'false';
const WHATSAPP_BROWSER_PATH = process.env.WHATSAPP_BROWSER_PATH || findBrowserExecutable();
const DATA_FILE_PATH = process.env.DATA_FILE_PATH || path.join(__dirname, 'data', 'runtime-store.json');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'data', 'uploads');
const REGISTER_HELP_IMAGE_PATH = process.env.REGISTER_HELP_IMAGE_PATH || path.join(__dirname, 'data', 'assets', 'muniregistro_liviano.jpg');
const LOG_MESSAGE_BODIES = process.env.LOG_MESSAGE_BODIES === 'true';
const ADMIN_DEBUG_ENABLED = process.env.ADMIN_DEBUG_ENABLED !== 'false';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ADMIN_TOKEN_HEADER = 'x-admin-token';
const ADMIN_TEST_ROUTES_ENABLED = process.env.ADMIN_TEST_ROUTES_ENABLED === 'true';
const MUNIDIGITAL_ENV = normalizeEnvironment(process.env.MUNIDIGITAL_ENV || 'TEST');
const MUNIDIGITAL_BASE_URL = process.env.MUNIDIGITAL_BASE_URL || defaultMuniDigitalBaseUrl(MUNIDIGITAL_ENV);
const MUNIDIGITAL_ACCESS = process.env.MUNIDIGITAL_ACCESS || '';
const MUNIDIGITAL_SECRET = process.env.MUNIDIGITAL_SECRET || '';
const MUNIDIGITAL_TIMEOUT_MS = Number(process.env.MUNIDIGITAL_TIMEOUT_MS || '30000');

const STATES = {
  WELCOME: 'WELCOME',
  MAIN_MENU: 'MAIN_MENU',
  CLAIM_NEW: 'CLAIM_NEW',
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

const muniDigitalClient = createMuniDigitalClient({
  baseUrl: MUNIDIGITAL_BASE_URL,
  access: MUNIDIGITAL_ACCESS,
  secret: MUNIDIGITAL_SECRET,
  timeoutMs: MUNIDIGITAL_TIMEOUT_MS
});

const lightingFlow = createFlowHelpers({
  updateSession,
  setState,
  getSession,
  getPhoneCandidate,
  catalogEnvironment: MUNIDIGITAL_ENV,
  saveImageFromIncoming: async (options = {}) => {
    if (!options.incomingMessage) {
      return null;
    }

    return storeIncomingImage(options.incomingMessage, {
      uploadsRoot: UPLOADS_DIR,
      userId: options.userId
    });
  },
  submitLightingClaim: async ({ payload, photo }) => {
    const images = photo && photo.path ? [photo.path] : [];
    try {
      const response = await muniDigitalClient.submitIncident({
        payload,
        images
      });
      logMuniDigitalSubmissionResult({
        payload,
        hasPhoto: images.length > 0,
        response
      });
      return response;
    } catch (error) {
      logMuniDigitalSubmissionResult({
        payload,
        hasPhoto: images.length > 0,
        error
      });
      throw error;
    }
  }
});

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

function normalizeEnvironment(value = '') {
  return String(value).trim().toUpperCase() === 'PROD' ? 'PROD' : 'TEST';
}

function defaultMuniDigitalBaseUrl(environmentName) {
  return environmentName === 'PROD'
    ? 'https://munidigital.com/MuniDigitalCore'
    : 'https://test.munidigital.net/MuniDigitalCore';
}

function extractPhoneFromUserId(userId = '') {
  const match = String(userId).match(/^(\d+)@/);
  return match ? match[1] : '';
}

function getPhoneCandidate(userId, options = {}) {
  const fromOptions = normalizeInput(options.phoneCandidate);
  if (fromOptions) {
    return fromOptions;
  }

  const fromUserId = extractPhoneFromUserId(userId);
  return fromUserId || 'No disponible';
}

function isLoopbackRequest(req) {
  const candidates = [
    req.ip,
    req.socket && req.socket.remoteAddress,
    req.connection && req.connection.remoteAddress
  ].filter(Boolean);

  return candidates.some((value) => {
    const normalized = String(value);
    return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
  });
}

function extractLocationFromIncoming(incoming) {
  if (!incoming) {
    return null;
  }

  const candidates = [incoming.location, incoming._data, incoming].filter(Boolean);
  for (const candidate of candidates) {
    const latitude = candidate.latitude ?? candidate.lat;
    const longitude = candidate.longitude ?? candidate.lng;
    if (latitude !== undefined && longitude !== undefined) {
      return {
        latitude: Number(latitude),
        longitude: Number(longitude)
      };
    }
  }

  return null;
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

function showMainMenu() {
  return [
    'Hola. Gracias por comunicarse con Movilidad Urbana Posadas.',
    '',
    'Elija una opción:',
    '1. Hacer un reclamo',
    '2. Ayuda para usar MuniDigital',
    '3. Atención telefónica',
    '4. Hablar con un operador',
    '',
    'Escriba MENU para volver al menu principal en cualquier momento.'
  ].join('\n');
}

function fallbackMessage() {
  return [
    'No pudimos interpretar su respuesta.',
    '',
    'Por favor, intente nuevamente con una opción válida o escriba MENU para volver al menu principal.'
  ].join('\n');
}

function buildReply(text, options = {}) {
  return {
    text,
    mediaPath: options.mediaPath || '',
    mediaType: options.mediaType || ''
  };
}

function replyText(reply) {
  if (!reply) {
    return '';
  }

  return typeof reply === 'string' ? reply : normalizeInput(reply.text);
}

function replyMediaPath(reply) {
  if (!reply || typeof reply === 'string') {
    return '';
  }

  return normalizeInput(reply.mediaPath);
}

function replyMediaType(reply) {
  if (!reply || typeof reply === 'string') {
    return '';
  }

  return normalizeInput(reply.mediaType);
}

function buildRegisterHelpReply(text) {
  if (fs.existsSync(REGISTER_HELP_IMAGE_PATH)) {
    return buildReply(text, {
      mediaPath: REGISTER_HELP_IMAGE_PATH,
      mediaType: 'image'
    });
  }

  return text;
}

function welcomeMessage() {
  return showMainMenu();
}

function claimNewMessage() {
  return [
    'Vamos a ayudarle a iniciar un reclamo.',
    '',
    'Los reclamos se cargan en la plataforma MuniDigital, donde también podrá consultar su estado.',
    '',
    'Elija una opción:',
    '1. No tengo usuario de MuniDigital',
    '2. Tengo usuario, pero no sé cómo cargar el reclamo',
    '',
    'Escriba MENU para volver al menu principal.'
  ].join('\n');
}

function muniDigitalHelpMessage() {
  return [
    'Si necesita ayuda para usar MuniDigital, elija una opción:',
    '',
    '1. No tengo usuario de MuniDigital',
    '2. No sé cómo cargar un reclamo',
    '3. Tengo problemas con el sistema',
    '',
    'Escriba MENU para volver al menu principal.'
  ].join('\n');
}

function registerHelpMessage() {
  const text = [
    'Para hacer un reclamo primero debe crear una cuenta en MuniDigital.',
    '',
    'Puede registrarse aquí:',
    'https://munidigital.com/citizenv2/posadas/register',
    '',
    'Durante el registro se le solicitará:',
    '- Nombre y apellido',
    '- DNI',
    '- Teléfono',
    '- Correo electrónico',
    '- Fecha de nacimiento',
    '- Contraseña',
    '',
    'Escriba MENU para volver al menu principal.'
  ].join('\n');

  return buildRegisterHelpReply(text);
}

function claimTutorialMessage() {
  return [
    'Para cargar un reclamo en MuniDigital siga estos pasos:',
    '',
    '1. Ingrese a la plataforma',
    '2. Inicie sesión con su usuario',
    '3. Seleccione Solicitudes / Reclamos',
    '4. Elija el área correspondiente',
    '5. Complete los datos del problema',
    '6. Puede adjuntar fotos si es necesario',
    '',
    'Acceda aquí:',
    'https://munidigital.com/citizenv2/posadas/login',
    '',
    'Escriba MENU para volver al menu principal.'
  ].join('\n');
}

function systemProblemMessage() {
  return [
    'Si presenta problemas con la plataforma MuniDigital, puede intentar lo siguiente:',
    '',
    '- Verificar su conexión a internet',
    '- Intentar nuevamente más tarde',
    '- Probar desde otro navegador o dispositivo',
    '',
    'Si el problema continúa, puede comunicarse con un operador desde este chat.',
    '',
    'Escriba MENU para volver al menu principal.'
  ].join('\n');
}

function phoneSupportMessage() {
  return [
    'Si prefiere realizar su consulta o reclamo por teléfono, puede comunicarse con el 0800 de la Municipalidad de Posadas.',
    '',
    '0800-888-2483 (CIUDAD)',
    '',
    'Horario de atención:',
    'Lunes a viernes',
    '07:00 a 19:00 hs',
    '',
    'A través de este número puede realizar:',
    '- consultas',
    '- reclamos',
    '- sugerencias',
    '',
    'Para urgencias de tránsito (Guardia 24 hs):',
    '3765-268999',
    '',
    'Escriba MENU para volver al menu principal.'
  ].join('\n');
}

function operatorContactMessage() {
  return [
    'Su consulta será derivada a un operador de Movilidad Urbana.',
    '',
    'Un agente revisará su mensaje y responderá por este mismo medio.',
    'Debido a la cantidad de consultas, la respuesta puede demorar.',
    '',
    'Recuerde que:',
    '- Los reclamos se cargan en MuniDigital',
    '- El seguimiento del reclamo se realiza desde esa plataforma',
    '',
    'Si necesita volver al menu principal, escriba MENU.'
  ].join('\n');
}

function retryMessage(nextStepMessage) {
  return [fallbackMessage(), '', nextStepMessage].join('\n');
}

function shouldReturnToMenuOnNextMessage(state) {
  return [
    STATES.REGISTER_HELP,
    STATES.CLAIM_TUTORIAL,
    STATES.SYSTEM_PROBLEM,
    STATES.PHONE_SUPPORT
  ].includes(state);
}

async function processMessage(userId, rawText, options = {}) {
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

  if (lightingFlow.isLightingState(session.state)) {
    return lightingFlow.handleLightingFlow(userId, text, {
      ...options,
      userId
    });
  }

  switch (session.state) {
    case STATES.MAIN_MENU:
      return handleMainMenu(userId, text, channel);
    case STATES.CLAIM_NEW:
      return handleClaimNew(userId, text);
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
      setState(userId, lightingFlow.FLOW_STATES.LIGHTING_INTRO);
      return lightingFlow.lightingIntroMessage();
    case '2':
      setState(userId, STATES.MUNIDIGITAL_HELP);
      return muniDigitalHelpMessage();
    case '3':
      setState(userId, STATES.PHONE_SUPPORT);
      return phoneSupportMessage();
    case '4':
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
    'Su mensaje fue registrado para ser atendido por un operador.',
    '',
    'Si desea volver al menu principal, escriba MENU.'
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

function adminTestRouteMiddleware(req, res, next) {
  if (!ADMIN_TEST_ROUTES_ENABLED) {
    return res.status(404).json({ error: 'Ruta no disponible' });
  }

  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: 'Ruta permitida solo desde localhost' });
  }

  return adminAuthMiddleware(req, res, next);
}

function sanitizeMuniDigitalBody(body) {
  if (body == null) {
    return null;
  }

  if (typeof body === 'string') {
    return body.length > 500 ? `${body.slice(0, 500)}...` : body;
  }

  if (Array.isArray(body)) {
    return body.slice(0, 10);
  }

  return body;
}

function logMuniDigitalSubmissionResult(context) {
  const payload = context && context.payload ? context.payload : {};
  const safeSummary = {
    direction: payload.direccion || '',
    incidentTypeId: payload.tipoIncidenteId || null,
    latitude: payload.latitud || '',
    longitude: payload.longitud || '',
    hasPhoto: Boolean(context && context.hasPhoto)
  };

  if (context && context.error) {
    console.error('MuniDigital submit error', {
      status: context.error.status || null,
      message: context.error.message,
      responseBody: sanitizeMuniDigitalBody(context.error.responseBody),
      claim: safeSummary
    });
    return;
  }

  console.log('MuniDigital submit ok', {
    status: context.response ? context.response.status : null,
    body: sanitizeMuniDigitalBody(context.response ? context.response.body : null),
    claim: safeSummary
  });
}

function buildAdminLightingPayload(input = {}) {
  const direccion = normalizeInput(input.direccion || input.address);
  const observacionesBase = normalizeInput(input.observaciones || input.observations);
  const telefono = normalizeInput(input.telefono || input.phone);
  const latitud = input.latitud ?? input.latitude;
  const longitud = input.longitud ?? input.longitude;
  const tipoIncidenteId = Number(input.tipoIncidenteId);

  if (!direccion) {
    throw new Error('direccion es obligatoria');
  }

  if (!Number.isFinite(tipoIncidenteId)) {
    throw new Error('tipoIncidenteId es obligatorio');
  }

  if (latitud === undefined || latitud === null || latitud === '') {
    throw new Error('latitud es obligatoria');
  }

  if (longitud === undefined || longitud === null || longitud === '') {
    throw new Error('longitud es obligatoria');
  }

  const observations = [
    `Direccion informada: ${direccion}`,
    telefono ? `Telefono de contacto: ${telefono}` : '',
    observacionesBase || '',
    'Reclamo generado desde endpoint admin de prueba.'
  ].filter(Boolean).join(' ');

  const areaServicioId = MUNIDIGITAL_ENV === 'PROD' ? 6878 : 7916;
  const origenId = MUNIDIGITAL_ENV === 'PROD' ? null : 149;

  return {
    direccion,
    areaServicioId,
    tipoIncidenteId,
    prioridadId: null,
    identificadorId: null,
    origenId,
    localidad: 'Posadas',
    latitud: String(latitud),
    longitud: String(longitud),
    observaciones: observations,
    pais: 'Argentina',
    barrio: ''
  };
}

async function startWhatsAppBridge() {
  if (!WHATSAPP_ENABLED) {
    return;
  }

  let Client;
  let LocalAuth;
  let MessageMedia;
  let qrcode;

  try {
    ({ Client, LocalAuth, MessageMedia } = require('whatsapp-web.js'));

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

    const location = extractLocationFromIncoming(incoming);
    if (!text && !location && !incoming.hasMedia) {
      console.log(`Mensaje sin texto util desde ${incoming.from}`);
      return;
    }

    const reply = await processMessage(incoming.from, text, {
      channel: 'whatsapp',
      incomingMessage: incoming,
      location,
      phoneCandidate: extractPhoneFromUserId(incoming.from)
    });
    const textReply = replyText(reply);
    const mediaPath = replyMediaPath(reply);
    if (!textReply && !mediaPath) {
      console.log(`Sin respuesta generada para ${incoming.from}`);
      return;
    }

    try {
      console.log(`Respondiendo a ${incoming.from}`);
      if (mediaPath && MessageMedia) {
        const media = MessageMedia.fromFilePath(mediaPath);
        await client.sendMessage(incoming.from, media, {
          caption: textReply || undefined
        });
      } else {
        await client.sendMessage(incoming.from, textReply);
      }
    } catch (error) {
      console.error(`No se pudo responder a ${incoming.from}:`, error);
    }
  });

  await client.initialize();
}

app.post('/webhook/message', async (req, res) => {
  try {
    const userId = normalizeInput(req.body.userId);
    const message = normalizeInput(req.body.message);

    if (!userId) {
      return res.status(400).json({ error: 'userId es obligatorio' });
    }

    const reply = await processMessage(userId, message, {
      channel: 'api',
      location: req.body.location || null,
      phoneCandidate: req.body.phoneCandidate || ''
    });
    const session = getSession(userId);

    return res.json({
      ok: true,
      userId,
      state: session.state,
      reply: replyText(reply),
      attachment: replyMediaPath(reply)
        ? {
            type: replyMediaType(reply) || 'image',
            fileName: path.basename(replyMediaPath(reply))
          }
        : null
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

app.post('/admin/lighting/test-submit', adminTestRouteMiddleware, async (req, res) => {
  try {
    const payload = buildAdminLightingPayload(req.body || {});
    const rawImagePaths = Array.isArray(req.body && req.body.imagePaths) ? req.body.imagePaths : [];
    const imagePaths = rawImagePaths
      .map((value) => normalizeInput(value))
      .filter(Boolean)
      .map((value) => path.resolve(__dirname, value));

    const response = await muniDigitalClient.submitIncident({
      payload,
      images: imagePaths
    });

    logMuniDigitalSubmissionResult({
      payload,
      hasPhoto: imagePaths.length > 0,
      response
    });

    return res.json({
      ok: true,
      payload,
      imageCount: imagePaths.length,
      response: {
        status: response.status,
        body: sanitizeMuniDigitalBody(response.body),
        timestamp: response.timestamp
      }
    });
  } catch (error) {
    logMuniDigitalSubmissionResult({
      payload: req.body || {},
      hasPhoto: Array.isArray(req.body && req.body.imagePaths) && req.body.imagePaths.length > 0,
      error
    });

    return res.status(error.status || 500).json({
      ok: false,
      error: error.message,
      status: error.status || null,
      responseBody: sanitizeMuniDigitalBody(error.responseBody)
    });
  }
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
