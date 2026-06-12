/* Safe labels parser — handles single/double encoded JSON strings */
export function parseTaskLabels(labels: string): string[] {
  try {
    const parsed = JSON.parse(labels)
    if (Array.isArray(parsed)) return parsed.filter((v: any) => typeof v === 'string')
    // double-encoded: labels was a JSON string of a JSON string
    if (typeof parsed === 'string') {
      const parsed2 = JSON.parse(parsed)
      if (Array.isArray(parsed2)) return parsed2.filter((v: any) => typeof v === 'string')
    }
  } catch {}
  return []
}
