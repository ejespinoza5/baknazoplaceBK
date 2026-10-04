const anuncioModel = require('../models/anuncioModel');
const chatModel = require('../models/chatModel');
const hub = require('../realtime/hub');
const notificacionService = require('./notificacionService');

const CONTENIDO_MAX = 2000;
const LIMITE_MENSAJES = 40;
const LIMITE_CONVERSACIONES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENTE_ID = /^[A-Za-z0-9_-]{8,64}$/;
// Se puede escribir sobre productos y servicios. Las vacantes tienen su propio
// canal (la postulación con CV), y abrir un chat ahí lo esquivaría.
const PILARES_CON_CHAT = ['productos', 'servicios'];

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

const esId = (valor) => /^\d{1,18}$/.test(String(valor));

const urlPublica = (base, ruta) => {
    if (!ruta) return null;
    if (/^https?:\/\//i.test(ruta)) return ruta;
    return `${base}${ruta.startsWith('/') ? '' : '/'}${ruta}`;
};

const nombreDe = (tipo, nombres, apellidos, negocio) =>
    tipo === 'NEGOCIO' && negocio ? negocio : [nombres, apellidos].filter(Boolean).join(' ').trim();

// Texto plano: sin caracteres de control (salvo saltos de línea y tabulador),
// sin más de dos líneas en blanco seguidas y sin espacios en los bordes. No se
// escapa HTML porque nunca se pinta como HTML: React lo trata como texto.
const limpiarContenido = (valor) => {
    if (typeof valor !== 'string') return '';
    return valor
        .normalize('NFC')
        .replace(/\r\n?/g, '\n')
        // Controles, caracteres invisibles y los que invierten la dirección del texto.
        .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

// ---------- Serialización ----------

// La tarjeta de un anuncio citado en el chat. Se sigue mostrando aunque ya no
// esté a la venta: es parte de lo que se habló.
const aAnuncio = (a, base) => ({
    id: Number(a.id),
    slug: a.slug,
    titulo: a.titulo,
    pilar: a.pilar,
    precio: a.precio,
    moneda: a.moneda,
    portada: a.portada ? urlPublica(base, `/uploads/${a.portada}`) : null,
    disponible: a.estado === 'PUBLICADO' && !a.vendido && !a.eliminado_en,
});

const anunciosPorId = async (ids, base) => {
    const unicos = [...new Set(ids.filter(Boolean).map(String))];
    const filas = await chatModel.resumenAnuncios(unicos);
    return Object.fromEntries(filas.map((a) => [String(a.id), aAnuncio(a, base)]));
};

// `clienteId` solo viaja a quien mandó el mensaje: es suyo y le sirve para
// reconocer su envío pendiente; al otro no le dice nada.
const aMensaje = (m, usuarioId) => ({
    id: Number(m.id),
    conversacionId: Number(m.conversacion_id),
    remitenteId: m.remitente_id,
    contenido: m.contenido,
    anuncioId: m.anuncio_id ? Number(m.anuncio_id) : null,
    creadoEn: m.creado_en,
    entregadoEn: m.entregado_en,
    leidoEn: m.leido_en,
    ...(m.remitente_id === usuarioId ? { clienteId: m.cliente_id } : {}),
});

const aConversacion = (f, usuarioId, base) => ({
    id: Number(f.id),
    creadoEn: f.creado_en,
    ultimoMensajeEn: f.ultimo_mensaje_en,
    otro: {
        id: f.otro_id,
        nombre: nombreDe(f.otro_tipo, f.otro_nombres, f.otro_apellidos, f.otro_negocio),
        foto: urlPublica(base, f.otro_tipo === 'NEGOCIO' ? f.otro_logo || f.otro_foto : f.otro_foto),
        esNegocio: f.otro_tipo === 'NEGOCIO',
    },
    // El anuncio del que se habla ahora (el último por el que se escribió).
    anuncio: f.anuncio_id
        ? aAnuncio(
              {
                  id: f.anuncio_id,
                  slug: f.anuncio_slug,
                  titulo: f.anuncio_titulo,
                  pilar: f.anuncio_pilar,
                  precio: f.anuncio_precio,
                  moneda: f.anuncio_moneda,
                  portada: f.anuncio_portada,
                  estado: f.anuncio_estado,
                  vendido: f.anuncio_vendido,
                  eliminado_en: f.anuncio_eliminado,
              },
              base
          )
        : null,
    ultimoMensaje: f.um_id
        ? aMensaje(
              {
                  id: f.um_id,
                  conversacion_id: f.id,
                  remitente_id: f.um_remitente,
                  contenido: f.um_contenido,
                  anuncio_id: f.um_anuncio,
                  creado_en: f.um_creado,
                  entregado_en: f.um_entregado,
                  leido_en: f.um_leido,
              },
              usuarioId
          )
        : null,
    noLeidos: f.no_leidos,
    bloqueo: { yoBloquee: f.yo_bloquee, meBloquearon: f.me_bloquearon },
});

// Comprueba que el usuario participa. A quien no, se le responde igual que si
// la conversación no existiera: no se confirma que exista.
const exigirParticipante = async (conversacionId, usuarioId) => {
    const c = esId(conversacionId) ? await chatModel.participantes(conversacionId) : null;
    if (!c || (c.iniciador_id !== usuarioId && c.destinatario_id !== usuarioId)) {
        throw error('Conversación no encontrada', 404);
    }
    return { ...c, otroId: c.iniciador_id === usuarioId ? c.destinatario_id : c.iniciador_id };
};

// ---------- Avisos en vivo ----------

// Agrupa las filas marcadas por conversación y remitente, y avisa a cada
// remitente hasta qué mensaje le llegó (o leyó) el otro.
const avisarAcuses = (filas, tipo, campoFecha, conversacionId = null) => {
    const grupos = new Map();
    for (const f of filas) {
        const conv = Number(conversacionId ?? f.conversacion_id);
        const clave = `${conv}|${f.remitente_id}`;
        const actual = grupos.get(clave);
        if (!actual || Number(f.id) > actual.hastaId) {
            grupos.set(clave, { remitenteId: f.remitente_id, conversacionId: conv, hastaId: Number(f.id), fecha: f[campoFecha] });
        }
    }
    const campo = campoFecha === 'leido_en' ? 'leidoEn' : 'entregadoEn';
    for (const g of grupos.values()) {
        hub.emitir(g.remitenteId, { t: tipo, conversacionId: g.conversacionId, hastaId: g.hastaId, [campo]: g.fecha });
    }
};

// ---------- Casos de uso ----------

const listar = async ({ usuarioId, query, base }) => {
    const limite = entero(query.limite, 30, 1, LIMITE_CONVERSACIONES);
    const offset = entero(query.offset, 0, 0, 100000);
    const filas = await chatModel.listar({ usuarioId, limite: limite + 1, offset });
    return {
        items: filas.slice(0, limite).map((f) => aConversacion(f, usuarioId, base)),
        hayMas: filas.length > limite,
    };
};

const obtener = async ({ usuarioId, id, base }) => {
    const fila = esId(id) ? await chatModel.buscarParaUsuario(id, usuarioId) : null;
    if (!fila) throw error('Conversación no encontrada', 404);
    return aConversacion(fila, usuarioId, base);
};

// Abre (o recupera) la conversación con quien publicó un anuncio, o con una
// persona desde su perfil. Hay una sola por par de personas: escribir por otro
// anuncio a la misma persona sigue en el mismo chat, y ese anuncio pasa a ser
// del que se habla. La otra persona la decide el servidor: con un anuncio es
// siempre su autor, nunca un id que mande el navegador.
const iniciar = async ({ usuarioId, datos, base }) => {
    let destinatarioId;
    let anuncioId = null;

    if (datos.anuncioId !== undefined && datos.anuncioId !== null) {
        if (!esId(datos.anuncioId)) throw error('Anuncio no encontrado', 404);
        const anuncio = await anuncioModel.buscarPorId(datos.anuncioId);
        const visible =
            anuncio &&
            anuncio.estado === 'PUBLICADO' &&
            !anuncio.eliminado_en &&
            (!anuncio.expira_en || new Date(anuncio.expira_en) > new Date());
        if (!visible) throw error('Anuncio no encontrado', 404);
        if (!PILARES_CON_CHAT.includes(anuncio.pilar)) {
            throw error('Para una vacante, postúlate desde el anuncio', 400);
        }
        if (anuncio.autor_usuario_id === usuarioId) throw error('Este anuncio es tuyo', 400);
        destinatarioId = anuncio.autor_usuario_id;
        anuncioId = anuncio.id;
    } else if (typeof datos.usuarioId === 'string' && UUID.test(datos.usuarioId)) {
        if (datos.usuarioId === usuarioId) throw error('No puedes escribirte a ti mismo', 400);
        destinatarioId = datos.usuarioId;
    } else {
        throw error('Indica el anuncio o la persona con quien quieres hablar', 400);
    }

    if (!(await chatModel.buscarUsuarioActivo(destinatarioId))) throw error('Esta persona no está disponible', 404);

    // Abrirla está permitido aunque haya un bloqueo: así quien bloqueó puede
    // desbloquear desde el chat. Lo que se impide es enviar.
    const id = await chatModel.obtenerOCrear({ iniciadorId: usuarioId, destinatarioId, anuncioId });
    return obtener({ usuarioId, id, base });
};

const listarMensajes = async ({ usuarioId, id, query, base }) => {
    const c = await exigirParticipante(id, usuarioId);
    const antesDe = query.antesDe && esId(query.antesDe) ? query.antesDe : null;
    const limite = entero(query.limite, LIMITE_MENSAJES, 1, 100);
    const filas = await chatModel.listarMensajes({ conversacionId: c.id, antesDe, limite: limite + 1 });

    // Abrir la conversación también es recibir lo que había pendiente.
    if (!antesDe) {
        const entregados = await chatModel.marcarEntregados(usuarioId, c.id);
        if (entregados.length > 0) {
            avisarAcuses(entregados, 'entregado', 'entregado_en');
            const ids = new Map(entregados.map((e) => [String(e.id), e.entregado_en]));
            for (const f of filas) if (ids.has(String(f.id))) f.entregado_en = ids.get(String(f.id));
        }
    }

    const pagina = filas.slice(0, limite);
    return {
        // Del más antiguo al más nuevo, que es como se pintan.
        items: pagina.reverse().map((m) => aMensaje(m, usuarioId)),
        hayMas: filas.length > limite,
        // Las tarjetas de los anuncios citados en esta página, por id.
        anuncios: await anunciosPorId(pagina.map((m) => m.anuncio_id), base),
    };
};

// El corazón del chat. Lo llama el socket: valida, guarda y reparte.
// Devuelve el mensaje para el acuse de quien lo mandó.
const enviar = async ({ usuarioId, conversacionId, contenido, clienteId, base, socketOrigen = null }) => {
    if (typeof clienteId !== 'string' || !CLIENTE_ID.test(clienteId)) throw error('Identificador de envío inválido', 400);
    const texto = limpiarContenido(contenido);
    if (!texto) throw error('Escribe un mensaje', 400);
    if (texto.length > CONTENIDO_MAX) throw error(`El mensaje admite máximo ${CONTENIDO_MAX} caracteres`, 400);

    const c = await exigirParticipante(conversacionId, usuarioId);
    const remitente = await chatModel.buscarUsuarioActivo(usuarioId);
    if (!remitente) throw error('Tu cuenta no puede enviar mensajes', 403);

    // Un bloqueo en cualquier sentido cierra la conversación para los dos. El
    // texto es el mismo en ambos lados: a quien bloquearon no se le confirma.
    const bloqueo = await chatModel.estadoBloqueo(usuarioId, c.otroId);
    if (bloqueo.aBloqueo || bloqueo.bBloqueo) throw error('No puedes enviar mensajes en esta conversación', 403);

    const { mensaje, nuevo } = await chatModel.insertarMensaje({
        conversacionId: c.id,
        remitenteId: usuarioId,
        contenido: texto,
        clienteId,
    });
    if (!mensaje || Number(mensaje.conversacion_id) !== Number(c.id)) throw error('Identificador de envío repetido', 409);
    // Un reintento de algo ya guardado: se confirma sin volver a repartirlo.
    if (!nuevo) return aMensaje(mensaje, usuarioId);

    // Si el destinatario tiene la app abierta, ya le llegó.
    if (hub.estaConectado(c.otroId)) {
        const entregados = await chatModel.marcarEntregados(c.otroId, c.id);
        const este = entregados.find((e) => String(e.id) === String(mensaje.id));
        if (este) mensaje.entregado_en = este.entregado_en;
        avisarAcuses(entregados, 'entregado', 'entregado_en');
    }

    // La tarjeta del anuncio viaja con el mensaje: si el otro tiene el chat
    // abierto, puede que todavía no conozca ese anuncio.
    const anuncio = mensaje.anuncio_id ? (await anunciosPorId([mensaje.anuncio_id], base))[String(mensaje.anuncio_id)] ?? null : null;

    const noLeidos = await chatModel.contarNoLeidos(c.otroId);
    hub.emitir(c.otroId, {
        t: 'mensaje',
        mensaje: aMensaje(mensaje, c.otroId),
        anuncio,
        remitente: { id: usuarioId, nombre: nombreDe(remitente.tipo_cuenta, remitente.nombres, remitente.apellidos, remitente.nombre_comercial) },
        noLeidos,
    });
    // Las demás pestañas de quien escribió también lo pintan.
    hub.emitir(usuarioId, { t: 'mensaje', mensaje: aMensaje(mensaje, usuarioId), anuncio }, socketOrigen);

    // En la campana, un aviso por conversación que cuenta los mensajes; si el
    // destinatario no tiene la app abierta, le llega como push.
    notificacionService.notificar({
        usuarioId: c.otroId,
        tipo: 'MENSAJE',
        actorId: usuarioId,
        conversacionId: c.id,
        claveGrupo: `mensajes:${c.id}`,
        // Solo para el push (no se guarda en la notificación).
        push: { mensaje: texto },
    });

    return aMensaje(mensaje, usuarioId);
};

const marcarLeida = async ({ usuarioId, id }) => {
    const c = await exigirParticipante(id, usuarioId);
    const leidos = await chatModel.marcarLeidos(c.id, usuarioId);
    if (leidos.length > 0) avisarAcuses(leidos, 'leido', 'leido_en', c.id);
    const noLeidos = await chatModel.contarNoLeidos(usuarioId);
    // Las otras pestañas del lector bajan su contador sin preguntar.
    hub.emitir(usuarioId, { t: 'conversacion_leida', conversacionId: Number(c.id), noLeidos });
    // Leída la conversación, su aviso en la campana también.
    notificacionService.marcarLeidasDeConversacion(usuarioId, c.id).catch(() => undefined);
    return { leidos: leidos.length, noLeidos };
};

const contarNoLeidos = async ({ usuarioId }) => ({ total: await chatModel.contarNoLeidos(usuarioId) });

// Al conectarse un dispositivo: lo que le mandaron mientras no estaba ya llegó.
const alConectar = async (usuarioId) => {
    const entregados = await chatModel.marcarEntregados(usuarioId);
    if (entregados.length > 0) avisarAcuses(entregados, 'entregado', 'entregado_en');
};

// ---------- Bloqueos ----------

// Avisa a los dos lados cómo quedó el bloqueo, cada uno desde su punto de
// vista, para que el chat abierto se cierre o se reabra sin recargar.
const avisarBloqueo = async (a, b) => {
    const [estado, conversacionId] = await Promise.all([chatModel.estadoBloqueo(a, b), chatModel.delPar(a, b)]);
    const conv = conversacionId ? Number(conversacionId) : null;
    hub.emitir(a, { t: 'bloqueo', conversacionId: conv, usuarioId: b, yoBloquee: estado.aBloqueo, meBloquearon: estado.bBloqueo });
    hub.emitir(b, { t: 'bloqueo', conversacionId: conv, usuarioId: a, yoBloquee: estado.bBloqueo, meBloquearon: estado.aBloqueo });
    return { yoBloquee: estado.aBloqueo, meBloquearon: estado.bBloqueo };
};

const validarObjetivo = (usuarioId, objetivoId) => {
    if (typeof objetivoId !== 'string' || !UUID.test(objetivoId)) throw error('Usuario no encontrado', 404);
    if (objetivoId === usuarioId) throw error('No puedes bloquearte a ti mismo', 400);
};

const bloquear = async ({ usuarioId, objetivoId }) => {
    validarObjetivo(usuarioId, objetivoId);
    if (!(await chatModel.buscarUsuarioActivo(objetivoId))) throw error('Usuario no encontrado', 404);
    await chatModel.bloquear(usuarioId, objetivoId);
    return avisarBloqueo(usuarioId, objetivoId);
};

// Desbloquear siempre se puede, aunque la otra cuenta ya no esté activa.
const desbloquear = async ({ usuarioId, objetivoId }) => {
    validarObjetivo(usuarioId, objetivoId);
    await chatModel.desbloquear(usuarioId, objetivoId);
    return avisarBloqueo(usuarioId, objetivoId);
};

module.exports = {
    CONTENIDO_MAX,
    limpiarContenido,
    listar,
    obtener,
    iniciar,
    listarMensajes,
    enviar,
    marcarLeida,
    contarNoLeidos,
    alConectar,
    bloquear,
    desbloquear,
};
