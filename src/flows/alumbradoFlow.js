const { getLightingCatalog } = require('./alumbradoCatalog');
const { searchAddress, reverseGeocode } = require('../services/geocodingService');

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
  LIGHTING_SUBMITTED: 'LIGHTING_SUBMITTED'
};

const MAX_ADDRESS_ATTEMPTS = 3;

function createFlowHelpers(dependencies) {
  const {
    updateSession,
    setState,
    getSession,
    catalogEnvironment,
    saveImageFromIncoming,
    submitLightingClaim
  } = dependencies;

  const catalog = getLightingCatalog(catalogEnvironment);

  function lightingIntroMessage() {
    return [
      'Vamos a ayudarte a registrar un reclamo en MuniDigital.',
      '',
      'Primero vamos a identificar el area correspondiente y luego te voy a pedir la ubicacion, una foto y los datos minimos para cargarlo.',
      '',
      'Indica el area del reclamo:',
      '1. Alumbrado',
      '2. Semaforos',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function addressOrLocationMessage() {
    return [
      'Indicame la direccion exacta del incidente dentro de Posadas.',
      'Si estas en el lugar, tambien podes compartir tu ubicacion.',
      '',
      'Ejemplo: Av. Corrientes 2030.',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function addressDisambiguationMessage(options) {
    return [
      'Encontre varias ubicaciones parecidas en Posadas.',
      'Elige una opcion:',
      ...options.map((item, index) => `${index + 1}. ${item.address}`),
      `${options.length + 1}. Ninguna de estas`,
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function addressConfirmationMessage(candidate) {
    return [
      'Encontre esta ubicacion en Posadas:',
      candidate.address,
      `Coordenadas: ${candidate.latitude}, ${candidate.longitude}`,
      '',
      'Responde:',
      '1. Confirmar direccion',
      '2. Corregir direccion',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function neighborhoodMessage() {
    return [
      'No pude identificar el barrio automaticamente.',
      '',
      'Indica el barrio del incidente.',
      '',
      'Ejemplo: Centro',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function photoRequestMessage() {
    return [
      'Direccion confirmada.',
      '',
      'Ahora enviame una foto del incidente.',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function incidentTypeMessage(serviceArea) {
    return [
      `Selecciona el tipo de incidente de ${serviceArea.label.toLowerCase()}:`,
      '',
      ...serviceArea.incidentTypes.map((item) => `${item.menuOption}. ${item.label}`),
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function detailsMessage() {
    return [
      'Describi brevemente el problema.',
      '',
      'Ejemplo: Hace tres dias que esta apagada.',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function phoneRequestMessage() {
    return [
      'Indica tu numero de telefono con caracteristica.',
      '',
      'Ejemplo: 3765123456',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function dniRequestMessage() {
    return [
      'Indica tu DNI.',
      '',
      'Ejemplo: 37770375',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function semaforosUnavailableMessage() {
    return [
      'Semaforos aun no esta disponible en este flujo porque faltan sus codigos de MuniDigital.',
      '',
      'Por ahora podes cargar un reclamo de alumbrado o escribir MENU para volver al menu principal.'
    ].join('\n');
  }

  function invalidPhotoMessage() {
    return [
      'Necesito una foto valida del incidente para continuar.',
      '',
      'Por favor envia una imagen desde tu telefono.'
    ].join('\n');
  }

  function invalidAddressMessage() {
    return [
      'No pude ubicar esa direccion dentro de Posadas.',
      '',
      'Por favor escribe la direccion mas completa o comparte tu ubicacion actual.',
      'Ejemplo: Av. Corrientes 2030, Centro.'
    ].join('\n');
  }

  function weakAddressMessage() {
    return [
      'La direccion parece incompleta o poco precisa.',
      '',
      'Agrega altura, barrio o una referencia, o comparte tu ubicacion actual.',
      'Ejemplo: Av. Corrientes 2030, Centro.'
    ].join('\n');
  }

  function addressAttemptsExceededMessage() {
    return [
      'Todavia no pude validar la direccion con precision dentro de Posadas.',
      '',
      'Para continuar, comparte tu ubicacion actual o escribe MENU para volver al menu principal.'
    ].join('\n');
  }

  function invalidLocationMessage() {
    return [
      'La ubicacion compartida no corresponde a Posadas o no pudo validarse.',
      '',
      'Por favor envia una direccion dentro de Posadas o comparte otra ubicacion.'
    ].join('\n');
  }

  function retryMessage(nextStepMessage) {
    return [
      'No pude entender tu respuesta.',
      '',
      nextStepMessage
    ].join('\n');
  }

  function errorMessage() {
    return [
      'No pudimos enviar el reclamo a MuniDigital en este momento.',
      '',
      'Puedes responder 1 para reintentar el envio o 2 para cancelar.',
      '',
      'Escribi MENU para volver al menu principal.'
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
    const body = submission && submission.body;
    if (!body) {
      return 'La API respondio correctamente.';
    }

    if (typeof body === 'string') {
      return `Respuesta API: ${body}`;
    }

    const candidates = [
      body.numero,
      body.id,
      body.incidenteId,
      body.reclamoId,
      body.mensaje
    ].filter(Boolean);

    if (!candidates.length) {
      return 'La API respondio correctamente.';
    }

    return `Respuesta API: ${candidates.join(' | ')}`;
  }

  function successMessage(submission) {
    return [
      'Tu reclamo fue enviado correctamente a MuniDigital.',
      '',
      formatSubmissionSummary(submission),
      'Si deseas iniciar otro reclamo, escribe MENU.'
    ].join('\n');
  }

  function summaryMessage(userId) {
    const claim = getLightingContext(userId);
    const serviceArea = getServiceAreaByKey(claim.serviceArea);
    const incidentType = serviceArea
      ? serviceArea.incidentTypes.find((item) => item.id === claim.incidentTypeId)
      : null;
    const payload = buildPayload(claim);

    updateLightingContext(userId, { payloadPreview: payload });

    return [
      'Revisa los datos del reclamo:',
      '',
      `Area: ${serviceArea ? serviceArea.label : 'No informada'}`,
      `Direccion: ${claim.address}`,
      `Barrio: ${claim.neighborhood}`,
      `Coordenadas: ${payload.latitud}, ${payload.longitud}`,
      `Foto adjunta: ${claim.photo ? 'Si' : 'No'}`,
      `Tipo: ${incidentType ? incidentType.label : 'No informado'}`,
      `Observaciones: ${claim.observations}`,
      `Telefono: ${claim.phone}`,
      `DNI: ${claim.dni}`,
      '',
      'Responde:',
      '1. Confirmar',
      '2. Cancelar',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
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
        FLOW_STATES.LIGHTING_SUBMITTED
      ].includes(session.state) &&
      !hasConfirmedLocation(claim)
    ) {
      clearLightingContext(userId);
      setState(userId, FLOW_STATES.LIGHTING_INTRO);
      return [
        'Reiniciamos el reclamo porque faltaba la ubicacion confirmada de una version previa del flujo.',
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
          neighborhood: '',
          observations: '',
          phone: '',
          dni: '',
          addressAttempts: 0
        });
        setState(userId, FLOW_STATES.CLAIM_WAIT_ADDRESS_OR_LOCATION);
        return addressOrLocationMessage();
      }

      case FLOW_STATES.CLAIM_WAIT_ADDRESS_OR_LOCATION: {
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

          return [
            'No pude validar la direccion en este momento.',
            '',
            'Intenta nuevamente en unos instantes o comparte tu ubicacion actual.'
          ].join('\n');
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
            location: {
              latitude: candidate.latitude,
              longitude: candidate.longitude
            },
            neighborhood: candidate.barrio || '',
            addressCandidate: null,
            addressOptions: null
          });
          if (isNeighborhoodKnown(candidate.barrio)) {
            setState(userId, FLOW_STATES.LIGHTING_WAIT_PHOTO);
            return photoRequestMessage();
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
        setState(userId, FLOW_STATES.LIGHTING_WAIT_PHOTO);
        return photoRequestMessage();

      case FLOW_STATES.LIGHTING_WAIT_PHOTO: {
        const photo = await saveImageFromIncoming(options);
        if (!photo) {
          return invalidPhotoMessage();
        }

        updateLightingContext(userId, { photo });
        setState(userId, FLOW_STATES.LIGHTING_WAIT_INCIDENT_TYPE);
        return incidentTypeMessage(getServiceAreaByKey(getLightingContext(userId).serviceArea));
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
        setState(userId, FLOW_STATES.LIGHTING_WAIT_DETAILS);
        return detailsMessage();
      }

      case FLOW_STATES.LIGHTING_WAIT_DETAILS:
        if (!text) {
          return retryMessage(detailsMessage());
        }

        updateLightingContext(userId, { observations: text });
        setState(userId, FLOW_STATES.LIGHTING_WAIT_PHONE);
        return phoneRequestMessage();

      case FLOW_STATES.LIGHTING_WAIT_PHONE:
        if (!isValidPhone(text)) {
          return retryMessage(phoneRequestMessage());
        }

        updateLightingContext(userId, { phone: normalizePhone(text) });
        setState(userId, FLOW_STATES.LIGHTING_WAIT_DNI);
        return dniRequestMessage();

      case FLOW_STATES.LIGHTING_WAIT_DNI:
        if (!isValidDni(text)) {
          return retryMessage(dniRequestMessage());
        }

        updateLightingContext(userId, { dni: normalizeDni(text) });
        setState(userId, FLOW_STATES.LIGHTING_CONFIRMATION);
        return summaryMessage(userId);

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

            updateLightingContext(userId, {
              status: 'submitted_to_munidigital',
              completedAt: new Date().toISOString(),
              submission
            });
            setState(userId, FLOW_STATES.LIGHTING_SUBMITTED);
            return successMessage(submission);
          } catch (error) {
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
          clearLightingContext(userId);
          setState(userId, 'MAIN_MENU');
          return 'El reclamo fue cancelado. Escribe MENU para volver a empezar.';
        }

        return retryMessage(summaryMessage(userId));

      case FLOW_STATES.LIGHTING_SUBMITTED:
        setState(userId, 'MAIN_MENU');
        return 'Escribe MENU para iniciar una nueva gestion.';

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
