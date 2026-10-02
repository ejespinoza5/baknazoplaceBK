const { JWT } = require('google-auth-library');
const env = require('../config/env');

// Envío de push con la API HTTP v1 de Firebase Cloud Messaging.
//
// Usa google-auth-library (ya instalada para el login con Google) para firmar
// con la cuenta de servicio y pedir el token OAuth; no hace falta firebase-admin.
// El cliente JWT guarda el token de acceso y lo renueva solo.

const ALCANCE = 'https://www.googleapis.com/auth/firebase.messaging';

// Errores de FCM que significan "este token ya no sirve": se borra.
const TOKEN_INVALIDO = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH', 'NOT_FOUND']);

let cliente = null;

const configurado = () => Boolean(env.firebase.projectId && env.firebase.clientEmail && env.firebase.privateKey);

const obtenerCliente = () => {
    if (!cliente) {
        cliente = new JWT({ email: env.firebase.clientEmail, key: env.firebase.privateKey, scopes: [ALCANCE] });
    }
    return cliente;
};

const codigoDeError = (e) => {
    const detalles = e?.response?.data?.error?.details || [];
    const fcm = detalles.find((d) => d.errorCode)?.errorCode;
    return fcm || e?.response?.data?.error?.status || null;
};

// Manda un mensaje solo de datos a cada token. El service worker del
// navegador lo convierte en notificación: así decide el sonido, la etiqueta
// que agrupa y a dónde lleva al pulsarla. Todos los valores de `data` deben
// ser texto (lo exige FCM).
//
// Devuelve los tokens que FCM declaró inválidos, para borrarlos.
const enviar = async (tokens, data) => {
    if (!configurado() || tokens.length === 0) return { invalidos: [] };
    const url = `https://fcm.googleapis.com/v1/projects/${env.firebase.projectId}/messages:send`;
    const invalidos = [];

    await Promise.all(
        tokens.map(async (token) => {
            try {
                await obtenerCliente().request({
                    url,
                    method: 'POST',
                    data: {
                        message: {
                            token,
                            data,
                            webpush: { headers: { Urgency: 'high', TTL: String(24 * 60 * 60) } },
                        },
                    },
                });
            } catch (e) {
                const codigo = codigoDeError(e);
                if (TOKEN_INVALIDO.has(codigo) || e?.response?.status === 404) {
                    invalidos.push(token);
                } else {
                    // Cuota, red o credenciales: se registra y se sigue; el
                    // aviso dentro de la app ya quedó guardado.
                    console.error('[fcm] no se pudo enviar:', codigo || e.message);
                }
            }
        })
    );
    return { invalidos };
};

module.exports = { configurado, enviar };
