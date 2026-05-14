const { getLightingCatalog } = require('./alumbradoCatalog');
const { searchAddress, reverseGeocode } = require('../services/geocodingService');
const { bold, italic, underline, joinFormattedText } = require('../utils/messageFormatting');

const FLOW_STATES = {
  LIGHTING_INTRO: 'LIGHTING_INTRO',
  CLAIM_WAIT_ADDRESS_OR_LOCATION: 'CLAIM_WAIT_ADDRESS_OR_LOCATION',
  CLAIM_WAIT_ADDRESS_SELECTION: 'CLAIM_WAIT_ADDRESS_SELECTION',
  CLAIM_CONFIRM_ADDRESS: 'CLAIM_CONFIRM_ADDRESS',
  CLAIM_WAIT_NEIGHBORHOOD: 'CLAIM_WAIT_NEIGHBORHOOD',
  LIGHTING_WAIT_PHOTO: 'LIGHTING_WAIT_PHOTO',
  LIGHTING_WAIT_INCIDENT_TYPE: 'LIGHTING_WAIT_INCIDENT_TYPE',
  LIGHTING_WAIT_DETAILS: 'LIGHTING_WAIT_DETAILS',
  LIGHTING_WAIT_PHONE: 'LIGHTING_WAIT_PHONE',
  LIGHTING_WAIT_DNI: 'LIGHTING_WAIT_DNI',
  LIGHTING_CONFIRMATION: 'LIGHTING_CONFIRMATION',
  LIGHTING_CORRECTION_MENU: 'LIGHTING_CORRECTION_MENU',
  LIGHTING_SUBMITTED: 'LIGHTING_SUBMITTED'
};

const MAX_ADDRESS_ATTEMPTS = 3;
const CLAIM_PROGRESS_TOTAL_STEPS = 8;

function createFlowHelpers(dependencies) {
  const {
    updateSession,
    setState,
    getSession,
    catalogEnvironment,
    saveImageFromIncoming,
    recordClaimTrackingEntry,
    submitLightingClaim
  } = dependencies;

  const catalog = getLightingCatalog(catalogEnvironment);

  function formatProgressHeader(step, title) {
    return [bold(`Paso ${step}/${CLAIM_PROGRESS_TOTAL_STEPS} - ${title}`), ''].join('\n');
  }

  function withProgress(message, step, title) {
    return [formatProgressHeader(step, title), message].join('\n');
  }

  function lightingIntroMessage() {
    return withProgress([
      bold('Vamos a registrar un reclamo de alumbrado público en MuniDigital.'),
      '',
      'Le vamos a pedir:',
      '- Dirección o ubicación del incidente',
      '- Foto del problema',
      '- Tipo de problema',
      '- Una breve descripción',
      '- Datos de contacto',
      '',
      'Para comenzar, escriba 1.',
      '',
      '1. Iniciar reclamo de alumbrado',
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 1, 'Inicio del reclamo');
  }

  function addressOrLocationMessage() {
    return withProgress([
      'Escriba la dirección exacta del incidente dentro de Posadas.',
      '',
      'Necesitamos ubicar el lugar donde está el artefacto a reparar o modificar.',
      '',
      'Si está en el lugar, también puede compartir su ubicación actual desde WhatsApp.',
      '',
      'Si hay más de un artefacto afectado en lugares distintos, cargue un reclamo por cada uno.',
      '',
      italic('Ejemplo: Av. Corrientes 2030'),
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 2, 'Direccion del incidente');
  }

  function shareLocationMessage() {
    return withProgress([
      'Comparta su ubicación actual desde WhatsApp.',
      '',
      'Si prefiere escribir la dirección, envíela directamente en este chat.',
      '',
      italic('Ejemplo: Av. Corrientes 2030.'),
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 2, 'Direccion del incidente');
  }

  function addressDisambiguationMessage(options) {
    return withProgress([
      bold('Encontramos varias ubicaciones similares en Posadas.'),
      'Elija una opción:',
      ...options.map((item, index) => {
        const locationLink = buildLocationLink(item.latitude, item.longitude);
        return `${index + 1}. ${formatAddressForLookup(item)}\nUbicación: ${locationLink}`;
      }),
      `${options.length + 1}. Ninguna de estas, quiero escribir otra dirección`,
      '',
      'También puede compartir su ubicación actual desde WhatsApp.',
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 2, 'Direccion del incidente');
  }

  function buildLocationLink(latitude, longitude) {
    return `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
  }

  function formatAddressForLookup(candidate = {}) {
    return candidate.displayAddress || candidate.address || 'Direccion no disponible';
  }

  function addressConfirmationMessage(candidate) {
    const locationLink = buildLocationLink(candidate.latitude, candidate.longitude);
    return withProgress([
      bold('Encontré esta ubicación en Posadas:'),
      formatAddressForLookup(candidate),
      `Ubicación: ${locationLink}`,
      '',
      'Revise que el punto del mapa corresponda al lugar exacto del artefacto.',
      '',
      'Responda:',
      '1. Confirmar esta ubicación',
      '2. Escribir otra dirección',
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 3, 'Confirmacion de ubicacion');
  }

  function neighborhoodMessage() {
    return withProgress([
      bold('No pudimos identificar el barrio automáticamente.'),
      '',
      'Indique el barrio del incidente.',
      '',
      italic('Ejemplo: Centro'),
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 3, 'Confirmacion de ubicacion');
  }

  function photoRequestMessage() {
    return withProgress([
      bold('Dirección confirmada.'),
      '',
      'Ahora envíe una foto del incidente.',
      '',
      'La foto debe mostrar el artefacto a reparar o modificar y es obligatoria para cargar el reclamo.',
      'Si es posible, incluya una referencia del lugar.',
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 4, 'Foto del incidente');
  }

  function incidentTypeMessage(serviceArea) {
    return withProgress([
      bold(`Seleccione el tipo de incidente de ${serviceArea.label.toLowerCase()}:`),
      '',
      ...serviceArea.incidentTypes.map((item) => `${item.menuOption}. ${item.label}`),
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 5, 'Tipo de incidente');
  }

  function detailsMessage() {
    return withProgress([
      'Describa brevemente el problema.',
      'No hace falta repetir la dirección.',
      '',
      italic('Ejemplo: La luminaria está apagada desde hace tres días.'),
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 6, 'Descripcion del problema');
  }

  function phoneRequestMessage() {
    return withProgress([
      'Indique un teléfono de contacto con característica.',
      '',
      italic('Ejemplo: 3765123456'),
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 7, 'Telefono de contacto');
  }

  function dniRequestMessage() {
    return withProgress([
      'Para finalizar, indique su DNI.',
      '',
      'Este dato se utiliza para registrar el reclamo en MuniDigital y facilitar el seguimiento.',
      '',
      'Ingrese solo números, sin puntos.',
      '',
      italic('Ejemplo: 37770375'),
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 8, 'Documento');
  }

  function semaforosUnavailableMessage() {
    return [
      bold('La opción de semáforos aún no está disponible en este flujo.'),
      '',
      'Todavía faltan sus códigos de MuniDigital.',
      '',
      joinFormattedText([
        'Por el momento puede cargar un reclamo de alumbrado o escribir ',
        underline('MENU'),
        ' para volver al menu principal.'
      ])
    ].join('\n');
  }

  function invalidPhotoMessage() {
    return withProgress([
      bold('Necesito una foto válida del incidente para continuar.'),
      '',
      'Desde WhatsApp, toque el ícono de adjuntar o la cámara y envíe una imagen del artefacto.',
      '',
      'La foto es obligatoria para cargar el reclamo.',
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n'), 4, 'Foto del incidente');
  }

  function invalidAddressMessage() {
    return withProgress([
      bold('No pudimos ubicar esa dirección dentro de Posadas.'),
      '',
      'Puede intentar de estas formas:',
      '',
      '1. Escribir una dirección más completa',
      '2. Compartir su ubicación actual desde WhatsApp',
      '',
      italic('Ejemplo: Av. Corrientes 2030.')
    ].join('\n'), 2, 'Direccion del incidente');
  }

  function weakAddressMessage() {
    return withProgress([
      bold('La dirección parece incompleta o poco precisa.'),
      '',
      'Puede intentar de estas formas:',
      '',
      '1. Escribir una dirección con altura o referencia',
      '2. Compartir su ubicación actual desde WhatsApp',
      '',
      italic('Ejemplo: Av. Corrientes 2030.')
    ].join('\n'), 2, 'Direccion del incidente');
  }

  function addressAttemptsExceededMessage() {
    return withProgress([
      bold('Todavía no pudimos validar la dirección con precisión dentro de Posadas.'),
      '',
      'Puede intentar de estas formas:',
      '',
      '1. Escribir una dirección más completa',
      '2. Compartir su ubicación actual desde WhatsApp',
      '3. Volver al menu principal',
      '',
      italic('Ejemplo: Av. Corrientes 2030.')
    ].join('\n'), 2, 'Direccion del incidente');
  }

  function invalidLocationMessage() {
    return withProgress([
      bold('La ubicación compartida no corresponde a Posadas o no pudo validarse.'),
      '',
      'Por favor envíe una dirección dentro de Posadas o comparta otra ubicación.'
    ].join('\n'), 2, 'Direccion del incidente');
  }

  function retryMessage(nextStepMessage) {
    return [
      bold('No pudimos interpretar su respuesta.'),
      '',
      nextStepMessage
    ].join('\n');
  }

  function errorMessage() {
    return [
      bold('No pudimos enviar el reclamo a MuniDigital en este momento.'),
      '',
      'Sus datos quedaron guardados en esta conversación.',
      '',
      'Responda:',
      '1. Reintentar envío',
      '2. Cancelar',
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n');
  }

  function isLightingState(state) {
    return Object.values(FLOW_STATES).includes(state);
  }

  function updateLightingContext(userId, patch) {
    const session = getSession(userId);
    updateSession(userId, {
      context: {
        ...session.context,
        lightingClaim: {
          ...(session.context.lightingClaim || {}),
          ...patch
        }
      }
    });
  }

  function clearLightingContext(userId) {
    updateSession(userId, {
      context: {
        ...getSession(userId).context,
        lightingClaim: null
      }
    });
  }

  function getLightingContext(userId) {
    return getSession(userId).context.lightingClaim || {};
  }

  function getServiceAreaByMenuOption(text) {
    return catalog.serviceAreas.find((item) => item.menuOption === text);
  }

  function getServiceAreaByKey(key) {
    return catalog.serviceAreas.find((item) => item.key === key) || null;
  }

  function hasCompatibleClaimContext(claim = {}) {
    if (!claim || typeof claim !== 'object') {
      return false;
    }

    return Boolean(getServiceAreaByKey(claim.serviceArea));
  }

  function hasConfirmedLocation(claim = {}) {
    return Boolean(
      claim &&
      claim.location &&
      claim.location.latitude !== undefined &&
      claim.location.longitude !== undefined
    );
  }

  function findIncidentTypeByMenuOption(serviceArea, text) {
    return serviceArea.incidentTypes.find((item) => item.menuOption === text);
  }

  function normalizePhone(value = '') {
    return String(value).replace(/\D/g, '');
  }

  function isValidPhone(value = '') {
    const normalized = normalizePhone(value);
    return normalized.length >= 10 && normalized.length <= 15;
  }

  function normalizeDni(value = '') {
    return String(value).replace(/\D/g, '');
  }

  function isValidDni(value = '') {
    const normalized = normalizeDni(value);
    return normalized.length >= 7 && normalized.length <= 10;
  }

  function isWeakAddressText(text = '') {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return true;
    }

    if (normalized.length < 6) {
      return true;
    }

    return !/\d/.test(normalized);
  }

  function buildPayload(claim) {
    const serviceArea = getServiceAreaByKey(claim.serviceArea);
    if (!serviceArea) {
      throw new Error('El reclamo no tiene un area de servicio valida.');
    }

    if (!claim.location || claim.location.latitude === undefined || claim.location.longitude === undefined) {
      throw new Error('El reclamo no tiene una ubicacion valida.');
    }

    return {
      direccion: claim.address,
      areaServicioId: serviceArea.areaServicioId,
      tipoIncidenteId: claim.incidentTypeId,
      prioridadId: serviceArea.prioridadId,
      origenId: serviceArea.origenId,
      localidad: catalog.localidad,
      latitud: String(claim.location.latitude),
      longitud: String(claim.location.longitude),
      observaciones: claim.observations,
      pais: catalog.pais,
      barrio: claim.neighborhood,
      ciudadano: {
        nombre: '',
        apellido: '',
        email: '',
        telefono: claim.phone,
        dni: claim.dni,
        cuit: ''
      }
    };
  }

  function formatSubmissionSummary(submission) {
    const claimNumber = extractSubmissionClaimNumber(submission);
    if (claimNumber) {
      return `Numero de reclamo: ${claimNumber}`;
    }

    const body = submission && submission.body;
    if (!body) {
      return 'La API respondio correctamente.';
    }

    if (typeof body === 'string') {
      return `Respuesta API: ${body}`;
    }

    const candidates = [
      body.mensaje
    ].filter(Boolean);

    if (!candidates.length) {
      return 'La API respondio correctamente.';
    }

    return `Respuesta API: ${candidates.join(' | ')}`;
  }

  function extractSubmissionClaimNumber(submission) {
    const body = submission && submission.body;
    if (!body || typeof body !== 'object') {
      return '';
    }

    const claimNumber = [
      body.result,
      body.numero,
      body.id,
      body.incidenteId,
      body.reclamoId
    ].find((value) => value !== undefined && value !== null && String(value).trim() !== '');

    return claimNumber == null ? '' : String(claimNumber);
  }

  function successMessage(submission) {
    const claimNumber = extractSubmissionClaimNumber(submission);
    if (claimNumber) {
      return [
        bold('Reclamo registrado correctamente.'),
        '',
        `Número: ${claimNumber}`,
        '',
        'Guarde este número para consultar el estado en MuniDigital.',
        '',
        `Si desea iniciar otro reclamo, escriba ${underline('MENU')}.`
      ].join('\n');
    }

    return [
      bold('Reclamo registrado correctamente.'),
      '',
      formatSubmissionSummary(submission),
      '',
      `Si desea iniciar otro reclamo, escriba ${underline('MENU')}.`
    ].join('\n');
  }

  function summaryMessage(userId) {
    const claim = getLightingContext(userId);
    const serviceArea = getServiceAreaByKey(claim.serviceArea);
    const incidentType = serviceArea
      ? serviceArea.incidentTypes.find((item) => item.id === claim.incidentTypeId)
      : null;
    const payload = buildPayload(claim);
    const locationLink = buildLocationLink(payload.latitud, payload.longitud);

    updateLightingContext(userId, { payloadPreview: payload });

    return [
      bold('Revisemos el reclamo antes de enviarlo'),
      '',
      `Dirección: ${formatAddressForLookup({ address: claim.address, displayAddress: claim.displayAddress })}`,
      `Ubicación: ${locationLink}`,
      `Tipo: ${incidentType ? incidentType.label : 'No informado'}`,
      `Descripción: ${claim.observations}`,
      `Foto: ${claim.photo ? 'Sí' : 'No'}`,
      `Teléfono: ${claim.phone}`,
      `DNI: ${claim.dni}`,
      '',
      'Si todo está correcto, confirme el envío.',
      '',
      'Responda:',
      '1. Confirmar y enviar',
      '2. Corregir un dato',
      '3. Cancelar',
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n');
  }

  function correctionMenuMessage() {
    return [
      bold('¿Qué dato desea corregir?'),
      '',
      '1. Dirección o ubicación',
      '2. Foto del incidente',
      '3. Tipo de incidente',
      '4. Descripción del problema',
      '5. Teléfono de contacto',
      '6. DNI',
      '7. Volver al resumen',
      '',
      `Escriba ${underline('MENU')} para volver al menu principal.`
    ].join('\n');
  }

  function returnToSummaryAfterCorrection(userId, message) {
    const claim = getLightingContext(userId);
    if (!claim.returnToSummaryAfterCorrection) {
      return null;
    }

    updateLightingContext(userId, { returnToSummaryAfterCorrection: false });
    setState(userId, FLOW_STATES.LIGHTING_CONFIRMATION);
    return [message, '', summaryMessage(userId)].join('\n');
  }

  function continueAfterCorrectionOrNext(userId, nextState, nextMessage, updatedMessage) {
    const correctionMessage = returnToSummaryAfterCorrection(userId, updatedMessage);
    if (correctionMessage) {
      return correctionMessage;
    }

    setState(userId, nextState);
    return nextMessage;
  }

  async function resolveAddressCandidate(text, options) {
    const candidates = await searchAddress(text);
    if (!candidates.length) {
      return { type: 'none' };
    }

    if (isWeakAddressText(text)) {
      return { type: 'weak' };
    }

    if (candidates.length > 1) {
      return {
        type: 'multiple',
        candidates: candidates.slice(0, 3)
      };
    }

    return {
      type: 'single',
      candidate: candidates[0]
    };
  }

  async function resolveLocationCandidate(location) {
    if (!location) {
      return null;
    }

    const candidate = await reverseGeocode(location.latitude, location.longitude);
    if (!candidate) {
      return null;
    }

    return {
      ...candidate,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude)
    };
  }

  function incrementAddressAttempts(userId) {
    const claim = getLightingContext(userId);
    const nextAttempts = Number(claim.addressAttempts || 0) + 1;
    updateLightingContext(userId, { addressAttempts: nextAttempts });
    return nextAttempts;
  }

  function resetAddressAttempts(userId) {
    updateLightingContext(userId, { addressAttempts: 0 });
  }

  function isNeighborhoodKnown(value = '') {
    return String(value || '').trim().length > 0;
  }

  async function handleLightingFlow(userId, text, options = {}) {
    const session = getSession(userId);
    const claim = getLightingContext(userId);

    if (
      session.state !== FLOW_STATES.LIGHTING_INTRO &&
      !hasCompatibleClaimContext(claim)
    ) {
      clearLightingContext(userId);
      setState(userId, FLOW_STATES.LIGHTING_INTRO);
      return [
        'Reiniciamos el reclamo porque habia datos anteriores incompletos o de una version previa del flujo.',
        '',
        lightingIntroMessage()
      ].join('\n');
    }

    if (
      [
        FLOW_STATES.CLAIM_WAIT_NEIGHBORHOOD,
        FLOW_STATES.LIGHTING_WAIT_PHOTO,
        FLOW_STATES.LIGHTING_WAIT_INCIDENT_TYPE,
        FLOW_STATES.LIGHTING_WAIT_DETAILS,
        FLOW_STATES.LIGHTING_WAIT_PHONE,
        FLOW_STATES.LIGHTING_WAIT_DNI,
        FLOW_STATES.LIGHTING_CONFIRMATION,
        FLOW_STATES.LIGHTING_CORRECTION_MENU,
        FLOW_STATES.LIGHTING_SUBMITTED
      ].includes(session.state) &&
      !hasConfirmedLocation(claim)
    ) {
      clearLightingContext(userId);
      setState(userId, FLOW_STATES.LIGHTING_INTRO);
      return [
        'Reiniciamos el reclamo porque faltaba la ubicación confirmada de una versión previa del flujo.',
        '',
        lightingIntroMessage()
      ].join('\n');
    }

    switch (session.state) {
      case FLOW_STATES.LIGHTING_INTRO: {
        const serviceArea = getServiceAreaByMenuOption(text);
        if (!serviceArea) {
          return retryMessage(lightingIntroMessage());
        }

        if (!serviceArea.enabled) {
          clearLightingContext(userId);
          setState(userId, 'MAIN_MENU');
          return semaforosUnavailableMessage();
        }

        updateLightingContext(userId, {
          startedAt: new Date().toISOString(),
          channel: options.channel || 'unknown',
          serviceArea: serviceArea.key,
          serviceAreaLabel: serviceArea.label,
          photo: null,
          address: '',
          displayAddress: '',
          neighborhood: '',
          observations: '',
          phone: '',
          dni: '',
          returnToSummaryAfterCorrection: false,
          addressAttempts: 0
        });
        setState(userId, FLOW_STATES.CLAIM_WAIT_ADDRESS_OR_LOCATION);
        return addressOrLocationMessage();
      }

      case FLOW_STATES.CLAIM_WAIT_ADDRESS_OR_LOCATION: {
        if (text === '1') {
          return addressOrLocationMessage();
        }

        if (text === '2') {
          return shareLocationMessage();
        }

        if (text === '3') {
          clearLightingContext(userId);
          setState(userId, 'MAIN_MENU');
          return 'Volvimos al menu principal. Escriba MENU para verlo nuevamente.';
        }

        if (options.location) {
          try {
            const candidate = await resolveLocationCandidate(options.location);
            if (!candidate) {
              return invalidLocationMessage();
            }

            updateLightingContext(userId, {
              addressCandidate: candidate,
              addressOptions: null,
              rawAddressInput: ''
            });
            resetAddressAttempts(userId);
            setState(userId, FLOW_STATES.CLAIM_CONFIRM_ADDRESS);
            return addressConfirmationMessage(candidate);
          } catch (_) {
            const attempts = incrementAddressAttempts(userId);
            return attempts >= MAX_ADDRESS_ATTEMPTS ? addressAttemptsExceededMessage() : invalidLocationMessage();
          }
        }

        if (!text) {
          return retryMessage(addressOrLocationMessage());
        }

        try {
          const result = await resolveAddressCandidate(text, options);
          if (result.type === 'none') {
            const attempts = incrementAddressAttempts(userId);
            return attempts >= MAX_ADDRESS_ATTEMPTS ? addressAttemptsExceededMessage() : invalidAddressMessage();
          }

          if (result.type === 'weak') {
            const attempts = incrementAddressAttempts(userId);
            return attempts >= MAX_ADDRESS_ATTEMPTS ? addressAttemptsExceededMessage() : weakAddressMessage();
          }

          if (result.type === 'multiple') {
            updateLightingContext(userId, {
              addressOptions: result.candidates,
              rawAddressInput: text
            });
            resetAddressAttempts(userId);
            setState(userId, FLOW_STATES.CLAIM_WAIT_ADDRESS_SELECTION);
            return addressDisambiguationMessage(result.candidates);
          }

          updateLightingContext(userId, {
            addressCandidate: result.candidate,
            addressOptions: null,
            rawAddressInput: text
          });
          resetAddressAttempts(userId);
          setState(userId, FLOW_STATES.CLAIM_CONFIRM_ADDRESS);
          return addressConfirmationMessage(result.candidate);
        } catch (_) {
          const attempts = incrementAddressAttempts(userId);
          if (attempts >= MAX_ADDRESS_ATTEMPTS) {
            return addressAttemptsExceededMessage();
          }

          return withProgress([
            'No pudimos validar la dirección en este momento.',
            '',
            'Puede intentar de estas formas:',
            '',
            '1. Escribir una dirección más completa',
            '2. Compartir su ubicación actual desde WhatsApp',
            '',
            'Intente nuevamente en unos instantes.'
          ].join('\n'), 2, 'Direccion del incidente');
        }
      }

      case FLOW_STATES.CLAIM_WAIT_ADDRESS_SELECTION: {
        const currentClaim = getLightingContext(userId);
        const optionsList = Array.isArray(currentClaim.addressOptions) ? currentClaim.addressOptions : [];
        const selection = Number(text);

        if (!Number.isInteger(selection) || selection < 1 || selection > optionsList.length + 1) {
          return retryMessage(addressDisambiguationMessage(optionsList));
        }

        if (selection === optionsList.length + 1) {
          setState(userId, FLOW_STATES.CLAIM_WAIT_ADDRESS_OR_LOCATION);
          return addressOrLocationMessage();
        }

        const candidate = optionsList[selection - 1];
        updateLightingContext(userId, {
          addressCandidate: candidate,
          addressOptions: null
        });
        setState(userId, FLOW_STATES.CLAIM_CONFIRM_ADDRESS);
        return addressConfirmationMessage(candidate);
      }

      case FLOW_STATES.CLAIM_CONFIRM_ADDRESS:
        if (text === '1') {
          const currentClaim = getLightingContext(userId);
          const candidate = currentClaim.addressCandidate;
          if (!candidate) {
            setState(userId, FLOW_STATES.CLAIM_WAIT_ADDRESS_OR_LOCATION);
            return addressOrLocationMessage();
          }

          updateLightingContext(userId, {
            address: candidate.address,
            displayAddress: formatAddressForLookup(candidate),
            location: {
              latitude: candidate.latitude,
              longitude: candidate.longitude
            },
            neighborhood: candidate.barrio || '',
            addressCandidate: null,
            addressOptions: null
          });
          if (isNeighborhoodKnown(candidate.barrio)) {
            return continueAfterCorrectionOrNext(
              userId,
              FLOW_STATES.LIGHTING_WAIT_PHOTO,
              photoRequestMessage(),
              'Dirección actualizada.'
            );
          }

          setState(userId, FLOW_STATES.CLAIM_WAIT_NEIGHBORHOOD);
          return neighborhoodMessage();
        }

        if (text === '2') {
          setState(userId, FLOW_STATES.CLAIM_WAIT_ADDRESS_OR_LOCATION);
          return addressOrLocationMessage();
        }

        return retryMessage(addressConfirmationMessage(getLightingContext(userId).addressCandidate || {
          address: 'Direccion no disponible',
          latitude: '',
          longitude: ''
        }));

      case FLOW_STATES.CLAIM_WAIT_NEIGHBORHOOD:
        if (!text) {
          return retryMessage(neighborhoodMessage());
        }

        updateLightingContext(userId, { neighborhood: text });
        return continueAfterCorrectionOrNext(
          userId,
          FLOW_STATES.LIGHTING_WAIT_PHOTO,
          photoRequestMessage(),
          'Barrio actualizado.'
        );

      case FLOW_STATES.LIGHTING_WAIT_PHOTO: {
        const photo = await saveImageFromIncoming(options);
        if (!photo) {
          return invalidPhotoMessage();
        }

        updateLightingContext(userId, { photo });
        return continueAfterCorrectionOrNext(
          userId,
          FLOW_STATES.LIGHTING_WAIT_INCIDENT_TYPE,
          incidentTypeMessage(getServiceAreaByKey(getLightingContext(userId).serviceArea)),
          'Foto actualizada.'
        );
      }

      case FLOW_STATES.LIGHTING_WAIT_INCIDENT_TYPE: {
        const currentClaim = getLightingContext(userId);
        const serviceArea = getServiceAreaByKey(currentClaim.serviceArea);
        const incidentType = serviceArea ? findIncidentTypeByMenuOption(serviceArea, text) : null;

        if (!incidentType) {
          return retryMessage(incidentTypeMessage(serviceArea));
        }

        updateLightingContext(userId, {
          incidentTypeId: incidentType.id,
          incidentTypeLabel: incidentType.label
        });
        return continueAfterCorrectionOrNext(
          userId,
          FLOW_STATES.LIGHTING_WAIT_DETAILS,
          detailsMessage(),
          'Tipo de incidente actualizado.'
        );
      }

      case FLOW_STATES.LIGHTING_WAIT_DETAILS:
        if (!text) {
          return retryMessage(detailsMessage());
        }

        updateLightingContext(userId, { observations: text });
        {
          const correctionMessage = returnToSummaryAfterCorrection(userId, 'Descripción actualizada.');
          if (correctionMessage) {
            return correctionMessage;
          }
        }

        setState(userId, FLOW_STATES.LIGHTING_WAIT_PHONE);
        return phoneRequestMessage();

      case FLOW_STATES.LIGHTING_WAIT_PHONE:
        if (!isValidPhone(text)) {
          return retryMessage(phoneRequestMessage());
        }

        updateLightingContext(userId, { phone: normalizePhone(text) });
        return continueAfterCorrectionOrNext(
          userId,
          FLOW_STATES.LIGHTING_WAIT_DNI,
          dniRequestMessage(),
          'Teléfono actualizado.'
        );

      case FLOW_STATES.LIGHTING_WAIT_DNI:
        if (!isValidDni(text)) {
          return retryMessage(dniRequestMessage());
        }

        updateLightingContext(userId, { dni: normalizeDni(text) });
        return continueAfterCorrectionOrNext(
          userId,
          FLOW_STATES.LIGHTING_CONFIRMATION,
          summaryMessage(userId),
          'DNI actualizado.'
        );

      case FLOW_STATES.LIGHTING_CONFIRMATION:
        if (text === '1') {
          const currentClaim = getLightingContext(userId);
          const payload = buildPayload(currentClaim);

          updateLightingContext(userId, {
            payloadPreview: payload,
            status: 'sending_to_munidigital'
          });

          try {
            const submission = await submitLightingClaim({
              payload,
              photo: currentClaim.photo,
              claim: currentClaim
            });

            try {
              await recordClaimTrackingEntry({
                createdAt: new Date().toISOString(),
                userId,
                channel: currentClaim.channel || '',
                status: 'ok',
                claim: currentClaim,
                payload,
                submission
              });
            } catch (trackingError) {
              console.error('No se pudo registrar el seguimiento local del reclamo:', trackingError);
            }

            updateLightingContext(userId, {
              status: 'submitted_to_munidigital',
              completedAt: new Date().toISOString(),
              claimNumber: extractSubmissionClaimNumber(submission),
              submission
            });
            setState(userId, FLOW_STATES.LIGHTING_SUBMITTED);
            return successMessage(submission);
          } catch (error) {
            try {
              await recordClaimTrackingEntry({
                createdAt: new Date().toISOString(),
                userId,
                channel: currentClaim.channel || '',
                status: 'error',
                claim: currentClaim,
                payload,
                error: {
                  message: error.message,
                  status: error.status || null,
                  responseBody: error.responseBody || null
                }
              });
            } catch (trackingError) {
              console.error('No se pudo registrar el error en el seguimiento local del reclamo:', trackingError);
            }

            updateLightingContext(userId, {
              status: 'munidigital_error',
              completedAt: new Date().toISOString(),
              submissionError: {
                message: error.message,
                status: error.status || null,
                responseBody: error.responseBody || null
              }
            });
            return errorMessage();
          }
        }

        if (text === '2') {
          setState(userId, FLOW_STATES.LIGHTING_CORRECTION_MENU);
          return correctionMenuMessage();
        }

        if (text === '3') {
          clearLightingContext(userId);
          setState(userId, 'MAIN_MENU');
          return `El reclamo fue cancelado. Escriba ${underline('MENU')} para volver a comenzar.`;
        }

        return retryMessage(summaryMessage(userId));

      case FLOW_STATES.LIGHTING_CORRECTION_MENU:
        if (text === '1') {
          updateLightingContext(userId, { returnToSummaryAfterCorrection: true });
          setState(userId, FLOW_STATES.CLAIM_WAIT_ADDRESS_OR_LOCATION);
          return addressOrLocationMessage();
        }

        if (text === '2') {
          updateLightingContext(userId, { returnToSummaryAfterCorrection: true });
          setState(userId, FLOW_STATES.LIGHTING_WAIT_PHOTO);
          return photoRequestMessage();
        }

        if (text === '3') {
          updateLightingContext(userId, { returnToSummaryAfterCorrection: true });
          setState(userId, FLOW_STATES.LIGHTING_WAIT_INCIDENT_TYPE);
          return incidentTypeMessage(getServiceAreaByKey(getLightingContext(userId).serviceArea));
        }

        if (text === '4') {
          updateLightingContext(userId, { returnToSummaryAfterCorrection: true });
          setState(userId, FLOW_STATES.LIGHTING_WAIT_DETAILS);
          return detailsMessage();
        }

        if (text === '5') {
          updateLightingContext(userId, { returnToSummaryAfterCorrection: true });
          setState(userId, FLOW_STATES.LIGHTING_WAIT_PHONE);
          return phoneRequestMessage();
        }

        if (text === '6') {
          updateLightingContext(userId, { returnToSummaryAfterCorrection: true });
          setState(userId, FLOW_STATES.LIGHTING_WAIT_DNI);
          return dniRequestMessage();
        }

        if (text === '7') {
          setState(userId, FLOW_STATES.LIGHTING_CONFIRMATION);
          return summaryMessage(userId);
        }

        return retryMessage(correctionMenuMessage());

      case FLOW_STATES.LIGHTING_SUBMITTED:
        setState(userId, 'MAIN_MENU');
        return `Escriba ${underline('MENU')} para iniciar una nueva gestión.`;

      default:
        return null;
    }
  }

  return {
    FLOW_STATES,
    isLightingState,
    lightingIntroMessage,
    handleLightingFlow
  };
}

module.exports = {
  createFlowHelpers,
  FLOW_STATES
};
