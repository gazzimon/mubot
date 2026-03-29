const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = parsePort(process.env.PORT || '3000');
const DATA_FILE_PATH = process.env.DATA_FILE_PATH || path.join(__dirname, 'data', 'runtime-store.json');
const LOG_MESSAGE_BODIES = process.env.LOG_MESSAGE_BODIES === 'true';
const ADMIN_DEBUG_ENABLED = process.env.ADMIN_DEBUG_ENABLED !== 'false';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ADMIN_TOKEN_HEADER = 'x-admin-token';

const MATON_ENABLED = process.env.MATON_ENABLED === 'true';
const MATON_API_KEY = process.env.MATON_API_KEY || '';
const MATON_BASE_URL = process.env.MATON_BASE_URL || 'https://gateway.maton.ai';
const MATON_PHONE_NUMBER_ID = process.env.MATON_PHONE_NUMBER_ID || '';
const MATON_WEBHOOK_VERIFY_TOKEN = process.env.MATON_WEBHOOK_VERIFY_TOKEN || '';
const MATON_CHANNEL_NAME = 'maton_whatsapp';

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

const matonRuntime = {
  enabled: MATON_ENABLED,
  status: MATON_ENABLED ? 'configured' : 'disabled',
  baseUrl: MATON_BASE_URL,
  phoneNumberId: MATON_PHONE_NUMBER_ID || null,
  lastInboundAt: null,
  lastOutboundAt: null,
  lastEvent: null
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
    persistRuntimeStore();
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

  if (MATON_ENABLED) {
    if (!MATON_API_KEY) {
      throw new Error('MATON_API_KEY es obligatorio cuando MATON_ENABLED=true.');
    }

    if (!MATON_PHONE_NUMBER_ID) {
      throw new Error('MATON_PHONE_NUMBER_ID es obligatorio cuando MATON_ENABLED=true.');
    }

    if (!MATON_WEBHOOK_VERIFY_TOKEN) {
      throw new Error('MATON_WEBHOOK_VERIFY_TOKEN es obligatorio cuando MATON_ENABLED=true.');
    }
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

function verifyMatonWebhook(req, res) {
  const mode = normalizeInput(req.query['hub.mode']);
  const token = normalizeInput(req.query['hub.verify_token']);
  const challenge = normalizeInput(req.query['hub.challenge']);

  if (mode !== 'subscribe' || token !== MATON_WEBHOOK_VERIFY_TOKEN) {
    return res.status(403).send('Forbidden');
  }

  matonRuntime.lastEvent = {
    type: 'webhook_verification',
    timestamp: new Date().toISOString()
  };
  return res.status(200).send(challenge);
}

function extractInboundMessages(payload) {
  const messages = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const valueMessages = Array.isArray(value?.messages) ? value.messages : [];

      for (const message of valueMessages) {
        if (message?.type !== 'text' || !message?.text?.body || !message?.from) {
          continue;
        }

        messages.push({
          from: String(message.from),
          text: normalizeInput(message.text.body),
          raw: message
        });
      }
    }
  }

  return messages;
}

async function sendMatonWhatsAppMessage(to, body) {
  if (!MATON_ENABLED) {
    throw new Error('MATON_ENABLED=false. No se puede enviar el mensaje.');
  }

  const endpoint = `${MATON_BASE_URL.replace(/\/$/, '')}/whatsapp-business/v21.0/${MATON_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MATON_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    })
  });

  const responseText = await response.text();
  let data;

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (_) {
    data = { raw: responseText };
  }

  if (!response.ok) {
    throw new Error(`MATON envio fallo (${response.status}): ${responseText}`);
  }

  matonRuntime.status = 'connected';
  matonRuntime.lastOutboundAt = new Date().toISOString();
  matonRuntime.lastEvent = {
    type: 'outbound_message',
    timestamp: matonRuntime.lastOutboundAt,
    to
  };

  return data;
}

async function handleMatonInboundWebhook(req, res) {
  try {
    const messages = extractInboundMessages(req.body);
    matonRuntime.lastInboundAt = new Date().toISOString();
    matonRuntime.lastEvent = {
      type: 'inbound_webhook',
      timestamp: matonRuntime.lastInboundAt,
      messageCount: messages.length
    };

    if (!messages.length) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    for (const incoming of messages) {
      console.log(`Mensaje entrante MATON desde ${incoming.from} ${summarizeBodyForLogs(incoming.text)}`);

      if (!incoming.text) {
        continue;
      }

      const reply = processMessage(incoming.from, incoming.text, { channel: MATON_CHANNEL_NAME });
      if (!reply) {
        continue;
      }

      await sendMatonWhatsAppMessage(incoming.from, reply);
    }

    return res.status(200).json({ ok: true, processed: messages.length });
  } catch (error) {
    matonRuntime.status = 'error';
    matonRuntime.lastEvent = {
      type: 'inbound_error',
      timestamp: new Date().toISOString(),
      message: error.message
    };
    console.error('Error procesando webhook de MATON:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
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

app.get('/webhook/maton/whatsapp', verifyMatonWebhook);
app.post('/webhook/maton/whatsapp', handleMatonInboundWebhook);

app.get('/admin/debug', adminAuthMiddleware, (_req, res) => {
  res.json({
    sessions: Array.from(sessions.values()),
    reiterations,
    operatorQueue,
    maton: {
      enabled: matonRuntime.enabled,
      status: matonRuntime.status,
      baseUrl: matonRuntime.baseUrl,
      phoneNumberId: matonRuntime.phoneNumberId,
      lastInboundAt: matonRuntime.lastInboundAt,
      lastOutboundAt: matonRuntime.lastOutboundAt,
      lastEvent: matonRuntime.lastEvent
    }
  });
});

const server = app.listen(PORT, () => {
  console.log(`Chatbot escuchando en http://localhost:${PORT}`);
  if (MATON_ENABLED) {
    console.log(`Webhook MATON listo en http://localhost:${PORT}/webhook/maton/whatsapp`);
  } else {
    console.log('MATON esta deshabilitado. Solo quedan activos los webhooks de prueba HTTP.');
  }
});

server.on('error', (error) => {
  console.error('No se pudo iniciar el servidor HTTP:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('Cerrando servidor...');
  process.exit(0);
});
