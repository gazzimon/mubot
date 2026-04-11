const BASE_SERVICE_AREAS = [
  {
    key: 'alumbrado',
    menuOption: '1',
    label: 'Alumbrado'
  },
  {
    key: 'semaforos',
    menuOption: '2',
    label: 'Semaforos'
  }
];

const CATALOGS = {
  TEST: {
    localidad: 'Posadas',
    pais: 'Argentina',
    serviceAreas: [
      {
        ...BASE_SERVICE_AREAS[0],
        enabled: true,
        areaServicioId: 7916,
        prioridadId: 1,
        origenId: 149,
        incidentTypes: [
          { menuOption: '1', id: 53294, label: 'Zona oscura / Falta de iluminacion' },
          { menuOption: '2', id: 53295, label: 'Luminaria quemada' },
          { menuOption: '3', id: 53296, label: 'Luminaria encendida de dia' },
          { menuOption: '4', id: 53297, label: 'Poste caido / peligro de caida' },
          { menuOption: '5', id: 53298, label: 'Artefacto vandalizado' }
        ]
      },
      {
        ...BASE_SERVICE_AREAS[1],
        enabled: false,
        areaServicioId: null,
        prioridadId: 1,
        origenId: 149,
        incidentTypes: []
      }
    ]
  },
  PROD: {
    localidad: 'Posadas',
    pais: 'Argentina',
    serviceAreas: [
      {
        ...BASE_SERVICE_AREAS[0],
        enabled: true,
        areaServicioId: 6878,
        prioridadId: 1,
        origenId: null,
        incidentTypes: [
          { menuOption: '1', id: 44325, label: 'Zona oscura / Falta de iluminacion' },
          { menuOption: '2', id: 44326, label: 'Luminaria quemada' },
          { menuOption: '3', id: 44327, label: 'Poste caido / peligro de caida' },
          { menuOption: '4', id: 44872, label: 'Luminaria intermitente' },
          { menuOption: '5', id: 44873, label: 'Luminaria faltante' },
          { menuOption: '6', id: 44874, label: 'Luminaria encendida de dia' },
          { menuOption: '7', id: 44875, label: 'Corte suministro' },
          { menuOption: '8', id: 44876, label: 'Artefacto vandalizado' },
          { menuOption: '9', id: 44877, label: 'Poste / brazo averiado' },
          { menuOption: '10', id: 44878, label: 'Artefacto robado' },
          { menuOption: '11', id: 44879, label: 'Cable expuesto o peligroso' },
          { menuOption: '12', id: 44880, label: 'Ruido en columna o luminaria' },
          { menuOption: '13', id: 44881, label: 'Vandalizacion' },
          { menuOption: '14', id: 44882, label: 'Otros' }
        ]
      },
      {
        ...BASE_SERVICE_AREAS[1],
        enabled: false,
        areaServicioId: null,
        prioridadId: 1,
        origenId: null,
        incidentTypes: []
      }
    ]
  }
};

function getLightingCatalog(environmentName = 'TEST') {
  return CATALOGS[environmentName] || CATALOGS.TEST;
}

module.exports = {
  getLightingCatalog
};
