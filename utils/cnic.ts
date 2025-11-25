export function normalizeCNIC(input?: string | null) {
    if (!input) return undefined

    const digits = String(input).replace(/\D/g, "")
    if (digits.length === 0) return undefined
    return digits
}

export function formatCNIC(input?: string | null) {
    const digits = normalizeCNIC(input)
    if (!digits) return undefined

    if (digits.length !== 13) return digits
    return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`
}

export default { normalizeCNIC, formatCNIC }
