// Reglas de anuncios. El front las recibe por GET /api/catalogos: no deben quemarse en el cliente.

const PILARES = ['productos', 'servicios', 'empleo'];

// Límite duro: anuncio_fotos.orden tiene CHECK (0..5).
const MAX_FOTOS = 6;
const MAX_BYTES_FOTO = Number(process.env.ANUNCIOS_MAX_BYTES_FOTO || 8 * 1024 * 1024);

const ENUMERACIONES = {
    condicion: { NUEVO: 'Nuevo', USADO: 'Usado' },
    modalidadCobro: { POR_PROYECTO: 'Por proyecto', POR_HORA: 'Por hora' },
    jornada: { TIEMPO_COMPLETO: 'Tiempo completo', MEDIO_TIEMPO: 'Medio tiempo', POR_TEMPORADA: 'Por temporada' },
    modalidad: { REMOTO: 'Remoto', PRESENCIAL: 'Presencial', HIBRIDO: 'Híbrido' },
};

const TITULO_MIN = 5;
const TITULO_MAX = 120;
const DESCRIPCION_MAX = 5000;
const SECTOR_MAX = 80;
const ZONA_COBERTURA_MAX = 150;
const PRECIO_MAX = 9999999999.99; // NUMERIC(12,2)

const LIMITE_FEED_DEFECTO = 20;
const LIMITE_FEED_MAX = 50;

module.exports = {
    PILARES,
    MAX_FOTOS,
    MAX_BYTES_FOTO,
    ENUMERACIONES,
    TITULO_MIN,
    TITULO_MAX,
    DESCRIPCION_MAX,
    SECTOR_MAX,
    ZONA_COBERTURA_MAX,
    PRECIO_MAX,
    LIMITE_FEED_DEFECTO,
    LIMITE_FEED_MAX,
};
