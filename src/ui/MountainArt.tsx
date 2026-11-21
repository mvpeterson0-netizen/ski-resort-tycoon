/** Decorative placeholder art for the title screen. Not real terrain. */
export function MountainArt() {
  return (
    <svg viewBox="0 0 320 180" role="img" aria-label="Stylised mountain with ski trails">
      <path d="M0 180 L70 70 L110 110 L170 30 L240 100 L270 80 L320 140 L320 180 Z" fill="var(--rock)" />
      <path d="M170 30 L200 62 L188 58 L176 70 L164 56 L150 60 Z M70 70 L86 95 L74 90 L62 98 L58 88 Z" fill="var(--snow)" />
      <path d="M170 34 C160 80 140 120 120 176" stroke="var(--black)" strokeWidth="3" fill="none" strokeDasharray="0" />
      <path d="M174 36 C190 90 200 130 210 176" stroke="var(--blue)" strokeWidth="3" fill="none" />
      <path d="M168 40 C230 80 250 130 290 176" stroke="var(--green)" strokeWidth="3" fill="none" />
      <line x1="150" y1="176" x2="172" y2="34" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 3" />
    </svg>
  )
}
