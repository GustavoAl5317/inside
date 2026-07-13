import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function stripCNPJDigits(value: string): string {
  return (value || "").replace(/\D/g, "")
}

/** Normaliza CNPJ: remove máscara e completa zeros à esquerda (ex.: Bitrix sem o 0 inicial). */
export function normalizeCNPJDigits(value: string): string {
  const digits = stripCNPJDigits(value)
  if (!digits || digits.length > 14) return digits
  if (digits.length === 11) return digits
  if (digits.length < 12) return digits
  return digits.padStart(14, "0")
}

export function isCNPJComplete(value: string): boolean {
  const digits = stripCNPJDigits(value)
  return digits.length >= 12 && digits.length <= 14
}

export function formatCNPJ(cnpj: string) {
  const cleanCNPJ = normalizeCNPJDigits(cnpj)

  // Format as XX.XXX.XXX/XXXX-XX
  if (cleanCNPJ.length === 14) {
    return cleanCNPJ.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
  }

  return cnpj
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

/** Formata número para input de moeda BRL (sem R$), ex.: 14000 → "14.000,00". */
export function formatBRLInput(value: number): string {
  if (!Number.isFinite(value) || value === 0) return ""
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Converte texto em moeda BRL para número.
 * Aceita "14.000,50", "14000", "14,50", "14.50" etc.
 */
export function parseBRL(value: string | number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const raw = value.trim()
  if (!raw) return 0

  let s = raw.replace(/[^\d,.-]/g, "")

  // Vírgula = decimal brasileiro → remove pontos de milhar
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".")
    const n = Number.parseFloat(s)
    return Number.isFinite(n) ? n : 0
  }

  // Só ponto: "14.000" (milhar) ou "14.50" (decimal)
  if (s.includes(".")) {
    const parts = s.split(".")
    const last = parts[parts.length - 1] ?? ""
    if (parts.length === 2 && last.length > 0 && last.length <= 2) {
      const n = Number.parseFloat(s)
      return Number.isFinite(n) ? n : 0
    }
    const n = Number.parseFloat(s.replace(/\./g, ""))
    return Number.isFinite(n) ? n : 0
  }

  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

export function formatDate(date: string | Date) {
  if (!date) return ""

  const d = new Date(date)
  return d.toLocaleDateString("pt-BR")
}

// Validates CNPJ using verification algorithm
export function validateCNPJ(cnpj: string): boolean {
  const cleanCNPJ = normalizeCNPJDigits(cnpj)

  // CNPJ must have 14 digits
  if (cleanCNPJ.length !== 14) {
    return false
  }

  // Check for known invalid CNPJs
  if (/^(\d)\1{13}$/.test(cleanCNPJ)) {
    return false
  }

  // Calculate first verification digit
  let sum = 0
  let weight = 5
  for (let i = 0; i < 12; i++) {
    sum += Number.parseInt(cleanCNPJ.charAt(i)) * weight
    weight = weight === 2 ? 9 : weight - 1
  }
  let digit = 11 - (sum % 11)
  const firstDigit = digit >= 10 ? 0 : digit

  // Calculate second verification digit
  sum = 0
  weight = 6
  for (let i = 0; i < 12; i++) {
    sum += Number.parseInt(cleanCNPJ.charAt(i)) * weight
    weight = weight === 2 ? 9 : weight - 1
  }
  sum += firstDigit * 2
  digit = 11 - (sum % 11)
  const secondDigit = digit >= 10 ? 0 : digit

  // Check if the calculated verification digits match the provided ones
  return Number.parseInt(cleanCNPJ.charAt(12)) === firstDigit && Number.parseInt(cleanCNPJ.charAt(13)) === secondDigit
}

export const paymentConditions = [
  { value: "à vista", label: "À Vista" },
  { value: "30 dias", label: "30 Dias" },
  { value: "30/60 dias", label: "30/60 Dias" },
  { value: "30/60/90 dias", label: "30/60/90 Dias" },
  { value: "45 dias", label: "45 Dias" },
  { value: "60 dias", label: "60 Dias" },
  { value: "90 dias", label: "90 Dias" },
]

export const states = [
  { value: "AC", label: "AC - Acre" },
  { value: "AL", label: "AL - Alagoas" },
  { value: "AP", label: "AP - Amapá" },
  { value: "AM", label: "AM - Amazonas" },
  { value: "BA", label: "BA - Bahia" },
  { value: "CE", label: "CE - Ceará" },
  { value: "DF", label: "DF - Distrito Federal" },
  { value: "ES", label: "ES - Espírito Santo" },
  { value: "GO", label: "GO - Goiás" },
  { value: "MA", label: "MA - Maranhão" },
  { value: "MT", label: "MT - Mato Grosso" },
  { value: "MS", label: "MS - Mato Grosso do Sul" },
  { value: "MG", label: "MG - Minas Gerais" },
  { value: "PA", label: "PA - Pará" },
  { value: "PB", label: "PB - Paraíba" },
  { value: "PR", label: "PR - Paraná" },
  { value: "PE", label: "PE - Pernambuco" },
  { value: "PI", label: "PI - Piauí" },
  { value: "RJ", label: "RJ - Rio de Janeiro" },
  { value: "RN", label: "RN - Rio Grande do Norte" },
  { value: "RS", label: "RS - Rio Grande do Sul" },
  { value: "RO", label: "RO - Rondônia" },
  { value: "RR", label: "RR - Roraima" },
  { value: "SC", label: "SC - Santa Catarina" },
  { value: "SP", label: "SP - São Paulo" },
  { value: "SE", label: "SE - Sergipe" },
  { value: "TO", label: "TO - Tocantins" }
]

export const taxpayerOptions = [
  { value: "true", label: "Sim" },
  { value: "false", label: "Não" },
]

export function formatZipCode(zipCode: string): string {
  // Remove any non-numeric characters
  const cleanZipCode = zipCode.replace(/\D/g, "")

  // Format as XXXXX-XXX
  if (cleanZipCode.length === 8) {
    return cleanZipCode.replace(/^(\d{5})(\d{3})$/, "$1-$2")
  }

  return zipCode
}

export function formatPhoneNumber(phone: string): string {
  // Remove any non-numeric characters
  const cleanPhone = phone.replace(/\D/g, "")

  // Format based on length
  if (cleanPhone.length === 11) {
    // Mobile: (XX) XXXXX-XXXX
    return cleanPhone.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3")
  } else if (cleanPhone.length === 10) {
    // Landline: (XX) XXXX-XXXX
    return cleanPhone.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3")
  }

  return phone
}
