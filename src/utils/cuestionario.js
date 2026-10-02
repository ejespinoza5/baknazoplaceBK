const crypto = require('crypto');

// El cuestionario de una vacante: lo arma el negocio al publicar o editar, y
// lo responde quien se postula. Sin preguntas, la postulación es rápida (solo CV).

const TIPOS = ['TEXTO', 'SI_NO', 'OPCION'];
const MAX_PREGUNTAS = 8;
const PREGUNTA_MIN = 3;
const PREGUNTA_MAX = 200;
const OPCIONES_MIN = 2;
const OPCIONES_MAX = 6;
const OPCION_MAX = 80;
const RESPUESTA_MAX = 1000;
const ID = /^[a-z0-9]{4,16}$/;

const limpiar = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const nuevoId = () => crypto.randomBytes(5).toString('hex');

/**
 * Normaliza las preguntas que manda el formulario. Devuelve { preguntas } o
 * { error } con un texto que dice qué pregunta falla y por qué.
 */
const validarPreguntas = (entrada) => {
    if (entrada === undefined || entrada === null) return { preguntas: [] };
    if (!Array.isArray(entrada)) return { error: 'El cuestionario no es válido' };
    if (entrada.length > MAX_PREGUNTAS) return { error: `Puedes hacer máximo ${MAX_PREGUNTAS} preguntas` };

    const ids = new Set();
    const preguntas = [];
    for (const [i, p] of entrada.entries()) {
        const n = `Pregunta ${i + 1}`;
        if (!p || typeof p !== 'object') return { error: `${n}: no es válida` };
        const texto = limpiar(p.texto);
        if (texto.length < PREGUNTA_MIN) return { error: `${n}: escribe la pregunta` };
        if (texto.length > PREGUNTA_MAX) return { error: `${n}: máximo ${PREGUNTA_MAX} caracteres` };
        if (!TIPOS.includes(p.tipo)) return { error: `${n}: elige el tipo de respuesta` };

        // El id se conserva al editar (así se sabe qué pregunta es cuál); uno
        // repetido o raro se reemplaza.
        let id = typeof p.id === 'string' && ID.test(p.id) && !ids.has(p.id) ? p.id : nuevoId();
        while (ids.has(id)) id = nuevoId();
        ids.add(id);

        const pregunta = { id, texto, tipo: p.tipo, obligatoria: p.obligatoria === true };
        if (p.tipo === 'OPCION') {
            const opciones = Array.isArray(p.opciones) ? p.opciones.map(limpiar).filter(Boolean) : [];
            const unicas = [...new Map(opciones.map((o) => [o.toLowerCase(), o])).values()];
            if (unicas.length < OPCIONES_MIN) return { error: `${n}: agrega al menos ${OPCIONES_MIN} opciones distintas` };
            if (unicas.length > OPCIONES_MAX) return { error: `${n}: máximo ${OPCIONES_MAX} opciones` };
            if (unicas.some((o) => o.length > OPCION_MAX)) return { error: `${n}: cada opción admite ${OPCION_MAX} caracteres` };
            pregunta.opciones = unicas;
        }
        preguntas.push(pregunta);
    }
    return { preguntas };
};

/**
 * Comprueba las respuestas contra las preguntas actuales de la vacante.
 * `entrada` es { [idPregunta]: respuesta }. Devuelve { respuestas, errores }:
 * cada respuesta guarda la pregunta tal como estaba (texto, tipo y opciones).
 */
const validarRespuestas = (preguntas, entrada) => {
    const datos = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};
    const errores = {};
    const respuestas = [];
    for (const p of preguntas || []) {
        const crudo = datos[p.id];
        let valor = null;
        if (p.tipo === 'TEXTO') {
            const t = typeof crudo === 'string' ? crudo.trim() : '';
            if (t.length > RESPUESTA_MAX) errores[`respuestas.${p.id}`] = `Máximo ${RESPUESTA_MAX} caracteres`;
            valor = t || null;
        } else if (p.tipo === 'SI_NO') {
            if (crudo !== undefined && crudo !== null && crudo !== '' && crudo !== 'SI' && crudo !== 'NO') {
                errores[`respuestas.${p.id}`] = 'Elige sí o no';
            }
            valor = crudo === 'SI' || crudo === 'NO' ? crudo : null;
        } else if (p.tipo === 'OPCION') {
            if (crudo !== undefined && crudo !== null && crudo !== '' && !p.opciones.includes(crudo)) {
                errores[`respuestas.${p.id}`] = 'Elige una de las opciones';
            }
            valor = p.opciones.includes(crudo) ? crudo : null;
        }
        if (p.obligatoria && valor === null && !errores[`respuestas.${p.id}`]) {
            errores[`respuestas.${p.id}`] = 'Esta pregunta es obligatoria';
        }
        respuestas.push({
            id: p.id,
            pregunta: p.texto,
            tipo: p.tipo,
            ...(p.opciones ? { opciones: p.opciones } : {}),
            obligatoria: p.obligatoria,
            respuesta: valor,
        });
    }
    return { respuestas, errores };
};

module.exports = { TIPOS, MAX_PREGUNTAS, RESPUESTA_MAX, validarPreguntas, validarRespuestas };
