const { createClient } = require('redis');

// Redis es opcional. Con REDIS_URL (p. ej. redis://127.0.0.1:6379) se usa para
// la caché y para los límites de peticiones. Sin ella, o si Redis se cae, la
// API sigue funcionando: la caché pasa a memoria y los límites a cada proceso.

const URL_REDIS = process.env.REDIS_URL || null;
// Prefijo de todas las claves: así Redis se puede compartir con otras apps.
const PREFIJO = process.env.REDIS_PREFIJO || 'baknazo:';

let cliente = null;
let listo = false;
let ultimoAviso = 0;

const avisar = (mensaje) => {
    // Un Redis caído reintenta cada pocos segundos: no se llena el log.
    if (Date.now() - ultimoAviso < 60_000) return;
    ultimoAviso = Date.now();
    console.warn(`[redis] ${mensaje}`);
};

if (URL_REDIS) {
    cliente = createClient({
        url: URL_REDIS,
        socket: {
            // Reintento con espera creciente, hasta 10 s entre intentos.
            reconnectStrategy: (intentos) => Math.min(intentos * 500, 10_000),
            connectTimeout: 5_000,
        },
    });
    cliente.on('ready', () => {
        listo = true;
        console.log('[redis] conectado');
    });
    cliente.on('end', () => {
        listo = false;
    });
    cliente.on('error', (e) => {
        listo = false;
        avisar(`sin conexión (${e.message}). Se usa la caché en memoria hasta que vuelva.`);
    });
    cliente.connect().catch((e) => avisar(`no se pudo conectar: ${e.message}`));
} else {
    console.warn('[redis] REDIS_URL no configurado: caché en memoria y límites por proceso.');
}

/** El cliente si está conectado; si no, null (quien llama usa su respaldo). */
const disponible = () => (cliente && listo ? cliente : null);

module.exports = { cliente, disponible, PREFIJO, configurado: Boolean(URL_REDIS) };
