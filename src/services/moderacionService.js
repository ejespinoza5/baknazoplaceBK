const moderacionModel = require('../models/moderacionModel');
const cacheService = require('./cacheService');
const { MOTIVOS_DENUNCIA } = require('../config/administracion');

// Moderación por reglas, sin IA ni servicios externos. Revisa el TEXTO del
// anuncio (título y descripción) y su categoría. Las fotos no se analizan
// automáticamente: las revisa una persona cuando el anuncio va a revisión.

const error = (mensaje, status, errores) => {
    const err = new Error(mensaje);
    err.status = status;
    if (errores) err.errores = errores;
    return err;
};

// ---------- Normalización ----------

// Lo que la gente usa para esquivar filtros: c0caína, m4rihuana, $exo.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

const normalizar = (texto) =>
    String(texto || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[013457@$]/g, (c) => LEET[c] || c)
        .replace(/ñ/g, 'n');

// Las palabras del texto. Las letras sueltas seguidas ("c o c a i n a",
// "c.o.c.a.i.n.a") se juntan en una sola palabra.
//
// Esas secuencias quedan además en `palabras.secuencias`: dentro de ellas el
// término se busca como parte ("c.o.c.a.i.n.a y" deja "cocainay", porque la
// "y" del español también es una letra suelta).
const palabrasDe = (texto) => {
    const crudas = normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean);
    const palabras = [];
    const secuencias = [];
    let sueltas = '';
    const cerrar = () => {
        if (sueltas.length >= 3) {
            palabras.push(sueltas);
            secuencias.push(sueltas);
        } else if (sueltas) {
            palabras.push(...sueltas.split(''));
        }
        sueltas = '';
    };
    for (const p of crudas) {
        if (p.length === 1) {
            sueltas += p;
            continue;
        }
        cerrar();
        palabras.push(p);
    }
    cerrar();
    palabras.secuencias = secuencias;
    return palabras;
};

// El término normalizado como se guarda en el diccionario.
const normalizarTermino = (termino) => palabrasDe(termino).join(' ');

// ¿Aparece el término (una o varias palabras) en el texto? Acepta plurales
// simples: "replica" encuentra "replicas" y "arma" encuentra "armas".
const contiene = (palabras, termino) => {
    const partes = termino.split(' ');
    const coincide = (palabra, parte) => palabra === parte || palabra === `${parte}s` || palabra === `${parte}es`;
    for (let i = 0; i + partes.length <= palabras.length; i++) {
        if (partes.every((parte, j) => coincide(palabras[i + j], parte))) return true;
    }
    // Deletreado con separadores: solo términos de 5+ letras, para no
    // encontrar palabras cortas por casualidad dentro de una secuencia.
    const junto = partes.join('');
    return junto.length >= 5 && (palabras.secuencias || []).some((s) => s.includes(junto));
};

// ---------- Reglas (con caché corta) ----------

let cache = null;
let cacheHasta = 0;

const reglas = async () => {
    if (cache && Date.now() < cacheHasta) return cache;
    const [config, palabras] = await Promise.all([moderacionModel.obtenerConfig(), moderacionModel.listarPalabras()]);
    cache = { config, palabras };
    cacheHasta = Date.now() + 60 * 1000;
    return cache;
};

// Tras editar la configuración desde el panel, aplica ya.
const olvidarReglas = () => {
    cache = null;
};

/**
 * Evalúa un anuncio antes de publicarlo o tras editarlo.
 * @returns {{ decision: 'PUBLICAR'|'REVISION'|'BLOQUEAR', motivos: string[], terminos: string[], campo?: string }}
 */
const evaluar = async ({ titulo, descripcion, categoriaId, autorCreadoEn }) => {
    const { config, palabras } = await reglas();

    if ((config.categorias_prohibidas || []).map(Number).includes(Number(categoriaId))) {
        return { decision: 'BLOQUEAR', motivos: ['CATEGORIA_PROHIBIDA'], terminos: [], campo: 'categoriaId' };
    }

    const enTitulo = palabrasDe(titulo);
    const enDescripcion = palabrasDe(descripcion);
    const bloqueo = [];
    const revision = [];
    let campo = null;
    for (const p of palabras) {
        const enT = contiene(enTitulo, p.termino);
        const enD = contiene(enDescripcion, p.termino);
        if (!enT && !enD) continue;
        if (p.nivel === 'BLOQUEO') {
            bloqueo.push(p.termino);
            campo = campo || (enT ? 'titulo' : 'descripcion');
        } else {
            revision.push(p.termino);
        }
    }
    if (bloqueo.length > 0) return { decision: 'BLOQUEAR', motivos: ['PALABRA_PROHIBIDA'], terminos: bloqueo, campo };

    const motivos = [];
    if (revision.length > 0) motivos.push('PALABRA_RESTRINGIDA');
    if (config.revision_usuarios_nuevos && autorCreadoEn) {
        const dias = (Date.now() - new Date(autorCreadoEn).getTime()) / 86_400_000;
        if (dias < config.dias_usuario_nuevo) motivos.push('USUARIO_NUEVO');
    }
    return { decision: motivos.length > 0 ? 'REVISION' : 'PUBLICAR', motivos, terminos: revision };
};

/**
 * Convierte un bloqueo en el error 422 que el formulario pinta en su campo.
 * No dice qué término fue: así nadie afina el texto para esquivar el filtro.
 */
const errorDeBloqueo = (resultado) => {
    if (resultado.motivos.includes('CATEGORIA_PROHIBIDA')) {
        return error('Datos inválidos', 422, { categoriaId: 'Esta categoría no admite publicaciones por ahora' });
    }
    return error('Datos inválidos', 422, {
        [resultado.campo || 'titulo']: 'Contiene algo que las normas de Baknazo no permiten publicar',
    });
};

// ---------- Denuncias ----------

const IDS_MOTIVO_DENUNCIA = MOTIVOS_DENUNCIA.map((m) => m.id);

/**
 * Un usuario denuncia un anuncio. Una vez por anuncio. Al llegar al umbral de
 * personas distintas, el anuncio sale del feed y va a revisión.
 */
const denunciar = async ({ anuncio, usuarioId, motivo, detalle }) => {
    if (!IDS_MOTIVO_DENUNCIA.includes(motivo)) throw error('Elige un motivo', 422, { motivo: 'Elige un motivo' });
    const texto = typeof detalle === 'string' ? detalle.trim().slice(0, 500) : '';
    if (anuncio.autor_usuario_id === usuarioId) throw error('No puedes denunciar tu propio anuncio', 400);

    const id = await moderacionModel.crearDenuncia({
        anuncioId: anuncio.id,
        denuncianteId: usuarioId,
        motivo,
        detalle: texto || null,
    });
    if (!id) throw error('Ya denunciaste este anuncio. Lo estamos revisando.', 409);

    const { config } = await reglas();
    const denunciantes = await moderacionModel.contarDenunciantesPendientes(anuncio.id);
    if (denunciantes >= config.umbral_denuncias) {
        await moderacionModel.enviarARevision(anuncio.id, 'DENUNCIAS', { denunciantes });
        // Sale del feed hasta que lo revisen: la caché pública no debe mostrarlo.
        cacheService.anunciosCambiaron();
    }
    return { denunciado: true };
};

module.exports = { normalizar, normalizarTermino, palabrasDe, contiene, evaluar, errorDeBloqueo, denunciar, olvidarReglas };
