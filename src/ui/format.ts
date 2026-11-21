export const usd = (n: number) => {
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${sign}$${Math.round(a / 1000)}k`
  return `${sign}$${Math.round(a)}`
}

export const ft = (n: number) => `${n.toLocaleString('en-US')} ft`

export const drive = (min: number) => {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
