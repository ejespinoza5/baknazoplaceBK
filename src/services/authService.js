const bcrypt = require('bcrypt');
const pool = require('../config/db');
const env = require('../config/env');
const usuarioModel = require('../models/usuarioModel');
const cuentaAuthModel = require('../models/cuentaAuthModel');
const codigoVerificacionModel = require('../models/codigoVerificacionModel');
const codigoRecuperacionModel = require('../models/codigoRecuperacionModel');
const refreshTokenModel = require('../models/refreshTokenModel');
const tokenService = require('./tokenService');
const emailService = require('./emailService');
const googleAuthService = require('./googleAuthService');
const facebookAuthService = require('./facebookAuthService');
const { generarCodigoNumerico, hashCodigo, hashToken } = require('../utils/codigos');
const {
    validarCorreo,
    validarContrasena,
    validarTipoCuenta,
    normalizarCorreo,
} = require('../utils/validaciones');

const MINUTOS_EXPIRA_CODIGO = 15;
const MAX_INTENTOS_CODIGO = 5;

const error = (mensaje, status) => {
    const err = new Error(mensaje);
    err.status = status;
    return err;
};

const publico = (usuario) => ({
    id: usuario.id,
    correo: usuario.correo,
    nombres: usuario.nombres,
    apellidos: usuario.apellidos,
    tipo_cuenta: usuario.tipo_cuenta,
});

const generarYEnviarCodigoVerificacion = async (usuario) => {
    const codigo = generarCodigoNumerico();
    const expiraEn = new Date(Date.now() + MINUTOS_EXPIRA_CODIGO * 60 * 1000);
    await codigoVerificacionModel.crear({
        usuarioId: usuario.id,
        codigoHash: hashCodigo(codigo),
        expiraEn,
    });
    await emailService.enviarCodigoVerificacion(usuario.correo, codigo);
};

// ---------- Registro y verificación por correo ----------

const registrar = async ({ tipo_cuenta, correo, contrasena, nombres, apellidos }) => {
    const correoNormalizado = normalizarCorreo(correo);

    if (!validarTipoCuenta(tipo_cuenta)) {
        throw error('tipo_cuenta debe ser PERSONA o NEGOCIO', 400);
    }
    if (!validarCorreo(correoNormalizado)) {
        throw error('El correo no tiene un formato válido', 400);
    }
    if (!validarContrasena(contrasena)) {
        throw error(
            'La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula, un número y un carácter especial',
            400
        );
    }
    if (!nombres || !nombres.trim()) {
        throw error('El nombre es obligatorio', 400);
    }

    const existente = await usuarioModel.buscarPorCorreo(correoNormalizado);
    if (existente) {
        throw error('El correo ya está registrado', 409);
    }

    const hash = await bcrypt.hash(contrasena, env.bcryptRounds);

    const client = await pool.connect();
    let usuario;
    try {
        await client.query('BEGIN');

        const { rows: u } = await client.query(
            `INSERT INTO usuarios (tipo_cuenta, correo, nombres, apellidos)
             VALUES ($1, $2, $3, $4)
             RETURNING id, correo, nombres, apellidos, tipo_cuenta, estado, correo_verificado, creado_en`,
            [tipo_cuenta, correoNormalizado, nombres.trim(), apellidos ? apellidos.trim() : null]
        );
        usuario = u[0];

        await client.query(
            `INSERT INTO cuentas_autenticacion (usuario_id, proveedor, contrasena_hash)
             VALUES ($1, 'CORREO', $2)`,
            [usuario.id, hash]
        );

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }

    await generarYEnviarCodigoVerificacion(usuario);

    return publico(usuario);
};

const verificarCorreo = async ({ correo, codigo }) => {
    const correoNormalizado = normalizarCorreo(correo);
    if (!correoNormalizado || !codigo) {
        throw error('Correo y código son requeridos', 400);
    }

    const usuario = await usuarioModel.buscarPorCorreo(correoNormalizado);
    if (!usuario) {
        throw error('Código inválido o expirado', 400);
    }
    if (usuario.correo_verificado) {
        throw error('El correo ya está verificado', 409);
    }

    const registro = await codigoVerificacionModel.buscarVigentePorUsuario(usuario.id);
    if (!registro || registro.intentos >= MAX_INTENTOS_CODIGO || new Date(registro.expira_en) < new Date()) {
        throw error('Código inválido o expirado', 400);
    }

    if (hashCodigo(String(codigo)) !== registro.codigo_hash) {
        await codigoVerificacionModel.incrementarIntentos(registro.id);
        throw error('Código inválido o expirado', 400);
    }

    await codigoVerificacionModel.marcarVerificado(registro.id);
    await usuarioModel.marcarCorreoVerificado(usuario.id);
    await usuarioModel.actualizarUltimoAcceso(usuario.id);

    const usuarioActualizado = { ...usuario, correo_verificado: true };
    const tokens = await tokenService.emitirParTokens(usuarioActualizado);
    return { ...tokens, usuario: publico(usuarioActualizado) };
};

const reenviarVerificacion = async ({ correo }) => {
    const correoNormalizado = normalizarCorreo(correo);
    const usuario = await usuarioModel.buscarPorCorreo(correoNormalizado);

    // Respuesta genérica: no revelar si el correo existe o ya está verificado.
    if (usuario && !usuario.correo_verificado) {
        await generarYEnviarCodigoVerificacion(usuario);
    }
    return { mensaje: 'Si el correo existe y no ha sido verificado, se envió un nuevo código' };
};

// ---------- Login por correo ----------

const iniciarSesion = async ({ correo, contrasena }) => {
    const correoNormalizado = normalizarCorreo(correo);
    const usuario = await usuarioModel.buscarPorCorreo(correoNormalizado);
    if (!usuario) {
        throw error('Credenciales inválidas', 401);
    }

    if (usuario.estado !== 'ACTIVO') {
        throw error('La cuenta no está activa', 403);
    }

    const cuenta = await cuentaAuthModel.buscarCuentaCorreo(usuario.id);
    if (!cuenta || !cuenta.contrasena_hash) {
        throw error('Credenciales inválidas', 401);
    }

    const valida = await bcrypt.compare(contrasena, cuenta.contrasena_hash);
    if (!valida) {
        throw error('Credenciales inválidas', 401);
    }

    if (!usuario.correo_verificado) {
        throw error('Debes verificar tu correo antes de iniciar sesión', 403);
    }

    await usuarioModel.actualizarUltimoAcceso(usuario.id);

    const tokens = await tokenService.emitirParTokens(usuario);
    return { ...tokens, usuario: publico(usuario) };
};

// ---------- Refresh / logout ----------

const refrescarToken = async ({ refresh_token }) => {
    if (!refresh_token) {
        throw error('refresh_token requerido', 400);
    }

    const hash = hashToken(refresh_token);
    const registro = await refreshTokenModel.buscarPorHash(hash);

    if (!registro) {
        throw error('Refresh token inválido', 401);
    }

    if (registro.revocado_en) {
        // Reuso de un token ya rotado/revocado: posible robo -> se cierra todo.
        await refreshTokenModel.revocarTodosDelUsuario(registro.usuario_id);
        throw error('Refresh token inválido, se cerraron todas las sesiones por seguridad', 401);
    }

    if (new Date(registro.expira_en) < new Date()) {
        throw error('Refresh token expirado', 401);
    }

    const usuario = await usuarioModel.buscarPorId(registro.usuario_id);
    if (!usuario || usuario.estado !== 'ACTIVO') {
        throw error('La cuenta no está activa', 403);
    }

    await refreshTokenModel.revocarPorId(registro.id);
    const tokens = await tokenService.emitirParTokens(usuario);
    return { ...tokens, usuario: publico(usuario) };
};

const cerrarSesion = async ({ refresh_token }) => {
    if (!refresh_token) {
        throw error('refresh_token requerido', 400);
    }
    const registro = await refreshTokenModel.buscarPorHash(hashToken(refresh_token));
    if (registro) {
        await refreshTokenModel.revocarPorId(registro.id);
    }
    return { mensaje: 'Sesión cerrada' };
};

// ---------- Login social (Google / Facebook) ----------

const loginConProveedor = async ({ proveedor, proveedorId, correo, correoVerificado, nombre, apellido, tipo_cuenta }) => {
    const correoNormalizado = normalizarCorreo(correo);

    let cuenta = await cuentaAuthModel.buscarCuentaPorProveedor(proveedor, proveedorId);
    let usuario;

    if (cuenta) {
        usuario = await usuarioModel.buscarPorId(cuenta.usuario_id);
    } else {
        usuario = await usuarioModel.buscarPorCorreo(correoNormalizado);

        if (usuario) {
            if (!correoVerificado) {
                throw error('No se pudo vincular la cuenta: el correo no está verificado por el proveedor', 401);
            }
            try {
                await cuentaAuthModel.crearCuentaProveedor({ usuarioId: usuario.id, proveedor, idProveedor: proveedorId });
            } catch (e) {
                if (e.code === '23505') {
                    throw error('Ya tienes otra cuenta vinculada con este proveedor', 409);
                }
                throw e;
            }
        } else {
            if (!validarTipoCuenta(tipo_cuenta)) {
                throw error('tipo_cuenta (PERSONA o NEGOCIO) es requerido para crear tu cuenta', 400);
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const { rows: u } = await client.query(
                    `INSERT INTO usuarios (tipo_cuenta, correo, nombres, apellidos, correo_verificado, correo_verificado_en)
                     VALUES ($1, $2, $3, $4, TRUE, NOW())
                     RETURNING id, correo, nombres, apellidos, tipo_cuenta, estado, correo_verificado`,
                    [tipo_cuenta, correoNormalizado, nombre || 'Usuario', apellido]
                );
                usuario = u[0];
                await client.query(
                    `INSERT INTO cuentas_autenticacion (usuario_id, proveedor, id_proveedor)
                     VALUES ($1, $2, $3)`,
                    [usuario.id, proveedor, proveedorId]
                );
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
        }
    }

    if (usuario.estado !== 'ACTIVO') {
        throw error('La cuenta no está activa', 403);
    }

    await usuarioModel.actualizarUltimoAcceso(usuario.id);
    const tokens = await tokenService.emitirParTokens(usuario);
    return { ...tokens, usuario: publico(usuario) };
};

const loginGoogle = async ({ id_token, tipo_cuenta }) => {
    const datos = await googleAuthService.verificarIdTokenGoogle(id_token);
    return loginConProveedor({
        proveedor: 'GOOGLE',
        proveedorId: datos.proveedorId,
        correo: datos.correo,
        correoVerificado: datos.correoVerificado,
        nombre: datos.nombre,
        apellido: datos.apellido,
        tipo_cuenta,
    });
};

const loginFacebook = async ({ access_token, tipo_cuenta }) => {
    const datos = await facebookAuthService.verificarAccessTokenFacebook(access_token);
    return loginConProveedor({
        proveedor: 'FACEBOOK',
        proveedorId: datos.proveedorId,
        correo: datos.correo,
        correoVerificado: datos.correoVerificado,
        nombre: datos.nombre,
        apellido: datos.apellido,
        tipo_cuenta,
    });
};

// ---------- Recuperación de contraseña ----------

const solicitarRecuperacion = async ({ correo }) => {
    const correoNormalizado = normalizarCorreo(correo);
    const usuario = await usuarioModel.buscarPorCorreo(correoNormalizado);
    const mensaje = { mensaje: 'Si el correo existe, se enviaron instrucciones de recuperación' };

    if (!usuario) return mensaje;

    const cuenta = await cuentaAuthModel.buscarCuentaCorreo(usuario.id);
    if (!cuenta) return mensaje; // cuenta solo social, no tiene contraseña que recuperar

    const codigo = generarCodigoNumerico();
    const expiraEn = new Date(Date.now() + MINUTOS_EXPIRA_CODIGO * 60 * 1000);
    await codigoRecuperacionModel.crear({ usuarioId: usuario.id, codigoHash: hashCodigo(codigo), expiraEn });
    await emailService.enviarCodigoRecuperacion(usuario.correo, codigo);

    return mensaje;
};

const restablecerContrasena = async ({ correo, codigo, nueva_contrasena }) => {
    const correoNormalizado = normalizarCorreo(correo);
    if (!validarContrasena(nueva_contrasena)) {
        throw error(
            'La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula, un número y un carácter especial',
            400
        );
    }

    const usuario = await usuarioModel.buscarPorCorreo(correoNormalizado);
    if (!usuario) {
        throw error('Código inválido o expirado', 400);
    }

    const registro = await codigoRecuperacionModel.buscarVigentePorUsuario(usuario.id);
    if (!registro || registro.intentos >= MAX_INTENTOS_CODIGO || new Date(registro.expira_en) < new Date()) {
        throw error('Código inválido o expirado', 400);
    }

    if (hashCodigo(String(codigo)) !== registro.codigo_hash) {
        await codigoRecuperacionModel.incrementarIntentos(registro.id);
        throw error('Código inválido o expirado', 400);
    }

    const hash = await bcrypt.hash(nueva_contrasena, env.bcryptRounds);
    await cuentaAuthModel.actualizarContrasena(usuario.id, hash);
    await codigoRecuperacionModel.marcarUtilizado(registro.id);
    await refreshTokenModel.revocarTodosDelUsuario(usuario.id);

    return { mensaje: 'Contraseña actualizada. Vuelve a iniciar sesión.' };
};

module.exports = {
    registrar,
    verificarCorreo,
    reenviarVerificacion,
    iniciarSesion,
    refrescarToken,
    cerrarSesion,
    loginGoogle,
    loginFacebook,
    solicitarRecuperacion,
    restablecerContrasena,
};
