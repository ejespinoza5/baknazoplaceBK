const bcrypt = require('bcrypt');
const env = require('../config/env');
const adminModel = require('../models/adminModel');
const { IDS_PERMISOS } = require('../config/administracion');
const { generarTokenOpaco, hashToken } = require('../utils/codigos');
const { validarCorreo, validarContrasena, normalizarCorreo } = require('../utils/validaciones');

// Sesiones del panel: token opaco (no JWT) guardado como hash. Así desactivar
// una cuenta o "cerrar sesiones" corta el acceso en la siguiente petición.
const DURACION_SESION_MS = 8 * 60 * 60 * 1000;
const INACTIVIDAD_MS = 60 * 60 * 1000;
const RENOVAR_USO_MS = 60 * 1000;

// Se compara contra esto cuando el correo no existe: así la respuesta tarda
// lo mismo y no revela qué correos son de administradores.
const HASH_FALSO = bcrypt.hashSync('contrasena-de-relleno', 10);

const error = (mensaje, status, codigo) => {
    const err = new Error(mensaje);
    err.status = status;
    if (codigo) err.codigo = codigo;
    return err;
};

// Lo que el panel sabe de quien está dentro. Nunca el hash.
const aPublico = (a) => ({
    id: a.id,
    nombre: a.nombre,
    correo: a.correo,
    esSuper: a.es_super,
    activo: a.activo,
    // El superadministrador tiene todos, aunque no estén en la tabla.
    permisos: a.es_super ? [...IDS_PERMISOS] : a.permisos || [],
    debeCambiarContrasena: a.debe_cambiar_contrasena,
    ultimoAccesoEn: a.ultimo_acceso_en,
    contrasenaCambiadaEn: a.contrasena_cambiada_en,
    creadoEn: a.creado_en,
});

const reglaContrasena = (nueva) => {
    if (!validarContrasena(nueva) || nueva.length < 10) {
        throw error('La contraseña debe tener al menos 10 caracteres, con mayúscula, minúscula, número y un carácter especial', 400);
    }
};

const iniciarSesion = async ({ correo, contrasena, ip, userAgent }) => {
    if (typeof correo !== 'string' || typeof contrasena !== 'string' || !correo || !contrasena) {
        throw error('Escribe tu correo y tu contraseña', 400);
    }
    const fila = await adminModel.buscarParaLogin(normalizarCorreo(correo));
    if (!fila) {
        await bcrypt.compare(contrasena, HASH_FALSO);
        throw error('Correo o contraseña incorrectos', 401);
    }
    if (fila.bloqueado_hasta && new Date(fila.bloqueado_hasta) > new Date()) {
        throw error('Demasiados intentos fallidos. Vuelve a intentarlo en unos minutos.', 429);
    }
    if (!(await bcrypt.compare(contrasena, fila.contrasena_hash))) {
        await adminModel.registrarFallo(fila.id);
        throw error('Correo o contraseña incorrectos', 401);
    }
    // Se dice solo después de comprobar la contraseña: a un extraño no se le
    // confirma que la cuenta existe.
    if (!fila.activo) throw error('Tu acceso al panel está desactivado. Habla con el superadministrador.', 403);

    await adminModel.registrarAcceso(fila.id);
    const token = generarTokenOpaco();
    const expiraEn = new Date(Date.now() + DURACION_SESION_MS);
    await adminModel.crearSesion({
        adminId: fila.id,
        tokenHash: hashToken(token),
        ip,
        userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
        expiraEn,
    });
    await adminModel.auditar({ adminId: fila.id, accion: 'sesion.inicio', ip });
    return { token, expiraEn, admin: aPublico(await adminModel.buscarPorId(fila.id)) };
};

/** Para el middleware: la sesión y su administrador, o null si ya no vale. */
const sesionDesdeToken = async (token) => {
    if (typeof token !== 'string' || token.length < 32) return null;
    const s = await adminModel.buscarSesion(hashToken(token));
    if (!s || s.revocada_en || new Date(s.expira_en) <= new Date()) return null;
    if (Date.now() - new Date(s.ultimo_uso_en).getTime() > INACTIVIDAD_MS) {
        await adminModel.revocarSesion(s.id);
        return null;
    }
    const admin = await adminModel.buscarPorId(s.admin_id);
    if (!admin || !admin.activo) {
        await adminModel.revocarSesion(s.id);
        return null;
    }
    if (Date.now() - new Date(s.ultimo_uso_en).getTime() > RENOVAR_USO_MS) await adminModel.tocarSesion(s.id);
    return { sesionId: s.id, admin: aPublico(admin) };
};

const cerrarSesion = async ({ admin, sesionId, ip }) => {
    await adminModel.revocarSesion(sesionId);
    await adminModel.auditar({ adminId: admin.id, accion: 'sesion.cierre', ip });
};

const cambiarContrasena = async ({ admin, sesionId, actual, nueva, ip }) => {
    if (typeof actual !== 'string' || typeof nueva !== 'string') throw error('Completa los dos campos', 400);
    reglaContrasena(nueva);
    const hash = await adminModel.hashDe(admin.id);
    // 400 y no 401: un 401 haría creer al panel que la sesión terminó.
    if (!(await bcrypt.compare(actual, hash))) throw error('La contraseña actual no es correcta', 400);
    if (await bcrypt.compare(nueva, hash)) throw error('La nueva contraseña debe ser distinta de la actual', 400);
    await adminModel.cambiarContrasena(admin.id, await bcrypt.hash(nueva, env.bcryptRounds), false);
    // Las demás sesiones se cierran; esta sigue.
    await adminModel.revocarSesiones(admin.id, sesionId);
    await adminModel.auditar({ adminId: admin.id, accion: 'cuenta.contrasena', ip });
    return aPublico(await adminModel.buscarPorId(admin.id));
};

const actualizarPerfil = async ({ admin, datos, ip }) => {
    const cambios = {};
    if (datos.nombre !== undefined) {
        const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim() : '';
        if (nombre.length < 2 || nombre.length > 120) throw error('El nombre debe tener entre 2 y 120 caracteres', 400);
        cambios.nombre = nombre;
    }
    if (datos.correo !== undefined) {
        const correo = normalizarCorreo(datos.correo);
        if (!validarCorreo(correo)) throw error('El correo no es válido', 400);
        if (correo !== String(admin.correo).toLowerCase()) {
            // Cambiar el correo de acceso pide la contraseña: con una sesión
            // abierta ajena no basta para quedarse con la cuenta.
            const hash = await adminModel.hashDe(admin.id);
            if (typeof datos.contrasenaActual !== 'string' || !(await bcrypt.compare(datos.contrasenaActual, hash))) {
                throw error('Para cambiar el correo escribe tu contraseña actual', 400);
            }
            if (await adminModel.correoEnUso(correo, admin.id)) throw error('Ese correo ya lo usa otro administrador', 409);
            cambios.correo = correo;
        }
    }
    if (Object.keys(cambios).length === 0) return admin;
    await adminModel.actualizarDatos(admin.id, cambios);
    await adminModel.auditar({ adminId: admin.id, accion: 'cuenta.perfil', detalle: { campos: Object.keys(cambios) }, ip });
    return aPublico(await adminModel.buscarPorId(admin.id));
};

const listarSesiones = async ({ admin, sesionId }) =>
    (await adminModel.listarSesiones(admin.id)).map((s) => ({
        id: Number(s.id),
        ip: s.ip,
        navegador: s.user_agent,
        creadaEn: s.creado_en,
        ultimoUsoEn: s.ultimo_uso_en,
        actual: Number(s.id) === Number(sesionId),
    }));

const cerrarOtrasSesiones = async ({ admin, sesionId, ip }) => {
    const cerradas = await adminModel.revocarSesiones(admin.id, sesionId);
    await adminModel.auditar({ adminId: admin.id, accion: 'cuenta.cerrar_sesiones', detalle: { cerradas }, ip });
    return { cerradas };
};

module.exports = {
    DURACION_SESION_MS,
    aPublico,
    reglaContrasena,
    iniciarSesion,
    sesionDesdeToken,
    cerrarSesion,
    cambiarContrasena,
    actualizarPerfil,
    listarSesiones,
    cerrarOtrasSesiones,
};
