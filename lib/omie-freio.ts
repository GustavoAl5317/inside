/**
 * Freio para o app não cair no bloqueio da API do Omie.
 *
 * Regra do Omie ("Limites de Consumo da API", ajuda.omie.com.br): na 10ª
 * requisição com erro para o mesmo IP + App Key + Método, bloqueio de 30 minutos
 * (HTTP 425, "API bloqueada por consumo indevido"), e cada nova requisição com
 * erro durante o bloqueio o prorroga. "Não cadastrado" e "Não existem registros"
 * contam como erro: o Omie responde com HTTP 500.
 *
 * O freio conta os erros por app key + método e, perto do limite, ESPERA antes da
 * próxima chamada em vez de interromper — o envio termina inteiro, só mais
 * devagar. Se o Omie já bloqueou, espera o prazo que ele informou, porque chamar
 * antes só estende o bloqueio.
 *
 * O estado fica na memória do processo (o pm2 roda um só) e é compartilhado entre
 * envios, porque o limite do Omie é por chave, não por negócio. Ele não enxerga
 * erros de outros sistemas que usem a mesma chave; por isso segura com folga.
 */

/** O Omie bloqueia no 10º erro; o freio segura no 8º. */
const LIMITE_ERROS = 8
/** Janela de contagem. A do Omie não é documentada; 30 min é o lado seguro. */
const JANELA_MS = 30 * 60_000
/** Folga depois do prazo, para não bater no Omie um instante antes da liberação. */
const MARGEM_MS = 5_000
/** Acima disso o Omie segue bloqueando por outro motivo; o envio desiste e avisa. */
const ESPERA_MAXIMA_MS = 2 * 60 * 60_000

const erros = new Map<string, number[]>()
const bloqueadoAte = new Map<string, number>()

const chaveDe = (appKey: string, metodo: string) => `${appKey}:${metodo}`

const emMinutos = (ms: number) => {
  const min = Math.max(1, Math.ceil(ms / 60_000))
  return `${min} minuto${min > 1 ? 's' : ''}`
}

/** Quanto esperar antes da próxima chamada a este método — null quando pode seguir. */
export function esperaNecessaria(
  appKey: string, metodo: string, agora = Date.now(),
): { ms: number; motivo: string } | null {
  const k = chaveDe(appKey, metodo)

  const ate = bloqueadoAte.get(k) ?? 0
  if (ate > agora) {
    const ms = ate - agora + MARGEM_MS
    return {
      ms,
      motivo: `O Omie bloqueou ${metodo} por excesso de erros. Aguardando ${emMinutos(ms)} para continuar ` +
        `o envio sem estender o bloqueio.`,
    }
  }

  const recentes = (erros.get(k) ?? []).filter(t => agora - t < JANELA_MS)
  erros.set(k, recentes)
  if (recentes.length >= LIMITE_ERROS) {
    const ms = recentes[0] + JANELA_MS - agora + MARGEM_MS
    return {
      ms,
      motivo: `${recentes.length} respostas com erro em ${metodo} nos últimos 30 minutos (o Omie bloqueia na ` +
        `10ª). Aguardando ${emMinutos(ms)} antes da próxima para o Omie não bloquear — o envio continua depois.`,
    }
  }

  return null
}

/**
 * Antes de cada requisição: espera o que for preciso e só então libera. Avisa o
 * motivo a cada espera (vai para o log que a tela de processamento mostra).
 */
export async function aguardaFreio(
  appKey: string,
  metodo: string,
  avisa?: (motivo: string) => unknown,
  dorme: (ms: number) => Promise<unknown> = ms => new Promise(r => setTimeout(r, ms)),
  relogio: () => number = Date.now,
): Promise<void> {
  let esperado = 0
  for (;;) {
    const espera = esperaNecessaria(appKey, metodo, relogio())
    if (!espera) return
    if (esperado + espera.ms > ESPERA_MAXIMA_MS) {
      throw new Error(
        `O Omie continua bloqueando ${metodo}` +
        (esperado ? ` depois de ${emMinutos(esperado)} de espera` : ` por mais de 2 horas`) +
        `. Envio interrompido — reenvie mais tarde.`,
      )
    }
    await avisa?.(espera.motivo)
    await dorme(espera.ms)
    esperado += espera.ms
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
