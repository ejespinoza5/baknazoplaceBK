const redis = require('../config/redis');

// Caché de lecturas públicas (catálogos, cifras, el feed de los visitantes).
// Con Redis la comparten todos los procesos de la API; sin él, cada proceso
// guarda la suya en memoria. Cualquier fallo de la caché se ignora: se va a
// la base de datos como si no existiera.
//
// Invalidar es subir la "versión" de un espacio (p. ej. 'feed'): las claves
// viejas dejan de usarse y caducan solas, sin tener que buscarlas y borrarlas.

const MAX_EN_MEMORIA = 500;
const memoria = new Map(); // clave → { valor, vence }
const versiones = new Map(); // espacio → número (respaldo sin Redis)

const ahora = () => Date.now();

const leerMemoria = (clave) => {
    const e = memoria.get(clave);
    if (!e) return undefined;
    if (e.vence < ahora()) {
        memoria.delete(clave);
        return undefined;
    }
    // Lo usado se mueve al final: lo más viejo es lo primero en salir.
    memoria.delete(clave);
    memoria.set(clave, e);
    return e.valor;
};

const guardarMemoria = (clave, valor, ttlSeg) => {
    if (memoria.size >= MAX_EN_MEMORIA) memoria.delete(memoria.keys().next().value);
    memoria.set(clave, { valor, vence: ahora() + ttlSeg * 1000 });
};

const version = async (espacio) => {
    const c = redis.disponible();
    if (c) {
        try {
            return (await c.get(`${redis.PREFIJO}v:${espacio}`)) || '0';
        } catch {
            /* se cae a memoria */
        }
    }
    return String(versiones.get(espacio) || 0);
};

/**
 * Devuelve lo guardado para (espacio, clave) o, si no hay, ejecuta `calcular`,
 * lo guarda `ttlSeg` segundos y lo devuelve.
 */
const recordar = async (espacio, clave, ttlSeg, calcular) => {
    const v = await version(espacio);
    const llave = `${redis.PREFIJO}c:${espacio}:${v}:${clave}`;
    const c = redis.disponible();

    if (c) {
        try {
            const crudo = await c.get(llave);
            if (crudo !== null) return JSON.parse(crudo);
        } catch {
            /* sin caché esta vez */
        }
    } else {
        const valor = leerMemoria(llave);
        if (valor !== undefined) return valor;
    }

    const valor = await calcular();
    if (c) {
        c.set(llave, JSON.stringify(valor), { EX: ttlSeg }).catch(() => undefined);
    } else {
        guardarMemoria(llave, valor, ttlSeg);
    }
    return valor;
};

/** Da por viejo todo lo guardado en esos espacios. Nunca lanza. */
const invalidar = async (...espacios) => {
    const c = redis.disponible();
    for (const espacio of espacios) {
        versiones.set(espacio, (versiones.get(espacio) || 0) + 1);
        if (c) await c.incr(`${redis.PREFIJO}v:${espacio}`).catch(() => undefined);
    }
};

/**
 * Algo cambió en lo que se ve del marketplace (un anuncio publicado, editado,
 * borrado, moderado, o una cuenta suspendida): el feed y las cifras públicas
 * se vuelven a calcular en la siguiente visita.
 */
const anunciosCambiaron = () => {
    invalidar('feed', 'resumen', 'perfiles').catch(() => undefined);
};

module.exports = { recordar, invalidar, anunciosCambiaron };
