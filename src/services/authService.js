const bcrypt = require('bcrypt');
const fs = require('fs');
const pool = require('../config/db');
const env = require('../config/env');
const usuarioModel = require('../models/usuarioModel');
const cuentaAuthModel = require('../models/cuentaAuthModel');
const negocioModel = require('../models/negocioModel');
const categoriaModel = require('../models/categoriaModel');
const codigoVerificacionModel = require('../models/codigoVerificacionModel');
const codigoRecuperacionModel = require('../models/codigoRecuperacionModel');
const refreshTokenModel = require('../models/refreshTokenModel');
const tokenService = require('./tokenService');
const emailService = require('./emailService');
const googleAuthService = require('./googleAuthService');
const { procesarFotoPerfil, procesarLogo, rutaAbsolutaDe } = require('./imageService');
const { generarCodigoNumerico, hashCodigo, hashToken } = require('../utils/codigos');
const {
    validarCorreo,
    validarContrasena,
    validarTipoCuenta,
    normalizarCorreo,
    validarTelefono,
    validarLatitud,
    validarLongitud,
    parsearJson,
    validarHorarioAtencion,
    validarRedesSociales,
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
    foto_perfil: usuario.foto_perfil || null,
});

// Convierte un objeto/array a string JSON para columnas jsonb.
// Necesario porque node-postgres serializa los arrays como literales de Postgres, no como JSON.
const aJson = (valor) => (valor === undefined || valor === null ? null : JSON.stringify(valor));

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

const booleano = (valor, defecto = false) => {
    if (valor === undefined || valor === null || valor === '') return defecto;
    return valor === true || valor === 'true' || valor === '1';
};

const nro = (valor) => {
    if (valor === undefined || valor === null || valor === '') return null;
    const n = Number(valor);
    return Number.isNaN(n) ? null : n;
};

const validarDatosNegocio = async (datos) => {
    const {
        nombreComercial,
        categoriaId,
        direccionLocal,
        tieneLocal,
        zonaCobertura,
        telefono,
        whatsapp,
        latitud,
        longitud,
        horario,
        redes,
        descripcionBreve,
    } = datos;

    if (!nombreComercial || !nombreComercial.trim()) {
        throw error('nombre_comercial es obligatorio para cuentas de negocio', 400);
    }
    if (!categoriaId) {
        throw error('categoria es obligatoria para cuentas de negocio', 400);
    }
    const categoria = await categoriaModel.buscarPorId(categoriaId);
    if (!categoria) {
        throw error('La categoría seleccionada no existe', 400);
    }
    if (descripcionBreve && descripcionBreve.trim().length > 500) {
        throw error('La descripción breve no puede superar los 500 caracteres', 400);
    }
    if (tieneLocal && (!direccionLocal || !direccionLocal.trim())) {
        throw error('Si el negocio tiene local, la dirección del local es obligatoria', 400);
    }
    if (!tieneLocal && (!zonaCobertura || !zonaCobertura.trim())) {
        throw error('Si el negocio no tiene local físico, la zona de cobertura es obligatoria', 400);
    }
    if (telefono && !validarTelefono(telefono)) {
        throw error('El teléfono no tiene un formato válido', 400);
    }
    if (whatsapp && !validarTelefono(whatsapp)) {
        throw error('El WhatsApp no tiene un formato válido', 400);
    }
    if (latitud !== null && !validarLatitud(latitud)) {
        throw error('La latitud debe estar entre -90 y 90', 400);
    }
    if (longitud !== null && !validarLongitud(longitud)) {
        throw error('La longitud debe estar entre -180 y 180', 400);
    }
    if (!validarHorarioAtencion(horario)) {
        throw error('El horario de atención no tiene un formato válido', 400);
    }
    if (!validarRedesSociales(redes)) {
        throw error('Las redes sociales deben ser un objeto con nombre y URL', 400);
    }
};

// ---------- Registro y verificación por correo ----------

// Normaliza coordenadas y valida los datos del negocio (registro manual y con Google).
const prepararNegocio = async (datos) => {
    if (datos.latitud !== undefined && datos.latitud !== null && datos.latitud !== '') {
        datos.latitud = Number(datos.latitud);
    }
    if (datos.longitud !== undefined && datos.longitud !== null && datos.longitud !== '') {
        datos.longitud = Number(datos.longitud);
    }
    await validarDatosNegocio({
        nombreComercial: datos.nombreComercial,
        categoriaId: datos.categoriaId,
        descripcionBreve: datos.descripcionBreve,
        direccionLocal: datos.direccionLocal,
        tieneLocal: datos.tieneLocal,
        zonaCobertura: datos.zonaCobertura,
        telefono: datos.telefono,
        whatsapp: datos.whatsapp,
        latitud: datos.latitud,
        longitud: datos.longitud,
        horario: datos.horario,
        redes: datos.redes,
    });
};

// Inserta el negocio dentro de la transacción del registro; devuelve su id.
const insertarNegocio = async (client, usuarioId, datos, correoUsuario) => {
    const { rows } = await client.query(
        `INSERT INTO negocios (
             usuario_id, nombre_comercial, categoria_id, descripcion_breve, logo_url,
             provincia, ciudad, sector, direccion_local, tiene_local, latitud, longitud,
             telefono, whatsapp, correo_contacto, redes_sociales, horario_atencion,
             entrega_domicilio, zona_cobertura
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         RETURNING id`,
        [
            usuarioId,
            datos.nombreComercial,
            datos.categoriaId,
            datos.descripcionBreve,
            datos.logoUrl,
            datos.provincia,
            datos.ciudad,
            datos.sector,
            datos.direccionLocal,
            datos.tieneLocal,
            datos.latitud,
            datos.longitud,
            datos.telefono,
            datos.whatsapp,
            datos.correoContacto ? normalizarCorreo(datos.correoContacto) : correoUsuario,
            aJson(datos.redes),
            aJson(datos.horario),
            datos.entregaDomicilio,
            datos.zonaCobertura,
        ]
    );
    return rows[0].id;
};

const registrar = async ({ tipo_cuenta, correo, contrasena, nombres, apellidos, foto_perfil, negocio }) => {
    const cuerpo = {
        tipo_cuenta,
        correo: normalizarCorreo(correo),
        contrasena,
        nombres: nombres ? nombres.trim() : null,
        apellidos: apellidos ? apellidos.trim() : null,
        // Imágenes ya procesadas por imageService (rutas públicas /uploads/...)
        fotoPerfilUrl: foto_perfil ? foto_perfil.url : null,
        ...negocio,
    };

    if (!validarTipoCuenta(cuerpo.tipo_cuenta)) {
        throw error('tipo_cuenta debe ser PERSONA o NEGOCIO', 400);
    }
    if (!validarCorreo(cuerpo.correo)) {
        throw error('El correo no tiene un formato válido', 400);
    }
    if (!validarContrasena(cuerpo.contrasena)) {
        throw error(
            'La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula, un número y un carácter especial',
            400
        );
    }
    if (!cuerpo.nombres) {
        throw error('El nombre es obligatorio', 400);
    }

    if (cuerpo.tipo_cuenta === 'NEGOCIO') {
        await prepararNegocio(cuerpo);
    }

    const existente = await usuarioModel.buscarPorCorreo(cuerpo.correo);
    if (existente) {
        throw error('El correo ya está registrado', 409);
    }

    const hash = await bcrypt.hash(cuerpo.contrasena, env.bcryptRounds);

    const client = await pool.connect();
    let usuario;
    try {
        await client.query('BEGIN');

        const { rows: u } = await client.query(
            `INSERT INTO usuarios (tipo_cuenta, correo, nombres, apellidos, foto_perfil)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, correo, nombres, apellidos, tipo_cuenta, estado, foto_perfil, correo_verificado, creado_en`,
            [cuerpo.tipo_cuenta, cuerpo.correo, cuerpo.nombres, cuerpo.apellidos, cuerpo.fotoPerfilUrl]
        );
        usuario = u[0];

        await client.query(
            `INSERT INTO cuentas_autenticacion (usuario_id, proveedor, contrasena_hash)
             VALUES ($1, 'CORREO', $2)`,
            [usuario.id, hash]
        );

        if (cuerpo.tipo_cuenta === 'NEGOCIO') {
            usuario.negocio_id = await insertarNegocio(client, usuario.id, cuerpo, cuerpo.correo);
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        // Si falla el registro, se borran las imágenes ya guardadas.
        for (const url of [cuerpo.fotoPerfilUrl, cuerpo.logoUrl]) {
            const abs = rutaAbsolutaDe(url);
            if (abs) fs.promises.unlink(abs).catch(() => {});
        }
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

    emailService.enviarBienvenida(usuario.correo, usuario.nombres, usuario.tipo_cuenta).catch(() => {});

    const usuarioActualizado = { ...usuario, correo_verificado: true };
    const tokens = await tokenService.emitirParTokens(usuarioActualizado);
    return { ...tokens, usuario: publico(usuarioActualizado) };
};

// Lee de forma segura si el correo ya tiene una cuenta registrada.
// Se usa al inicio del formulario de registro para avisar temprano y no
// hacer que el cliente llene todos los datos del negocio en vano.
const correoExiste = async ({ correo }) => {
    const correoNormalizado = normalizarCorreo(correo);
    if (!correoNormalizado) {
        throw error('Correo requerido', 400);
    }
    const usuario = await usuarioModel.buscarPorCorreo(correoNormalizado);
    return { existe: Boolean(usuario) };
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

// ---------- Login social (Google) ----------

const loginConProveedor = async ({ proveedor, proveedorId, correo, correoVerificado, nombre, apellido, tipo_cuenta, negocio }) => {
    const correoNormalizado = normalizarCorreo(correo);

    let cuenta = await cuentaAuthModel.buscarCuentaPorProveedor(proveedor, proveedorId);
    let usuario;
    let negocioCreado = false;

    if (cuenta) {
        usuario = await usuarioModel.buscarPorId(cuenta.usuario_id);
    } else {
        usuario = await usuarioModel.buscarPorCorreo(correoNormalizado);

        if (usuario) {
            if (!correoVerificado) {
                throw error('No se pudo vincular la cuenta: el correo no está verificado por el proveedor', 401);
            }
            // Ya existe una cuenta con este correo (registro manual): no se vincula automáticamente.
            // Se envía un código al correo y el cliente debe confirmarlo en /login/google/vincular.
            await generarYEnviarCodigoVinculacion(usuario, proveedor);
            return {
                requiere_vinculacion: true,
                correo: usuario.correo,
                mensaje: `Ya existe una cuenta con este correo. Te enviamos un código para vincularla con ${proveedor}.`,
            };
        } else {
            if (!validarTipoCuenta(tipo_cuenta)) {
                throw error('tipo_cuenta (PERSONA o NEGOCIO) es requerido para crear tu cuenta', 400);
            }
            if (tipo_cuenta === 'NEGOCIO') {
                if (!negocio) {
                    throw error('Los datos del negocio son requeridos para crear una cuenta NEGOCIO', 400);
                }
                await prepararNegocio(negocio);
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
                if (tipo_cuenta === 'NEGOCIO') {
                    usuario.negocio_id = await insertarNegocio(client, usuario.id, negocio, correoNormalizado);
                    negocioCreado = true;
                }
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
    return { ...tokens, usuario: publico(usuario), negocio_creado: negocioCreado };
};

// Reutiliza la tabla codigos_verificacion: el código también prueba que el usuario controla el correo.
const generarYEnviarCodigoVinculacion = async (usuario, proveedor) => {
    const codigo = generarCodigoNumerico();
    const expiraEn = new Date(Date.now() + MINUTOS_EXPIRA_CODIGO * 60 * 1000);
    await codigoVerificacionModel.crear({
        usuarioId: usuario.id,
        codigoHash: hashCodigo(codigo),
        expiraEn,
    });
    await emailService.enviarCodigoVinculacion(usuario.correo, codigo, proveedor);
};

const vincularConProveedor = async ({ proveedor, proveedorId, correo, correoVerificado, codigo }) => {
    const correoNormalizado = normalizarCorreo(correo);
    if (!correoVerificado) {
        throw error('No se pudo vincular la cuenta: el correo no está verificado por el proveedor', 401);
    }

    const cuentaExistente = await cuentaAuthModel.buscarCuentaPorProveedor(proveedor, proveedorId);
    if (cuentaExistente) {
        throw error('Esta cuenta ya está vinculada. Inicia sesión normalmente.', 409);
    }

    const usuario = await usuarioModel.buscarPorCorreo(correoNormalizado);
    if (!usuario) {
        throw error('Código inválido o expirado', 400);
    }

    const registro = await codigoVerificacionModel.buscarVigentePorUsuario(usuario.id);
    if (!registro || registro.intentos >= MAX_INTENTOS_CODIGO || new Date(registro.expira_en) < new Date()) {
        throw error('Código inválido o expirado', 400);
    }
    if (hashCodigo(String(codigo)) !== registro.codigo_hash) {
        await codigoVerificacionModel.incrementarIntentos(registro.id);
        throw error('Código inválido o expirado', 400);
    }

    if (usuario.estado !== 'ACTIVO') {
        throw error('La cuenta no está activa', 403);
    }

    try {
        await cuentaAuthModel.crearCuentaProveedor({ usuarioId: usuario.id, proveedor, idProveedor: proveedorId });
    } catch (e) {
        if (e.code === '23505') {
            throw error('Ya tienes otra cuenta vinculada con este proveedor', 409);
        }
        throw e;
    }
    await codigoVerificacionModel.marcarVerificado(registro.id);

    // El código llegó al correo, así que el correo queda verificado.
    if (!usuario.correo_verificado) {
        await usuarioModel.marcarCorreoVerificado(usuario.id);
        usuario.correo_verificado = true;
    }

    await usuarioModel.actualizarUltimoAcceso(usuario.id);
    const tokens = await tokenService.emitirParTokens(usuario);
    return { ...tokens, usuario: publico(usuario) };
};

const vincularGoogle = async ({ id_token, codigo }) => {
    const datos = await googleAuthService.verificarIdTokenGoogle(id_token);
    return vincularConProveedor({
        proveedor: 'GOOGLE',
        proveedorId: datos.proveedorId,
        correo: datos.correo,
        correoVerificado: datos.correoVerificado,
        codigo,
    });
};

// Reenvía el código de vinculación. Genera uno nuevo; el anterior deja de ser válido
// porque solo se usa el código más reciente.
const reenviarCodigoVinculacionGoogle = async ({ id_token }) => {
    const datos = await googleAuthService.verificarIdTokenGoogle(id_token);
    if (!datos.correoVerificado) {
        throw error('No se pudo vincular la cuenta: el correo no está verificado por el proveedor', 401);
    }

    const cuentaExistente = await cuentaAuthModel.buscarCuentaPorProveedor('GOOGLE', datos.proveedorId);
    if (cuentaExistente) {
        throw error('Esta cuenta ya está vinculada. Inicia sesión normalmente.', 409);
    }

    const usuario = await usuarioModel.buscarPorCorreo(normalizarCorreo(datos.correo));
    if (!usuario) {
        throw error('No hay una cuenta con este correo para vincular. Inicia sesión con Google para crearla.', 404);
    }

    await generarYEnviarCodigoVinculacion(usuario, 'GOOGLE');
    return { mensaje: 'Te enviamos un nuevo código para vincular tu cuenta', correo: usuario.correo };
};

const loginGoogle = async ({ id_token, tipo_cuenta, negocio }) => {
    const datos = await googleAuthService.verificarIdTokenGoogle(id_token);
    return loginConProveedor({
        proveedor: 'GOOGLE',
        proveedorId: datos.proveedorId,
        correo: datos.correo,
        correoVerificado: datos.correoVerificado,
        nombre: datos.nombre,
        apellido: datos.apellido,
        tipo_cuenta,
        negocio,
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

// ---------- Perfil del usuario autenticado ----------

const obtenerPerfil = async (usuarioId) => {
    const usuario = await usuarioModel.buscarPorId(usuarioId);
    if (!usuario) {
        throw error('Usuario no encontrado', 404);
    }

    const proveedores = await cuentaAuthModel.listarProveedores(usuario.id);

    const perfil = {
        ...publico(usuario),
        estado: usuario.estado,
        correo_verificado: usuario.correo_verificado,
        correo_verificado_en: usuario.correo_verificado_en,
        ultimo_acceso_en: usuario.ultimo_acceso_en,
        creado_en: usuario.creado_en,
        actualizado_en: usuario.actualizado_en,
        proveedores,
        negocio: null,
    };

    if (usuario.tipo_cuenta === 'NEGOCIO') {
        const n = await negocioModel.buscarPorUsuarioConCategoria(usuario.id);
        if (n) {
            perfil.negocio = {
                id: n.id,
                nombre_comercial: n.nombre_comercial,
                categoria: n.categoria_id ? { id: n.categoria_id, nombre: n.categoria_nombre } : null,
                descripcion_breve: n.descripcion_breve,
                logo_url: n.logo_url,
                provincia: n.provincia,
                ciudad: n.ciudad,
                sector: n.sector,
                direccion_local: n.direccion_local,
                tiene_local: n.tiene_local,
                latitud: n.latitud !== null ? Number(n.latitud) : null,
                longitud: n.longitud !== null ? Number(n.longitud) : null,
                telefono: n.telefono,
                whatsapp: n.whatsapp,
                correo_contacto: n.correo_contacto,
                redes_sociales: n.redes_sociales,
                horario_atencion: n.horario_atencion,
                entrega_domicilio: n.entrega_domicilio,
                zona_cobertura: n.zona_cobertura,
                estado: n.estado,
                creado_en: n.creado_en,
                actualizado_en: n.actualizado_en,
            };
        }
    }

    return perfil;
};

module.exports = {
    registrar,
    verificarCorreo,
    correoExiste,
    reenviarVerificacion,
    iniciarSesion,
    refrescarToken,
    cerrarSesion,
    loginGoogle,
    vincularGoogle,
    reenviarCodigoVinculacionGoogle,
    solicitarRecuperacion,
    restablecerContrasena,
    obtenerPerfil,
};
