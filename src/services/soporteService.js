const soporteModel = require('../models/soporteModel');
const chatModel = require('../models/chatModel');
const adminModel = require('../models/adminModel');
const hub = require('../realtime/hub');
const notificacionService = require('./notificacionService');
const { limpiarContenido, CONTENIDO_MAX } = require('./chatService');

// Soporte: el usuario escribe al equipo de Baknazo y responde un
// administrador desde el panel. Al usuario nunca se le dice quién respondió.
// Los avisos en vivo viajan por el WebSocket del chat (eventos `soporte*`).

const LIMITE_MENSAJES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VISTAS = ['pendientes', 'abiertos', 'resueltos', 'todos'];

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

const esId = (v) => /^\d{1,18}$/.test(String(v));

const nombrePersona = (nombres, apellidos) => [nombres, apellidos].filter(Boolean).join(' ').trim();

const respuestaAutomatica = (nombre) =>
    `Hola${nombre ? `, ${nombre}` : ''}. Recibimos tu mensaje. Un administrador de Baknazo te responderá por aquí ` +
    'lo antes posible, normalmente en menos de 24 horas. Te avisaremos cuando lo haga.';

const validarContenido = (valor) => {
    const texto = limpiarContenido(valor);
    if (!texto) throw error('Escribe un mensaje', 400);
    if (texto.length > CONTENIDO_MAX) throw error(`El mensaje admite máximo ${CONTENIDO_MAX} caracteres`, 400);
    return texto;
};

// Lo que ve el usuario: el equipo es uno solo, sin nombres.
const AUTOR_PUBLICO = { USUARIO: 'usuario', ADMIN: 'equipo', SISTEMA: 'sistema' };
const aMensajeUsuario = (m) => ({
    id: Number(m.id),
    autor: AUTOR_PUBLICO[m.autor],
    contenido: m.contenido,
    creadoEn: m.creado_en,
    leidoEn: m.leido_en,
});

const aMensajeAdmin = (m) => ({
    id: Number(m.id),
    autor: m.autor,
    contenido: m.contenido,
    creadoEn: m.creado_en,
    leidoEn: m.leido_en,
    admin: m.autor === 'ADMIN' ? m.admin_nombre || 'Administrador' : null,
});

const pagina = async (usuarioId, query, convertir) => {
    const antesDe = query.antesDe && esId(query.antesDe) ? query.antesDe : null;
    const limite = entero(query.limite, LIMITE_MENSAJES, 1, 100);
    const filas = await soporteModel.listarMensajes({ usuarioId, antesDe, limite: limite + 1 });
    return {
        // Del más antiguo al más nuevo, que es como se pintan.
        items: filas.slice(0, limite).reverse().map(convertir),
        hayMas: filas.length > limite,
    };
};

// ---------- Usuario ----------

const obtener = async ({ usuarioId, query }) => {
    const h = await soporteModel.hilo(usuarioId);
    if (!h) return { estado: null, items: [], hayMas: false, noLeidos: 0 };
    return {
        estado: h.estado,
        ...(await pagina(usuarioId, query, aMensajeUsuario)),
        noLeidos: await soporteModel.contarNoLeidosUsuario(usuarioId),
    };
};

const enviar = async ({ usuarioId, contenido }) => {
    const texto = validarContenido(contenido);
    const usuario = await chatModel.buscarUsuarioActivo(usuarioId);
    if (!usuario) throw error('Tu cuenta no puede enviar mensajes', 403);
    const nombre = usuario.tipo_cuenta === 'NEGOCIO' && usuario.nombre_comercial ? usuario.nombre_comercial : usuario.nombres;

    const creados = (
        await soporteModel.insertarDeUsuario({ usuarioId, contenido: texto, respuestaAutomatica: respuestaAutomatica(nombre) })
    ).map(aMensajeUsuario);
    const noLeidos = await soporteModel.contarNoLeidosUsuario(usuarioId);
    // Las demás pestañas del usuario también lo pintan.
    for (const mensaje of creados) hub.emitir(usuarioId, { t: 'soporte', mensaje, noLeidos });
    return { estado: 'ABIERTO', items: creados, noLeidos };
};

const marcarLeido = async ({ usuarioId }) => {
    const leidos = await soporteModel.marcarLeidosPorUsuario(usuarioId);
    if (leidos > 0) hub.emitir(usuarioId, { t: 'soporte_leido', noLeidos: 0 });
    // Leído el soporte, su aviso en la campana también.
    notificacionService.marcarLeidasDeSoporte(usuarioId).catch(() => undefined);
    return { noLeidos: 0 };
};

const contarNoLeidos = async ({ usuarioId }) => ({ total: await soporteModel.contarNoLeidosUsuario(usuarioId) });

// ---------- Panel ----------

const exigirUuid = (id) => {
    if (!UUID.test(String(id))) throw error('Conversación no encontrada', 404);
};

const listarHilos = async ({ query }) => {
    const vista = VISTAS.includes(query.vista) ? query.vista : 'pendientes';
    const limite = entero(query.limite, 20, 1, 50);
    const offset = entero(query.offset, 0, 0, 100000);
    const q = typeof query.q === 'string' && query.q.trim() ? query.q.trim().slice(0, 80) : null;
    const filas = await soporteModel.listarHilos({ vista, q, limite, offset });
    return {
        vista,
        total: filas[0]?.total ?? 0,
        items: filas.map((f) => ({
            usuario: {
                id: f.usuario_id,
                nombre: f.nombre_comercial || nombrePersona(f.nombres, f.apellidos),
                correo: f.correo,
                tipo: f.tipo_cuenta,
                estado: f.usuario_estado,
            },
            estado: f.estado,
            pendientes: f.pendientes,
            ultimoMensajeEn: f.ultimo_mensaje_en,
            ultimo: f.ultimo_autor ? { autor: f.ultimo_autor, contenido: f.ultimo_contenido } : null,
        })),
    };
};

// Abrir la conversación en el panel es leerla: el usuario ve el "leído".
const obtenerHilo = async ({ usuarioId, query }) => {
    exigirUuid(usuarioId);
    const u = await soporteModel.usuarioDelHilo(usuarioId);
    if (!u) throw error('Conversación no encontrada', 404);
    if (!query.antesDe) {
        const leidos = await soporteModel.marcarLeidosPorEquipo(usuarioId);
        if (leidos.length > 0) hub.emitir(usuarioId, { t: 'soporte_visto', leidoEn: leidos[0].leido_en });
    }
    return {
        usuario: {
            id: u.usuario_id,
            nombre: u.nombre_comercial || nombrePersona(u.nombres, u.apellidos),
            correo: u.correo,
            tipo: u.tipo_cuenta,
            estado: u.usuario_estado,
            desde: u.usuario_desde,
            anuncios: u.anuncios,
        },
        estado: u.estado,
        creadoEn: u.creado_en,
        resueltoEn: u.resuelto_en,
        resueltoPor: u.resuelto_por_nombre,
        ...(await pagina(usuarioId, query, aMensajeAdmin)),
    };
};

const responder = async ({ actor, usuarioId, contenido, ip }) => {
    exigirUuid(usuarioId);
    const texto = validarContenido(contenido);
    const fila = await soporteModel.insertarDeAdmin({ usuarioId, adminId: actor.id, contenido: texto });
    if (!fila) throw error('Conversación no encontrada', 404);

    const noLeidos = await soporteModel.contarNoLeidosUsuario(usuarioId);
    hub.emitir(usuarioId, { t: 'soporte', mensaje: aMensajeUsuario(fila), noLeidos });
    // En la campana y, si no tiene la app abierta, por push.
    notificacionService.notificar({ usuarioId, tipo: 'SOPORTE', claveGrupo: 'soporte' });
    // El contenido no va a la auditoría: queda en el hilo, con quién lo escribió.
    await adminModel.auditar({
        adminId: actor.id,
        accion: 'soporte.responder',
        objetivoTipo: 'usuario',
        objetivoId: usuarioId,
        detalle: { mensajeId: Number(fila.id) },
        ip,
    });
    return aMensajeAdmin({ ...fila, admin_nombre: actor.nombre });
};

const cambiarEstado = async ({ actor, usuarioId, estado, ip }) => {
    exigirUuid(usuarioId);
    if (!['ABIERTO', 'RESUELTO'].includes(estado)) throw error('Estado no válido', 400);
    const h = await soporteModel.hilo(usuarioId);
    if (!h) throw error('Conversación no encontrada', 404);
    if (h.estado === estado) throw error(estado === 'RESUELTO' ? 'La conversación ya está resuelta' : 'La conversación ya está abierta', 409);
    await soporteModel.cambiarEstado(usuarioId, estado, actor.id);
    // Resolver es haberla atendido: no queda nada pendiente de leer.
    if (estado === 'RESUELTO') await soporteModel.marcarLeidosPorEquipo(usuarioId);
    await adminModel.auditar({
        adminId: actor.id,
        accion: estado === 'RESUELTO' ? 'soporte.resolver' : 'soporte.reabrir',
        objetivoTipo: 'usuario',
        objetivoId: usuarioId,
        detalle: {},
        ip,
    });
    return { estado };
};

module.exports = {
    obtener,
    enviar,
    marcarLeido,
    contarNoLeidos,
    listarHilos,
    obtenerHilo,
    responder,
    cambiarEstado,
    contarPendientes: soporteModel.contarPendientes,
};
