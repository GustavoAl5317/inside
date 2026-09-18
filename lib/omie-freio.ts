/**
 * Freio para o app não cair no bloqueio da API do Omie.
 *
 * Regra do Omie ("Limites de Consumo da API", ajuda.omie.com.br): na 10ª
 * requisição com erro para o mesmo IP + App Key + Método, bloqueio de 30 minutos
 * (HTTP 425, "API bloqueada por consumo indevido"), e cada nova requisição com
 * erro durante o bloqueio o prorroga. "Não cadastrado" e "Não existem registros"
 * contam como erro: o Omie responde com HTTP 500.
 *
 * O freio conta os erros por app key + método e para o envio antes do 10º, com
 * uma mensagem clara, em vez de seguir até o bloqueio. Se o Omie já bloqueou, não
 * chama aquele método até o prazo que ele informou — chamar antes só estende.
 *
 * O estado fica na memória do processo (o pm2 roda um só) e é compartilhado entre
 * envios, porque o limite do Omie é por chave, não por negócio. Ele não enxerga
 * erros de outros sistemas que usem a mesma chave; por isso para com folga.
 */

/** O Omie bloqueia no 10º erro; o freio para no 8º. */
const LIMITE_ERROS = 8
/** Janela de contagem. A do Omie não é documentada; 30 min é o lado seguro. */
const JANELA_MS = 30 * 60_000

const erros = new Map<string, number[]>()
const bloqueadoAte = new Map<string, number>()

export class OmieFreioError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OmieFreioError'
  }
}

const chaveDe = (appKey: string, metodo: string) => `${appKey}:${metodo}`

const emMinutos = (ms: number) => {
  const min = Math.max(1, Math.ceil(ms / 60_000))
  return `${min} minuto${min > 1 ? 's' : ''}`
}

/** Antes de cada requisição. Lança se o método está bloqueado ou perto do limite. */
export function freioAntes(appKey: string, metodo: string, agora = Date.now()): void {
  const k = chaveDe(appKey, metodo)

  const ate = bloqueadoAte.get(k) ?? 0
  if (ate > agora) {
    throw new OmieFreioError(
      `O Omie bloqueou ${metodo} por excesso de erros. Aguarde ${emMinutos(ate - agora)} e reenvie — ` +
      `tentar antes só estende o bloqueio.`,
    )
  }

  const recentes = (erros.get(k) ?? []).filter(t => agora - t < JANELA_MS)
  erros.set(k, recentes)
  if (recentes.length >= LIMITE_ERROS) {
    throw new OmieFreioError(
      `Envio pausado para o Omie não bloquear: ${recentes.length} respostas com erro em ${metodo} nos ` +
      `últimos 30 minutos, e o Omie bloqueia na 10ª. Reenvie em ${emMinutos(recentes[0] + JANELA_MS - agora)}.`,
    )
  }
}

/** Depois de cada resposta do Omie (não em falha de rede, que não chega a ele). */
export function freioDepois(
  appKey: string, metodo: string, httpStatus: number, faultstring: unknown, agora = Date.now(),
): void {
  const k = chaveDe(appKey, metodo)
  const f = String(faultstring ?? '')

  const segundos = /tente novamente em\s+(\d+)\s*segundo/i.exec(f)
  const bloqueio = httpStatus === 425 || /bloquead|consumo indevido|misuse_api/i.test(f)
  const redundante = /redundan/i.test(f)
  if (bloqueio || redundante || segundos) {
    // Consumo redundante segura por 60 s; o bloqueio por erro, 30 min. Quando o
    // Omie informa o prazo, vale o dele.
    const s = segundos ? Number(segundos[1]) : bloqueio ? 30 * 60 : 60
    bloqueadoAte.set(k, agora + s * 1000)
    return
  }

  if (httpStatus >= 400 || f) erros.set(k, [...(erros.get(k) ?? []), agora])
}

/** Só para teste. */
export function _zeraFreio() {
  erros.clear()
  bloqueadoAte.clear()
}
