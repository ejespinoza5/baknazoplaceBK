const authService = require('../services/authService');

const registrar = async (req, res, next) => {
    try {
        const { tipo_cuenta, correo, contrasena, nombres, apellidos } = req.body;

        if (!correo || !contrasena || !nombres || !tipo_cuenta) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        const usuario = await authService.registrar({ tipo_cuenta, correo, contrasena, nombres, apellidos });
        res.status(201).json({ mensaje: 'Usuario registrado. Revisa tu correo para verificar la cuenta.', usuario });
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
        res.json(resultado);
    } catch (err) {
        next(err);
    }
};

const loginFacebook = async (req, res, next) => {
    try {
        const { access_token, tipo_cuenta } = req.body || {};
        if (!access_token) {
            return res.status(400).json({ error: 'access_token requerido' });
        }
        const resultado = await authService.loginFacebook({ access_token, tipo_cuenta });
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

const perfil = async (req, res) => {
    res.json({ usuario: req.usuario });
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
    perfil,
};
