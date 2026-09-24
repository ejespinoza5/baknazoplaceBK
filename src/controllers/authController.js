const fs = require('fs');
const authService = require('../services/authService');
const categoriaModel = require('../models/categoriaModel');
const { procesarFotoPerfil, procesarLogo, rutaAbsolutaDe } = require('../services/imageService');
const { parsearJson } = require('../utils/validaciones');

const booleano = (valor, defecto = false) => {
    if (valor === undefined || valor === null || valor === '') return defecto;
    return valor === true || valor === 'true' || valor === '1';
};

const registrar = async (req, res, next) => {
    let fotoPerfilUrl = null;
    let logoUrl = null;
    try {
        const archivos = req.files || {};
        const tipo_cuenta = req.body.tipo_cuenta;

        // Las imágenes son opcionales; se comprimen con sharp antes de guardar.
        if (archivos.foto_perfil?.[0]) {
            fotoPerfilUrl = await procesarFotoPerfil(archivos.foto_perfil[0].buffer);
        }
        if (archivos.logo?.[0]) {
            logoUrl = await procesarLogo(archivos.logo[0].buffer);
        }

        let negocio = null;
        if (tipo_cuenta === 'NEGOCIO') {
            negocio = {
                nombreComercial: req.body.nombre_comercial,
                categoriaId: req.body.categoria,
                descripcionBreve: req.body.descripcion_breve,
                logoUrl,
                provincia: req.body.provincia,
                ciudad: req.body.ciudad,
                sector: req.body.sector,
                direccionLocal: req.body.direccion_local,
                tieneLocal: booleano(req.body.tiene_local, true),
                latitud: req.body.latitud,
                longitud: req.body.longitud,
                telefono: req.body.telefono,
                whatsapp: req.body.whatsapp,
                correoContacto: req.body.correo_contacto,
                redes: parsearJson(req.body.redes_sociales, 'redes_sociales'),
                horario: parsearJson(req.body.horario_atencion, 'horario_atencion'),
                entregaDomicilio: booleano(req.body.entrega_domicilio),
                zonaCobertura: req.body.zona_cobertura,
            };
        }

        const usuario = await authService.registrar({
            tipo_cuenta,
            correo: req.body.correo,
            contrasena: req.body.contrasena,
            nombres: req.body.nombres,
            apellidos: req.body.apellidos,
            foto_perfil: fotoPerfilUrl ? { url: fotoPerfilUrl } : null,
            negocio,
        });
        res.status(201).json({ mensaje: 'Usuario registrado. Revisa tu correo para verificar la cuenta.', usuario });
    } catch (err) {
        // Si algo falla (validación, duplicado, BDD), se borran las imágenes ya guardadas.
        for (const url of [fotoPerfilUrl, logoUrl]) {
            const abs = rutaAbsolutaDe(url);
            if (abs) fs.promises.unlink(abs).catch(() => {});
        }
        next(err);
    }
};

const listarCategorias = async (req, res, next) => {
    try {
        const categorias = await categoriaModel.listarActivas();
        res.json({ categorias });
    } catch (err) {
        next(err);
    }
};

const verificarCorreo = async (req, res, next) => {
    try {
        const { correo, codigo } = req.body;
        if (!correo || !codigo) {
            return res.status(400).json({ error: 'Correo y código son requeridos' });
        }
        const resultado = await authService.verificarCorreo({ correo, codigo });
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const reenviarVerificacion = async (req, res, next) => {
    try {
        const { correo } = req.body;
        if (!correo) {
            return res.status(400).json({ error: 'Correo requerido' });
        }
        const resultado = await authService.reenviarVerificacion({ correo });
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const iniciarSesion = async (req, res, next) => {
    try {
        const { correo, contrasena } = req.body;
        if (!correo || !contrasena) {
            return res.status(400).json({ error: 'Correo y contraseña requeridos' });
        }
        const resultado = await authService.iniciarSesion({ correo, contrasena });
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const refrescarToken = async (req, res, next) => {
    try {
        const { refresh_token } = req.body;
        const resultado = await authService.refrescarToken({ refresh_token });
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const cerrarSesion = async (req, res, next) => {
    try {
        const { refresh_token } = req.body;
        const resultado = await authService.cerrarSesion({ refresh_token });
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const loginGoogle = async (req, res, next) => {
    try {
        const { id_token, tipo_cuenta } = req.body;
        if (!id_token) {
            return res.status(400).json({ error: 'id_token requerido' });
        }
        const resultado = await authService.loginGoogle({ id_token, tipo_cuenta });
        // 202: la cuenta existe pero falta confirmar la vinculación con el código enviado al correo.
        res.status(resultado.requiere_vinculacion ? 202 : 200).json(resultado);
    } catch (err) {
        next(err);
    }
};

const reenviarCodigoVinculacionGoogle = async (req, res, next) => {
    try {
        const { id_token } = req.body;
        if (!id_token) {
            return res.status(400).json({ error: 'id_token requerido' });
        }
        const resultado = await authService.reenviarCodigoVinculacionGoogle({ id_token });
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const vincularGoogle = async (req, res, next) => {
    try {
        const { id_token, codigo } = req.body;
        if (!id_token || !codigo) {
            return res.status(400).json({ error: 'id_token y codigo son requeridos' });
        }
        const resultado = await authService.vincularGoogle({ id_token, codigo });
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const solicitarRecuperacion = async (req, res, next) => {
    try {
        const { correo } = req.body;
        if (!correo) {
            return res.status(400).json({ error: 'Correo requerido' });
        }
        const resultado = await authService.solicitarRecuperacion({ correo });
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const restablecerContrasena = async (req, res, next) => {
    try {
        const { correo, codigo, nueva_contrasena } = req.body;
        if (!correo || !codigo || !nueva_contrasena) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }
        const resultado = await authService.restablecerContrasena({ correo, codigo, nueva_contrasena });
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

// Las imágenes se guardan como rutas relativas (/uploads/...); se devuelve también la URL absoluta.
const urlAbsoluta = (req, ruta) => {
    if (!ruta) return null;
    if (/^https?:\/\//i.test(ruta)) return ruta;
    return `${req.protocol}://${req.get('host')}${ruta}`;
};

const perfil = async (req, res, next) => {
    try {
        const usuario = await authService.obtenerPerfil(req.usuario.id);
        usuario.foto_perfil_url = urlAbsoluta(req, usuario.foto_perfil);
        if (usuario.negocio) {
            usuario.negocio.logo_url_completa = urlAbsoluta(req, usuario.negocio.logo_url);
        }
        res.json({ usuario });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    registrar,
    listarCategorias,
    verificarCorreo,
    reenviarVerificacion,
    iniciarSesion,
    refrescarToken,
    cerrarSesion,
    loginGoogle,
    vincularGoogle,
    reenviarCodigoVinculacionGoogle,
    solicitarRecuperacion,
    restablecerContrasena,
    perfil,
};
