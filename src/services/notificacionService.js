const notificacionModel = require('../models/notificacionModel');
const fcmService = require('./fcmService');
const hub = require('../realtime/hub');

// El sistema de notificaciones. Los demás servicios solo llaman a `notificar`
// con qué pasó; aquí se decide si se guarda (preferencias), se agrupa, se
// reparte en vivo por el WebSocket y se manda push a los dispositivos.

// Cada tipo pertenece a una categoría de las preferencias.
const CATEGORIA = {
    SEGUIDOR: 'seguidores',
    ME_GUSTA: 'interacciones',
    COMENTARIO: 'interacciones',
    RESPUESTA: 'interacciones',
    GUARDADO: 'interacciones',
    MENSAJE: 'mensajes',
    ANUNCIO_APROBADO: 'publicaciones',
    ANUNCIO_RECHAZADO: 'publicaciones',
    ANUNCIO_VENCIDO: 'publicaciones',
    NUEVA_VACANTE: 'empleo',
    POSTULACION_NUEVA: 'empleo',
    POSTULACION_ESTADO: 'empleo',
    CV_REVISADO: 'empleo',
    SEGURIDAD: 'seguridad',
};
const CATEGORIAS = ['seguidores', 'interacciones', 'mensajes', 'publicaciones', 'empleo', 'seguridad'];
// Lo que pasa con tus publicaciones y con tu cuenta siempre se ve dentro de
// la app; solo el push de esas categorías se puede apagar.
const SIEMPRE_EN_APP = new Set(['publicaciones', 'seguridad']);
const SONIDOS = ['ninguno', 'campana', 'burbuja', 'pop', 'marimba'];

// El push nunca lleva nombres, títulos ni contenido: la pantalla de bloqueo
// la puede ver cualquiera. El detalle está dentro de la app, con sesión.
const TEXTO_PUSH = {
    SEGUIDOR: 'Tienes nuevos seguidores',
    ME_GUSTA: 'A alguien le gustó tu publicación',
    COMENTARIO: 'Comentaron tu publicación',
    RESPUESTA: 'Respondieron tu comentario',
    GUARDADO: 'Guardaron tu publicación en favoritos',
    MENSAJE: 'Tienes mensajes nuevos',
    ANUNCIO_APROBADO: 'Hay novedades sobre una de tus publicaciones',
    ANUNCIO_RECHAZADO: 'Hay novedades sobre una de tus publicaciones',
    ANUNCIO_VENCIDO: 'Una de tus publicaciones venció',
    NUEVA_VACANTE: 'Hay una vacante nueva de un negocio que sigues',
    POSTULACION_NUEVA: 'Recibiste una postulación nueva',
    POSTULACION_ESTADO: 'Tu postulación tiene novedades',
    CV_REVISADO: 'Una empresa revisó tu hoja de vida',
    SEGURIDAD: 'Alerta de seguridad en tu cuenta',
};

// Un push por grupo cada tanto: veinte likes seguidos no son veinte avisos.
const PUSH_GRUPO_CADA_MS = 5 * 60 * 1000;

const ESTADO_POSTULANTE = {
    VISTA: 'vista por la empresa',
    PRESELECCIONADA: 'preseleccionada',
    DESCARTADA: 'no seleccionada',
    CONTRATADA: '¡seleccionada!',
};

const error = (mensaje, status) => {
    const err = new Error(mensaje);
    err.status = status;
    return err;
};

const entero = (valor, defecto, min, max) => {
    const n = Number.parseInt(valor, 10);
    if (Number.isNaN(n)) return defecto;
    return Math.min(Math.max(n, min), max);
};

const urlPublica = (base, ruta) => {
    if (!ruta) return null;
    if (/^https?:\/\//i.test(ruta)) return ruta;
    return base ? `${base}${ruta.startsWith('/') ? '' : '/'}${ruta}` : ruta;
};

// ---------- Texto ----------

const nombreActor = (f) => {
    if (!f.actor_id) return 'Alguien';
    if (f.actor_tipo === 'NEGOCIO' && f.actor_negocio) return f.actor_negocio;
    return [f.actor_nombres, f.actor_apellidos].filter(Boolean).join(' ').trim() || 'Alguien';
};

// "Ana", "Ana y otra persona", "Ana y 3 personas más".
const conOtros = (f) => {
    const otros = Math.max(0, (f.actores?.length || f.cantidad || 1) - 1);
    const a = nombreActor(f);
    if (otros === 0) return { quien: a, plural: false };
    return { quien: `${a} y ${otros === 1 ? 'otra persona' : `${otros} personas más`}`, plural: true };
};

// El texto y el destino de cada tipo. Se arma al leer: si alguien cambia su
// nombre o el título del anuncio, la campana muestra lo de ahora.
const componer = (f) => {
    const titulo = f.anuncio_titulo ? `«${f.anuncio_titulo}»` : 'tu publicación';
    const anuncio = f.anuncio_id ? `/anuncio/${f.anuncio_id}` : '/mis-anuncios';
    const { quien, plural } = conOtros(f);
    switch (f.tipo) {
        case 'SEGUIDOR':
            return {
                texto: `${quien} ${plural ? 'empezaron' : 'empezó'} a seguirte`,
                url: plural || !f.actor_id ? `/perfil/${f.usuario_id}` : `/perfil/${f.actor_id}`,
            };
        case 'ME_GUSTA':
            return { texto: `A ${quien} le${plural ? 's' : ''} gustó ${titulo}`, url: anuncio };
        case 'COMENTARIO':
            return { texto: `${quien} ${plural ? 'comentaron' : 'comentó'} ${titulo}`, url: anuncio };
        case 'RESPUESTA':
            return { texto: `${quien} ${plural ? 'respondieron' : 'respondió'} a tu comentario en ${titulo}`, url: anuncio };
        case 'GUARDADO': {
            // Guardar es privado: se dice cuántos, nunca quiénes.
            const n = f.actores?.length || f.cantidad || 1;
            return {
                texto: n === 1 ? `Alguien guardó ${titulo} en sus favoritos` : `${n} personas guardaron ${titulo} en sus favoritos`,
                url: anuncio,
            };
        }
        case 'MENSAJE':
            return {
                texto: f.cantidad > 1 ? `${nombreActor(f)} te envió ${f.cantidad} mensajes` : `${nombreActor(f)} te envió un mensaje`,
                url: f.conversacion_id ? `/mensajes/${f.conversacion_id}` : '/mensajes',
            };
        case 'ANUNCIO_APROBADO':
            return { texto: `${titulo} fue aprobado y ya está publicado`, url: anuncio };
        case 'ANUNCIO_RECHAZADO':
            return { texto: `${titulo} no pasó la revisión. Lee la nota y edítalo para volver a publicarlo.`, url: '/mis-anuncios' };
        case 'ANUNCIO_VENCIDO':
            return { texto: `${titulo} venció y ya no aparece en el feed`, url: '/mis-anuncios' };
        case 'NUEVA_VACANTE':
            return { texto: `${nombreActor(f)} publicó una vacante: ${titulo}`, url: anuncio };
        case 'POSTULACION_NUEVA':
            return {
                texto: `${quien} ${plural ? 'se postularon' : 'se postuló'} a ${titulo}`,
                url: f.anuncio_id ? `/postulaciones?anuncio=${f.anuncio_id}` : '/postulaciones',
            };
        case 'POSTULACION_ESTADO':
            return {
                texto: `Tu postulación a ${titulo} ahora está ${ESTADO_POSTULANTE[f.datos?.estado] || 'actualizada'}`,
                url: '/postulaciones',
            };
        case 'CV_REVISADO':
            return { texto: `${nombreActor(f)} revisó tu hoja de vida para ${titulo}`, url: '/postulaciones' };
        case 'SEGURIDAD':
            return {
                texto:
                    f.datos?.evento === 'CONTRASENA_RESTABLECIDA'
                        ? 'Se restableció la contraseña de tu cuenta con un código enviado a tu correo. Si no fuiste tú, cámbiala ahora.'
                        : 'Se cambió la contraseña de tu cuenta y se cerraron las demás sesiones. Si no fuiste tú, cámbiala ahora.',
                url: '/configuracion?seccion=seguridad',
            };
        default:
            return { texto: 'Tienes una notificación nueva', url: '/notificaciones' };
    }
};

const aNotificacion = (f, base) => {
    const { texto, url } = componer(f);
    return {
        id: Number(f.id),
        tipo: f.tipo,
        categoria: CATEGORIA[f.tipo],
        texto,
        url,
        cantidad: f.cantidad,
        actor: f.actor_id
            ? {
                  id: f.actor_id,
                  nombre: nombreActor(f),
                  foto: urlPublica(base, f.actor_tipo === 'NEGOCIO' ? f.actor_logo || f.actor_foto : f.actor_foto),
                  esNegocio: f.actor_tipo === 'NEGOCIO',
              }
            : null,
        // Guardar es anónimo: no se manda quién fue.
        ...(f.tipo === 'GUARDADO' ? { actor: null } : {}),
        anuncio: f.anuncio_id ? { id: Number(f.anuncio_id), titulo: f.anuncio_titulo, pilar: f.anuncio_pilar } : null,
        creadaEn: f.creada_en,
        actualizadaEn: f.actualizada_en,
        leida: Boolean(f.leida_en),
    };
};

// ---------- Preferencias ----------

const normalizarPreferencias = (p) => {
    const categorias = {};
    for (const c of CATEGORIAS) {
        const actual = p.categorias?.[c] || {};
        categorias[c] = {
            app: SIEMPRE_EN_APP.has(c) ? true : actual.app !== false,
            push: actual.push !== false,
        };
    }
    return { categorias, sonido: SONIDOS.includes(p.sonido) ? p.sonido : 'campana' };
};

const preferenciasDe = async (usuarioId) => normalizarPreferencias(await notificacionModel.obtenerPreferencias(usuarioId));

// ---------- Reparto ----------

// Avisa en vivo a las pestañas abiertas y, si no hay ninguna (o es de
// seguridad), manda push.
const despachar = async (id) => {
    const fila = await notificacionModel.buscarPorId(id);
    if (!fila) return;
    const prefs = await preferenciasDe(fila.usuario_id);
    const categoria = CATEGORIA[fila.tipo];

    const noLeidas = await notificacionModel.contarNoLeidas(fila.usuario_id);
    // La URL de las fotos la arma cada cliente con su API; aquí van relativas.
    hub.emitir(fila.usuario_id, { t: 'notificacion', notificacion: aNotificacion(fila, ''), noLeidas, sonido: prefs.sonido });

    const conectado = hub.estaConectado(fila.usuario_id);
    if (!prefs.categorias[categoria].push || (conectado && fila.tipo !== 'SEGURIDAD')) return;
    if (!fcmService.configurado()) return;

    const ultimo = fila.push_enviado_en ? new Date(fila.push_enviado_en).getTime() : 0;
    if (fila.clave_grupo && Date.now() - ultimo < PUSH_GRUPO_CADA_MS) return;

    const tokens = await notificacionModel.tokensDe(fila.usuario_id);
    if (tokens.length === 0) return;
    const { url } = componer(fila);
    const { invalidos } = await fcmService.enviar(tokens, {
        id: String(fila.id),
        titulo: 'Baknazo',
        texto: TEXTO_PUSH[fila.tipo] || 'Tienes una notificación nueva',
        url,
        // La misma etiqueta reemplaza el aviso anterior del grupo en vez de apilarse.
        etiqueta: fila.clave_grupo || `notificacion-${fila.id}`,
        silencio: prefs.sonido === 'ninguno' ? '1' : '0',
    });
    await notificacionModel.eliminarTokens(invalidos);
    await notificacionModel.marcarPushEnviado(fila.id);
};

/**
 * Lo que llaman los demás servicios. Nunca lanza: una notificación que falla
 * no puede tumbar el like, el mensaje o la postulación que la provocó.
 *
 * @param {object} n { usuarioId, tipo, actorId?, anuncioId?, conversacionId?,
 *   postulacionId?, datos?, claveGrupo?, claveUnica? }
 */
const notificar = async (n) => {
    try {
        if (!n.usuarioId || !CATEGORIA[n.tipo]) return;
        // Nadie recibe avisos de lo que hizo él mismo.
        if (n.actorId && n.actorId === n.usuarioId) return;
        const prefs = await preferenciasDe(n.usuarioId);
        if (!prefs.categorias[CATEGORIA[n.tipo]].app) return;
        const id = await notificacionModel.registrar(n);
        if (id) await despachar(id);
    } catch (e) {
        console.error('[notificaciones]', n?.tipo, e.message);
    }
};

// La misma notificación para muchas personas (seguidores de un negocio).
const notificarVarios = async (usuarioIds, n) => {
    for (const usuarioId of usuarioIds) await notificar({ ...n, usuarioId });
};

// ---------- Casos de uso (API) ----------

const listar = async ({ usuarioId, query, base }) => {
    const limite = entero(query.limite, 20, 1, 50);
    const offset = entero(query.offset, 0, 0, 100000);
    const filas = await notificacionModel.listar({
        usuarioId,
        soloNoLeidas: query.estado === 'no_leidas',
        limite: limite + 1,
        offset,
    });
    return {
        items: filas.slice(0, limite).map((f) => aNotificacion(f, base)),
        hayMas: filas.length > limite,
        noLeidas: await notificacionModel.contarNoLeidas(usuarioId),
    };
};

const contarNoLeidas = async ({ usuarioId }) => ({ total: await notificacionModel.contarNoLeidas(usuarioId) });

// Avisa a las otras pestañas para que bajen su contador.
const avisarConteo = async (usuarioId) => {
    const noLeidas = await notificacionModel.contarNoLeidas(usuarioId);
    hub.emitir(usuarioId, { t: 'notificaciones_leidas', noLeidas });
    return noLeidas;
};

// ids: lista de ids, o 'todas'.
const marcarLeidas = async ({ usuarioId, ids }) => {
    let lista = null;
    if (ids !== 'todas') {
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((i) => /^\d{1,18}$/.test(String(i)))) {
            throw error('Indica qué notificaciones marcar', 400);
        }
        lista = ids.map(String);
    }
    await notificacionModel.marcarLeidas(usuarioId, lista);
    return { noLeidas: await avisarConteo(usuarioId) };
};

const eliminar = async ({ usuarioId, id }) => {
    if (!/^\d{1,18}$/.test(String(id)) || !(await notificacionModel.eliminar(usuarioId, id))) {
        throw error('Notificación no encontrada', 404);
    }
    return { noLeidas: await avisarConteo(usuarioId) };
};

const obtenerPreferencias = async ({ usuarioId }) => ({
    ...(await preferenciasDe(usuarioId)),
    pushDisponible: fcmService.configurado(),
});

const guardarPreferencias = async ({ usuarioId, datos }) => {
    const actual = await preferenciasDe(usuarioId);
    const categorias = { ...actual.categorias };
    if (datos.categorias !== undefined) {
        if (!datos.categorias || typeof datos.categorias !== 'object') throw error('Preferencias inválidas', 400);
        for (const [c, canales] of Object.entries(datos.categorias)) {
            if (!CATEGORIAS.includes(c) || !canales || typeof canales !== 'object') throw error(`Categoría inválida: ${c}`, 400);
            for (const canal of ['app', 'push']) {
                if (canales[canal] !== undefined && typeof canales[canal] !== 'boolean') throw error('Valor inválido', 400);
            }
            categorias[c] = {
                app: SIEMPRE_EN_APP.has(c) ? true : canales.app ?? categorias[c].app,
                push: canales.push ?? categorias[c].push,
            };
        }
    }
    let { sonido } = actual;
    if (datos.sonido !== undefined) {
        if (!SONIDOS.includes(datos.sonido)) throw error('Sonido inválido', 400);
        sonido = datos.sonido;
    }
    const guardadas = await notificacionModel.guardarPreferencias(usuarioId, { categorias, sonido });
    return { ...normalizarPreferencias(guardadas), pushDisponible: fcmService.configurado() };
};

const registrarDispositivo = async ({ usuarioId, token, navegador }) => {
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096 || !/^[\w:.-]+$/.test(token)) {
        throw error('Token de dispositivo inválido', 400);
    }
    const nav = typeof navegador === 'string' ? navegador.slice(0, 160) : null;
    await notificacionModel.registrarDispositivo({ usuarioId, token, navegador: nav });
    return { registrado: true };
};

const eliminarDispositivo = async ({ usuarioId, token }) => {
    if (typeof token !== 'string' || token.length > 4096) throw error('Token de dispositivo inválido', 400);
    await notificacionModel.eliminarDispositivo(usuarioId, token);
    return { registrado: false };
};

// ---------- Tareas periódicas ----------

// Reparte lo que insertó la base (moderación) y revisa vencimientos.
const despacharPendientes = async () => {
    const ids = await notificacionModel.tomarPendientes();
    for (const id of ids) {
        await despachar(id).catch((e) => console.error('[notificaciones] despachar', id, e.message));
    }
    return ids.length;
};

const revisarVencidos = async () => {
    const nuevas = await notificacionModel.registrarVencidos();
    if (nuevas > 0) await despacharPendientes();
};

let tareas = [];
const iniciarTareas = () => {
    if (tareas.length > 0) return;
    const proteger = (fn, nombre) => () => fn().catch((e) => console.error(`[notificaciones] ${nombre}:`, e.message));
    tareas = [
        setInterval(proteger(despacharPendientes, 'pendientes'), 30 * 1000),
        setInterval(proteger(revisarVencidos, 'vencidos'), 10 * 60 * 1000),
        setInterval(proteger(notificacionModel.limpiarAntiguas, 'limpieza'), 24 * 60 * 60 * 1000),
    ];
    for (const t of tareas) t.unref?.();
    // Al arrancar se pone al día con lo que quedó pendiente.
    setTimeout(proteger(revisarVencidos, 'vencidos'), 5 * 1000).unref?.();
};

module.exports = {
    CATEGORIAS,
    SONIDOS,
    notificar,
    notificarVarios,
    listar,
    contarNoLeidas,
    marcarLeidas,
    eliminar,
    obtenerPreferencias,
    guardarPreferencias,
    registrarDispositivo,
    eliminarDispositivo,
    despacharPendientes,
    revisarVencidos,
    iniciarTareas,
    // Para el chat: leer la conversación apaga su aviso de mensajes.
    marcarLeidasDeConversacion: async (usuarioId, conversacionId) => {
        if ((await notificacionModel.marcarLeidasDeConversacion(usuarioId, conversacionId)) > 0) await avisarConteo(usuarioId);
    },
};
