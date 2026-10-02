const bcrypt = require('bcrypt');
const env = require('../config/env');
const adminModel = require('../models/adminModel');
const moderacionModel = require('../models/moderacionModel');
const catalogoModel = require('../models/catalogoModel');
const moderacionService = require('./moderacionService');
const adminAuthService = require('./adminAuthService');
const { generarContrasenaTemporal } = require('../utils/contrasenas');
const { validarCorreo, normalizarCorreo } = require('../utils/validaciones');
const {
    PERMISOS,
    IDS_PERMISOS,
    MOTIVOS_RECHAZO,
    MOTIVOS_DENUNCIA,
    MOTIVOS_REVISION,
} = require('../config/administracion');

// Todo lo que hace el panel. Cada acción recibe `actor` (el administrador del
// token, nunca uno que mande el navegador) y deja rastro en la auditoría.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const texto = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

const urlPublica = (base, ruta) => {
    if (!ruta) return null;
    if (/^https?:\/\//i.test(ruta)) return ruta;
    return `${base}${ruta.startsWith('/') ? '' : '/'}${ruta}`;
};

const nombrePersona = (nombres, apellidos) => [nombres, apellidos].filter(Boolean).join(' ').trim();

const auditar = (actor, accion, objetivoTipo, objetivoId, detalle, ip) =>
    adminModel.auditar({ adminId: actor.id, accion, objetivoTipo, objetivoId, detalle, ip });

// ---------- Catálogos ----------

const catalogos = () => ({
    permisos: PERMISOS,
    motivosRechazo: MOTIVOS_RECHAZO,
    motivosDenuncia: MOTIVOS_DENUNCIA,
    motivosRevision: MOTIVOS_REVISION,
});

// ---------- Estadísticas ----------

const estadisticas = async () => {
    const e = await moderacionModel.estadisticas();
    return {
        usuarios: e.usuarios,
        usuariosNuevos: e.usuarios_nuevos,
        usuariosSuspendidos: e.usuarios_suspendidos,
        publicados: e.publicados,
        pendientes: e.pendientes,
        rechazados: e.rechazados,
        pausados: e.pausados,
        anunciosSemana: e.anuncios_semana,
        denunciados: e.denunciados,
        decisionesSemana: e.decisiones_semana,
        pendienteMasAntiguo: e.pendiente_mas_antiguo,
        serie: e.serie.map((s) => ({ dia: s.dia, total: s.total })),
    };
};

// ---------- Anuncios ----------

const aAnuncioAdmin = (f, base) => ({
    id: Number(f.id),
    slug: f.slug,
    titulo: f.titulo,
    descripcion: f.descripcion,
    pilar: f.pilar,
    estado: f.estado,
    precio: f.precio,
    moneda: f.moneda,
    categoria: f.categoria_nombre,
    categoriaId: f.categoria_id,
    ubicacion: f.canton_nombre,
    creadoEn: f.creado_en,
    publicadoEn: f.publicado_en,
    motivosRevision: f.motivo_revision ? f.motivo_revision.split(',') : [],
    notasModeracion: f.notas_moderacion,
    pausaAdministrativa: f.pausa_administrativa,
    vendido: f.vendido,
    portada: f.portada_key ? urlPublica(base, `/uploads/${f.portada_key}`) : null,
    denunciasPendientes: f.denuncias_pendientes,
    autor: {
        id: f.autor_usuario_id,
        nombre: f.autor_negocio || nombrePersona(f.autor_nombres, f.autor_apellidos),
        correo: f.autor_correo,
        tipo: f.autor_tipo,
        estado: f.autor_estado,
        desde: f.autor_desde,
    },
});

const VISTAS = ['pendientes', 'publicados', 'rechazados', 'pausados', 'denunciados', 'todos'];

const listarAnuncios = async ({ query, base }) => {
    const vista = VISTAS.includes(query.vista) ? query.vista : 'pendientes';
    const limite = entero(query.limite, 20, 1, 50);
    const offset = entero(query.offset, 0, 0, 100000);
    const { filas, total } = await moderacionModel.listarAnuncios({ vista, q: texto(query.q, 80), limite, offset });
    return { items: filas.map((f) => aAnuncioAdmin(f, base)), total, vista };
};

const detalleAnuncio = async ({ id, base }) => {
    if (!/^\d{1,18}$/.test(String(id))) throw error('Anuncio no encontrado', 404);
    const f = await moderacionModel.anuncioAdmin(id);
    if (!f) throw error('Anuncio no encontrado', 404);
    const [fotos, eventos, denuncias] = await Promise.all([
        moderacionModel.fotosDe(id),
        moderacionModel.eventosDe(id),
        moderacionModel.denunciasDe(id),
    ]);
    return {
        ...aAnuncioAdmin(f, base),
        fotos: fotos.map((k) => urlPublica(base, `/uploads/${k}`)),
        historial: eventos.map((e) => ({
            id: Number(e.id),
            accion: e.accion,
            estadoAnterior: e.estado_anterior,
            estadoNuevo: e.estado_nuevo,
            motivo: e.motivo,
            nota: e.nota,
            detalle: e.detalle,
            por: e.admin_nombre || null,
            fecha: e.creado_en,
        })),
        denuncias: denuncias.map((d) => ({
            id: Number(d.id),
            motivo: d.motivo,
            detalle: d.detalle,
            estado: d.estado,
            fecha: d.creado_en,
            denunciante: nombrePersona(d.denunciante_nombres, d.denunciante_apellidos),
            resueltaPor: d.resuelta_por,
        })),
    };
};

/**
 * Una decisión de moderación sobre un anuncio. Valida desde qué estado se
 * puede, guarda el cambio con su historial, cierra las denuncias pendientes y
 * audita. El aviso al dueño lo pone el trigger de la base.
 */
const moderar = async ({ actor, id, accion, motivo, nota, ip }) => {
    if (!/^\d{1,18}$/.test(String(id))) throw error('Anuncio no encontrado', 404);
    const actual = await moderacionModel.anuncioAdmin(id);
    if (!actual || actual.estado === 'ELIMINADO') throw error('Anuncio no encontrado', 404);
    const nota_ = texto(nota, 1000);

    let cambio;
    let evento;
    let denuncias = null;
    if (accion === 'aprobar') {
        if (actual.estado === 'PUBLICADO' && !actual.pausa_administrativa) throw error('El anuncio ya está publicado', 409);
        if (!['PENDIENTE_REVISION', 'RECHAZADO'].includes(actual.estado) && !actual.pausa_administrativa) {
            throw error('Solo se aprueban anuncios en revisión, rechazados o pausados por moderación', 409);
        }
        cambio = { estado: 'PUBLICADO', pausaAdministrativa: false, notas: null };
        evento = { accion: 'APROBADO', nota: nota_ };
        denuncias = 'DESESTIMADA';
    } else if (accion === 'rechazar') {
        const m = MOTIVOS_RECHAZO.find((x) => x.id === motivo);
        if (!m) throw error('Elige un motivo de rechazo', 400);
        if (actual.estado === 'RECHAZADO') throw error('El anuncio ya está rechazado', 409);
        // La nota es lo que lee el dueño en "Mis anuncios" para corregirlo.
        cambio = { estado: 'RECHAZADO', pausaAdministrativa: false, notas: nota_ ? `${m.nombre}: ${nota_}` : m.nombre };
        evento = { accion: 'RECHAZADO', motivo: m.id, nota: nota_ };
        denuncias = 'RESUELTA';
    } else if (accion === 'pausar') {
        if (actual.estado !== 'PUBLICADO') throw error('Solo se pausan anuncios publicados', 409);
        cambio = { estado: 'PAUSADO', pausaAdministrativa: true, notas: nota_ ? `Pausado por moderación: ${nota_}` : 'Pausado por moderación' };
        evento = { accion: 'PAUSADO', nota: nota_ };
        denuncias = 'RESUELTA';
    } else if (accion === 'eliminar') {
        cambio = { estado: 'ELIMINADO', pausaAdministrativa: false };
        evento = { accion: 'ELIMINADO', nota: nota_ };
        denuncias = 'RESUELTA';
    } else {
        throw error('Acción no válida', 400);
    }

    const hecho = await moderacionModel.moderarAnuncio(Number(id), cambio, { ...evento, adminId: actor.id });
    if (!hecho) throw error('Anuncio no encontrado', 404);
    const cerradas = await moderacionModel.resolverDenuncias(id, denuncias, actor.id);
    await auditar(actor, `anuncio.${accion}`, 'anuncio', id, { titulo: actual.titulo, estadoAnterior: actual.estado, motivo: evento.motivo, denunciasCerradas: cerradas }, ip);
    return { id: Number(id), estado: cambio.estado };
};

// ---------- Denuncias ----------

const listarDenunciados = (args) => listarAnuncios({ ...args, query: { ...args.query, vista: 'denunciados' } });

// Las denuncias no tenían razón: se cierran y, si el anuncio solo estaba en
// revisión por ellas, vuelve a publicarse.
const desestimarDenuncias = async ({ actor, anuncioId, ip }) => {
    if (!/^\d{1,18}$/.test(String(anuncioId))) throw error('Anuncio no encontrado', 404);
    const actual = await moderacionModel.anuncioAdmin(anuncioId);
    if (!actual) throw error('Anuncio no encontrado', 404);
    const cerradas = await moderacionModel.resolverDenuncias(anuncioId, 'DESESTIMADA', actor.id);
    if (cerradas === 0) throw error('Este anuncio no tiene denuncias pendientes', 409);
    let restaurado = false;
    if (actual.estado === 'PENDIENTE_REVISION' && actual.motivo_revision === 'DENUNCIAS') {
        await moderacionModel.moderarAnuncio(Number(anuncioId), { estado: 'PUBLICADO', pausaAdministrativa: false }, {
            accion: 'DENUNCIAS_DESESTIMADAS',
            adminId: actor.id,
        });
        restaurado = true;
    }
    await auditar(actor, 'denuncias.desestimar', 'anuncio', anuncioId, { titulo: actual.titulo, cerradas, restaurado }, ip);
    return { cerradas, restaurado };
};

// ---------- Usuarios ----------

const listarUsuarios = async ({ query }) => {
    const limite = entero(query.limite, 20, 1, 50);
    const offset = entero(query.offset, 0, 0, 100000);
    const estado = ['ACTIVO', 'INACTIVO', 'SUSPENDIDO'].includes(query.estado) ? query.estado : null;
    const filas = await moderacionModel.listarUsuarios({ q: texto(query.q, 80), estado, limite, offset });
    return {
        total: filas[0]?.total ?? 0,
        items: filas.map((u) => ({
            id: u.id,
            nombre: u.nombre_comercial || nombrePersona(u.nombres, u.apellidos),
            correo: u.correo,
            tipo: u.tipo_cuenta,
            estado: u.estado,
            correoVerificado: u.correo_verificado,
            anuncios: u.anuncios,
            denuncias: u.denuncias,
            creadoEn: u.creado_en,
            ultimoAccesoEn: u.ultimo_acceso_en,
        })),
    };
};

const cambiarEstadoUsuario = async ({ actor, id, suspender, motivo, ip }) => {
    if (!UUID.test(String(id))) throw error('Usuario no encontrado', 404);
    const u = await moderacionModel.usuarioBasico(id);
    if (!u) throw error('Usuario no encontrado', 404);
    const destino = suspender ? 'SUSPENDIDO' : 'ACTIVO';
    if (u.estado === destino) throw error(suspender ? 'La cuenta ya está suspendida' : 'La cuenta ya está activa', 409);
    await moderacionModel.cambiarEstadoUsuario(id, destino);
    await auditar(actor, suspender ? 'usuario.suspender' : 'usuario.reactivar', 'usuario', id, { correo: u.correo, motivo: texto(motivo, 300) }, ip);
    return { id, estado: destino };
};

// ---------- Administradores ----------

const aAdmin = (a) => ({ ...adminAuthService.aPublico(a), acciones: a.acciones ?? undefined });

/**
 * Las reglas contra el escalamiento de privilegios, en un solo sitio:
 * - Nadie toca al superadministrador, ni se gestiona a sí mismo desde aquí
 *   (lo suyo se cambia en su perfil).
 * - Nadie gestiona a alguien con permisos que él no tiene.
 */
const exigirGestionable = async (actor, id) => {
    if (!UUID.test(String(id))) throw error('Administrador no encontrado', 404);
    const objetivo = await adminModel.buscarPorId(id);
    if (!objetivo) throw error('Administrador no encontrado', 404);
    if (objetivo.es_super) throw error('El superadministrador no se puede modificar desde aquí', 403);
    if (objetivo.id === actor.id) throw error('Tu propia cuenta se gestiona desde tu perfil', 403);
    if (!actor.esSuper && (objetivo.permisos || []).some((p) => !actor.permisos.includes(p))) {
        throw error('No puedes gestionar a un administrador con permisos que tú no tienes', 403);
    }
    return objetivo;
};

// Solo se otorga lo que uno mismo tiene (el super, todo).
const validarPermisos = (actor, permisos) => {
    if (!Array.isArray(permisos)) throw error('Indica los permisos', 400);
    const unicos = [...new Set(permisos)];
    if (unicos.some((p) => !IDS_PERMISOS.includes(p))) throw error('Hay un permiso que no existe', 400);
    if (!actor.esSuper && unicos.some((p) => !actor.permisos.includes(p))) {
        throw error('No puedes otorgar permisos que tú no tienes', 403);
    }
    return unicos;
};

const validarDatosAdmin = ({ nombre, correo }, parcial) => {
    const datos = {};
    if (!parcial || nombre !== undefined) {
        const n = typeof nombre === 'string' ? nombre.trim() : '';
        if (n.length < 2 || n.length > 120) throw error('El nombre debe tener entre 2 y 120 caracteres', 400);
        datos.nombre = n;
    }
    if (!parcial || correo !== undefined) {
        const c = normalizarCorreo(correo);
        if (!validarCorreo(c)) throw error('El correo no es válido', 400);
        datos.correo = c;
    }
    return datos;
};

const listarAdministradores = async () => (await adminModel.listar()).map(aAdmin);

const crearAdministrador = async ({ actor, datos, ip }) => {
    const { nombre, correo } = validarDatosAdmin(datos, false);
    let permisos = [];
    if (datos.permisos !== undefined && (datos.permisos || []).length > 0) {
        // Crear con permisos también exige poder gestionar permisos.
        if (!actor.esSuper && !actor.permisos.includes('permisos.gestionar')) {
            throw error('No tienes permiso para asignar permisos', 403);
        }
        permisos = validarPermisos(actor, datos.permisos);
    }
    if (await adminModel.correoEnUso(correo)) throw error('Ese correo ya lo usa otro administrador', 409);
    const temporal = generarContrasenaTemporal();
    const id = await adminModel.crear({ nombre, correo, hash: await bcrypt.hash(temporal, env.bcryptRounds), creadoPor: actor.id });
    if (permisos.length > 0) await adminModel.reemplazarPermisos(id, permisos, actor.id);
    await auditar(actor, 'admin.crear', 'administrador', id, { correo, permisos }, ip);
    // La contraseña temporal se devuelve UNA vez para entregarla; no se guarda.
    return { administrador: aAdmin(await adminModel.buscarPorId(id)), contrasenaTemporal: temporal };
};

const editarAdministrador = async ({ actor, id, datos, ip }) => {
    await exigirGestionable(actor, id);
    const cambios = validarDatosAdmin(datos, true);
    if (cambios.correo && (await adminModel.correoEnUso(cambios.correo, id))) throw error('Ese correo ya lo usa otro administrador', 409);
    await adminModel.actualizarDatos(id, cambios);
    await auditar(actor, 'admin.editar', 'administrador', id, { campos: Object.keys(cambios) }, ip);
    return aAdmin(await adminModel.buscarPorId(id));
};

const cambiarActivoAdministrador = async ({ actor, id, activo, ip }) => {
    await exigirGestionable(actor, id);
    if (typeof activo !== 'boolean') throw error('Indica si activar o desactivar', 400);
    await adminModel.cambiarActivo(id, activo);
    if (!activo) await adminModel.revocarSesiones(id);
    await auditar(actor, activo ? 'admin.activar' : 'admin.desactivar', 'administrador', id, {}, ip);
    return aAdmin(await adminModel.buscarPorId(id));
};

const eliminarAdministrador = async ({ actor, id, ip }) => {
    const objetivo = await exigirGestionable(actor, id);
    await adminModel.revocarSesiones(id);
    await adminModel.eliminar(id);
    await auditar(actor, 'admin.eliminar', 'administrador', id, { correo: objetivo.correo }, ip);
    return { eliminado: true };
};

const asignarPermisos = async ({ actor, id, permisos, ip }) => {
    const objetivo = await exigirGestionable(actor, id);
    const nuevos = validarPermisos(actor, permisos);
    // Quitar también es poder: no se quita lo que uno no podría otorgar.
    const quitados = (objetivo.permisos || []).filter((p) => !nuevos.includes(p));
    if (!actor.esSuper && quitados.some((p) => !actor.permisos.includes(p))) {
        throw error('No puedes quitar permisos que tú no tienes', 403);
    }
    await adminModel.reemplazarPermisos(id, nuevos, actor.id);
    await auditar(actor, 'admin.permisos', 'administrador', id, { antes: objetivo.permisos, despues: nuevos }, ip);
    return aAdmin(await adminModel.buscarPorId(id));
};

const restablecerContrasena = async ({ actor, id, ip }) => {
    await exigirGestionable(actor, id);
    const temporal = generarContrasenaTemporal();
    await adminModel.cambiarContrasena(id, await bcrypt.hash(temporal, env.bcryptRounds), true);
    await adminModel.revocarSesiones(id);
    await auditar(actor, 'admin.restablecer', 'administrador', id, {}, ip);
    return { contrasenaTemporal: temporal };
};

// ---------- Auditoría ----------

const listarAuditoria = async ({ query }) => {
    const limite = entero(query.limite, 30, 1, 100);
    const offset = entero(query.offset, 0, 0, 100000);
    const adminId = query.admin && UUID.test(query.admin) ? query.admin : null;
    const accion = typeof query.accion === 'string' && /^[a-z_.]{1,40}$/.test(query.accion) ? query.accion : null;
    const filas = await adminModel.listarAuditoria({ adminId, accion, limite, offset });
    return {
        total: filas[0]?.total ?? 0,
        items: filas.map((f) => ({
            id: Number(f.id),
            accion: f.accion,
            objetivoTipo: f.objetivo_tipo,
            objetivoId: f.objetivo_id,
            detalle: f.detalle,
            ip: f.ip,
            fecha: f.creado_en,
            admin: f.admin_id ? { id: f.admin_id, nombre: f.admin_nombre, correo: f.admin_correo } : null,
        })),
    };
};

// ---------- Configuración de moderación ----------

const obtenerModeracion = async () => {
    const [config, palabras, cats] = await Promise.all([
        moderacionModel.obtenerConfig(),
        moderacionModel.listarPalabras(),
        catalogoModel.listarCategoriasAnuncio(),
    ]);
    return {
        revisionUsuariosNuevos: config.revision_usuarios_nuevos,
        diasUsuarioNuevo: config.dias_usuario_nuevo,
        umbralDenuncias: config.umbral_denuncias,
        categoriasProhibidas: (config.categorias_prohibidas || []).map(Number),
        actualizadoEn: config.actualizado_en,
        palabras: palabras.map((p) => ({ id: p.id, termino: p.termino, nivel: p.nivel, creadoPor: p.creado_por, creadoEn: p.creado_en })),
        categorias: cats.map((c) => ({ id: c.id, nombre: c.nombre, pilar: c.pilar })),
    };
};

const guardarModeracion = async ({ actor, datos, ip }) => {
    const actual = await moderacionModel.obtenerConfig();
    const config = {
        revisionUsuariosNuevos: typeof datos.revisionUsuariosNuevos === 'boolean' ? datos.revisionUsuariosNuevos : actual.revision_usuarios_nuevos,
        diasUsuarioNuevo: datos.diasUsuarioNuevo !== undefined ? entero(datos.diasUsuarioNuevo, NaN, 1, 365) : actual.dias_usuario_nuevo,
        umbralDenuncias: datos.umbralDenuncias !== undefined ? entero(datos.umbralDenuncias, NaN, 1, 100) : actual.umbral_denuncias,
        categoriasProhibidas: datos.categoriasProhibidas !== undefined ? datos.categoriasProhibidas : (actual.categorias_prohibidas || []),
    };
    if (Number.isNaN(config.diasUsuarioNuevo) || Number.isNaN(config.umbralDenuncias)) throw error('Valores numéricos inválidos', 400);
    if (!Array.isArray(config.categoriasProhibidas) || !config.categoriasProhibidas.every((c) => Number.isInteger(Number(c)))) {
        throw error('Categorías inválidas', 400);
    }
    config.categoriasProhibidas = [...new Set(config.categoriasProhibidas.map(Number))];
    await moderacionModel.guardarConfig(config, actor.id);
    moderacionService.olvidarReglas();
    await auditar(actor, 'moderacion.config', 'moderacion', null, config, ip);
    return obtenerModeracion();
};

const agregarPalabra = async ({ actor, termino, nivel, ip }) => {
    const normal = moderacionService.normalizarTermino(termino);
    if (normal.length < 2 || normal.length > 80) throw error('El término debe tener entre 2 y 80 caracteres', 400);
    if (!['REVISION', 'BLOQUEO'].includes(nivel)) throw error('Elige si manda a revisión o bloquea', 400);
    const p = await moderacionModel.guardarPalabra(normal, nivel, actor.id);
    moderacionService.olvidarReglas();
    await auditar(actor, 'moderacion.palabra_agregar', 'palabra', p.id, { termino: normal, nivel }, ip);
    return obtenerModeracion();
};

const eliminarPalabra = async ({ actor, id, ip }) => {
    if (!/^\d{1,9}$/.test(String(id))) throw error('Término no encontrado', 404);
    const p = await moderacionModel.eliminarPalabra(id);
    if (!p) throw error('Término no encontrado', 404);
    moderacionService.olvidarReglas();
    await auditar(actor, 'moderacion.palabra_eliminar', 'palabra', id, { termino: p.termino }, ip);
    return obtenerModeracion();
};

module.exports = {
    catalogos,
    estadisticas,
    listarAnuncios,
    detalleAnuncio,
    moderar,
    listarDenunciados,
    desestimarDenuncias,
    listarUsuarios,
    cambiarEstadoUsuario,
    listarAdministradores,
    crearAdministrador,
    editarAdministrador,
    cambiarActivoAdministrador,
    eliminarAdministrador,
    asignarPermisos,
    restablecerContrasena,
    listarAuditoria,
    obtenerModeracion,
    guardarModeracion,
    agregarPalabra,
    eliminarPalabra,
};
