const axios = require('axios');
require('dotenv').config();

const SLEEP_MS = Number(process.env.SLEEP_MS || 260);

/**
 * Realiza uma chamada à API do Omie.
 *
 * Seleciona app_key/app_secret com base no CNPJ da empresa:
 *   - EMPRESA === '03969530000211' → APP_KEY_2 / APP_SECRET_2
 *   - qualquer outro              → APP_KEY_1 / APP_SECRET_1
 *
 * @param {string} EMPRESA   - CNPJ da empresa (apenas dígitos)
 * @param {string} omie_url  - URL do endpoint Omie
 * @param {string} method    - Nome do método (ex: "ListarClientes")
 * @param {object} params    - Payload do método
 * @returns {object|null}    - Dados da resposta ou objeto de erro
 */
async function requestOmie(EMPRESA, omie_url, method, params) {
  console.log('requestOmie method:', method, '| params:', JSON.stringify(params));

  const empresaDigits = String(EMPRESA || '').replace(/\D/g, '');
  const app_key    = empresaDigits === '03969530000211' ? process.env.APP_KEY_2    : process.env.APP_KEY_1;
  const app_secret = empresaDigits === '03969530000211' ? process.env.APP_SECRET_2 : process.env.APP_SECRET_1;

  if (!app_key || !app_secret) {
    throw new Error(`Credenciais Omie não configuradas para empresa "${empresaDigits}". Verifique APP_KEY_1/APP_SECRET_1 no .env`);
  }

  const body = {
    call:       method,
    app_key,
    app_secret,
    param:      [params],
  };

  console.log('requestOmie empresa:', empresaDigits, '| url:', omie_url);

  // Respeita SLEEP_MS do .env para evitar throttling da API
  await new Promise(resolve => setTimeout(resolve, SLEEP_MS));

  try {
    const response = await axios.post(omie_url, body, {
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json',
      },
      timeout: 30000, // 30s
    });

    if (response.status === 200) {
      console.log('requestOmie OK:', JSON.stringify(response.data));
    } else {
      console.warn('requestOmie status inesperado:', response.status, response.data);
    }

    return response.data;
  } catch (error) {
    // Erro HTTP retornado pelo Omie (4xx/5xx)
    if (error.response) {
      console.error('requestOmie erro Omie:', error.response.status, JSON.stringify(error.response.data));
      return error.response.data; // ex: { faultstring: "..." }
    }

    // Erro de rede / timeout / ECONNREFUSED
    console.error('requestOmie erro de rede:', error.message);
    return { faultstring: `Erro de rede ao chamar Omie: ${error.message}`, faultcode: 'NETWORK_ERROR' };
  }
}

module.exports.requestOmie = requestOmie;
