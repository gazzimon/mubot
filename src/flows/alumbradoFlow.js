const { getLightingCatalog } = require('./alumbradoCatalog');

const FLOW_STATES = {
  LIGHTING_INTRO: 'LIGHTING_INTRO',
  LIGHTING_WAIT_LOCATION: 'LIGHTING_WAIT_LOCATION',
  LIGHTING_WAIT_PHOTO: 'LIGHTING_WAIT_PHOTO',
  LIGHTING_WAIT_INCIDENT_TYPE: 'LIGHTING_WAIT_INCIDENT_TYPE',
  LIGHTING_WAIT_ADDRESS: 'LIGHTING_WAIT_ADDRESS',
  LIGHTING_WAIT_DETAILS: 'LIGHTING_WAIT_DETAILS',
  LIGHTING_CONFIRM_PHONE: 'LIGHTING_CONFIRM_PHONE',
  LIGHTING_WAIT_PHONE: 'LIGHTING_WAIT_PHONE',
  LIGHTING_CONFIRMATION: 'LIGHTING_CONFIRMATION',
  LIGHTING_SUBMITTED: 'LIGHTING_SUBMITTED'
};

function createFlowHelpers(dependencies) {
  const {
    updateSession,
    setState,
    getSession,
    getPhoneCandidate,
    catalogEnvironment,
    saveImageFromIncoming
  } = dependencies;

  const catalog = getLightingCatalog(catalogEnvironment);

  function lightingIntroMessage() {
    return [
      'Vamos a registrar un reclamo de alumbrado.',
      '',
      'Este canal solo toma reclamos si estas frente al incidente en este momento.',
      '',
      'Responde:',
      '1. Si, estoy frente al incidente',
      '2. No, no estoy en el lugar',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function locationRequestMessage() {
    return [
      'Perfecto. Compartime tu ubicacion actual desde WhatsApp para continuar.',
      '',
      'Importante:',
      '- Debes usar la opcion de compartir ubicacion',
      '- El reclamo solo se registra con geoposicion recibida desde el chat',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function photoRequestMessage() {
    return [
      'Ubicacion recibida correctamente.',
      '',
      'Ahora enviame una foto del incidente.',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function incidentTypeMessage() {
    return [
      'Selecciona el tipo de incidente de alumbrado:',
      '',
      ...catalog.incidentTypes.map((item) => `${item.menuOption}. ${item.label}`),
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function addressMessage() {
    return [
      'Escribi la direccion o referencia del lugar.',
      '',
      'Ejemplo: Av. Mitre 1234, casi Junin.',
      'Este dato se enviara en la direccion y en las observaciones del reclamo.',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function detailsMessage() {
    return [
      'Si quieres agregar un detalle adicional, escribelo ahora.',
      '',
      'Ejemplo: Hace tres dias que esta apagada.',
      'Si no quieres agregar nada, responde NO.',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function phoneConfirmationMessage(phoneCandidate) {
    return [
      `Voy a usar este telefono como contacto: ${phoneCandidate}.`,
      '',
      'Responde:',
      '1. Si, es correcto',
      '2. No, quiero indicar otro',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function phoneRequestMessage() {
    return [
      'Escribi el telefono de contacto con caracteristica.',
      '',
      'Ejemplo: 3765123456',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  function successMessage() {
    return [
      'Tu reclamo quedo listo para ser enviado.',
      '',
      'En esta primera etapa lo estamos dejando preparado en el sistema para integrar con MuniDigital.',
      'Si deseas iniciar otro reclamo, escribe MENU.'
    ].join('\n');
  }

  function invalidLocationMessage() {
    return [
      'No detecte una ubicacion valida.',
      '',
      'Por favor comparte tu ubicacion actual desde WhatsApp para continuar.'
    ].join('\n');
  }

  function invalidPhotoMessage() {
    return [
      'Necesito una foto valida del incidente para continuar.',
      '',
      'Por favor envia una imagen desde tu telefono.'
    ].join('\n');
  }

  function retryMessage(nextStepMessage) {
    return [
      'No pude entender tu respuesta.',
      '',
      nextStepMessage
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

  function getLightingContext(userId) {
    return getSession(userId).context.lightingClaim || {};
  }

  function findIncidentTypeByMenuOption(text) {
    return catalog.incidentTypes.find((item) => item.menuOption === text);
  }

  function normalizePhone(value = '') {
    return String(value).replace(/\D/g, '');
  }

  function isValidPhone(value = '') {
    const normalized = normalizePhone(value);
    return normalized.length >= 10 && normalized.length <= 15;
  }

  function buildObservations(claim) {
    const lines = [
      `Direccion informada: ${claim.address}`,
      `Telefono de contacto: ${claim.phone}`
    ];

    if (claim.additionalDetails) {
      lines.push(`Detalle adicional: ${claim.additionalDetails}`);
    }

    lines.push('Reclamo generado desde el bot de WhatsApp con ubicacion compartida.');
    return lines.join(' ');
  }

  function buildPayload(claim) {
    return {
      direccion: claim.address,
      areaServicioId: catalog.areaServicioId,
      tipoIncidenteId: claim.incidentTypeId,
      prioridadId: null,
      identificadorId: null,
      origenId: catalog.origenId,
      localidad: catalog.localidad,
      latitud: String(claim.location.latitude),
      longitud: String(claim.location.longitude),
      observaciones: buildObservations(claim),
      pais: catalog.pais,
      barrio: ''
    };
  }

  function summaryMessage(userId) {
    const claim = getLightingContext(userId);
    const incidentType = catalog.incidentTypes.find((item) => item.id === claim.incidentTypeId);
    const payload = buildPayload(claim);

    updateLightingContext(userId, { payloadPreview: payload });

    return [
      'Revisa los datos del reclamo:',
      '',
      `Tipo: ${incidentType ? incidentType.label : 'No informado'}`,
      `Direccion: ${claim.address}`,
      `Telefono: ${claim.phone}`,
      `Coordenadas: ${payload.latitud}, ${payload.longitud}`,
      `Foto adjunta: ${claim.photo ? 'Si' : 'No'}`,
      '',
      'Responde:',
      '1. Confirmar',
      '2. Cancelar',
      '',
      'Escribi MENU para volver al menu principal.'
    ].join('\n');
  }

  async function handleLightingFlow(userId, text, options = {}) {
    const session = getSession(userId);

    switch (session.state) {
      case FLOW_STATES.LIGHTING_INTRO:
        if (text === '1') {
          updateLightingContext(userId, {
            channel: options.channel || 'unknown',
            startedAt: new Date().toISOString()
          });
          setState(userId, FLOW_STATES.LIGHTING_WAIT_LOCATION);
          return locationRequestMessage();
        }

        if (text === '2') {
          setState(userId, 'MAIN_MENU');
          return [
            'Este canal solo registra reclamos si estas frente al incidente.',
            '',
            'Cuando estes en el lugar, vuelve a escribirnos y comparti tu ubicacion.',
            '',
            'Volvimos al menu principal.',
            '',
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

        return retryMessage(lightingIntroMessage());

      case FLOW_STATES.LIGHTING_WAIT_LOCATION: {
        if (!options.location) {
          return invalidLocationMessage();
        }

        updateLightingContext(userId, {
          location: options.location
        });
        setState(userId, FLOW_STATES.LIGHTING_WAIT_PHOTO);
        return photoRequestMessage();
      }

      case FLOW_STATES.LIGHTING_WAIT_PHOTO: {
        const photo = await saveImageFromIncoming(options);
        if (!photo) {
          return invalidPhotoMessage();
        }

        updateLightingContext(userId, { photo });
        setState(userId, FLOW_STATES.LIGHTING_WAIT_INCIDENT_TYPE);
        return incidentTypeMessage();
      }

      case FLOW_STATES.LIGHTING_WAIT_INCIDENT_TYPE: {
        const incidentType = findIncidentTypeByMenuOption(text);
        if (!incidentType) {
          return retryMessage(incidentTypeMessage());
        }

        updateLightingContext(userId, {
          incidentTypeId: incidentType.id,
          incidentTypeLabel: incidentType.label
        });
        setState(userId, FLOW_STATES.LIGHTING_WAIT_ADDRESS);
        return addressMessage();
      }

      case FLOW_STATES.LIGHTING_WAIT_ADDRESS:
        if (!text) {
          return retryMessage(addressMessage());
        }

        updateLightingContext(userId, { address: text });
        setState(userId, FLOW_STATES.LIGHTING_WAIT_DETAILS);
        return detailsMessage();

      case FLOW_STATES.LIGHTING_WAIT_DETAILS: {
        updateLightingContext(userId, {
          additionalDetails: /^no$/i.test(text) ? '' : text
        });

        const phoneCandidate = getPhoneCandidate(userId, options);
        updateLightingContext(userId, { phoneCandidate });
        setState(userId, FLOW_STATES.LIGHTING_CONFIRM_PHONE);
        return phoneConfirmationMessage(phoneCandidate);
      }

      case FLOW_STATES.LIGHTING_CONFIRM_PHONE:
        if (text === '1') {
          const claim = getLightingContext(userId);
          updateLightingContext(userId, { phone: claim.phoneCandidate });
          setState(userId, FLOW_STATES.LIGHTING_CONFIRMATION);
          return summaryMessage(userId);
        }

        if (text === '2') {
          setState(userId, FLOW_STATES.LIGHTING_WAIT_PHONE);
          return phoneRequestMessage();
        }

        return retryMessage(phoneConfirmationMessage(getLightingContext(userId).phoneCandidate));

      case FLOW_STATES.LIGHTING_WAIT_PHONE:
        if (!isValidPhone(text)) {
          return retryMessage(phoneRequestMessage());
        }

        updateLightingContext(userId, { phone: normalizePhone(text) });
        setState(userId, FLOW_STATES.LIGHTING_CONFIRMATION);
        return summaryMessage(userId);

      case FLOW_STATES.LIGHTING_CONFIRMATION:
        if (text === '1') {
          updateLightingContext(userId, {
            status: 'ready_for_munidigital',
            completedAt: new Date().toISOString()
          });
          setState(userId, FLOW_STATES.LIGHTING_SUBMITTED);
          return successMessage();
        }

        if (text === '2') {
          updateSession(userId, {
            context: {
              ...getSession(userId).context,
              lightingClaim: null
            }
          });
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
