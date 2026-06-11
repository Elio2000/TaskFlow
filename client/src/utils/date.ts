const pad = (n: number) => String(n).padStart(2, '0')

export const DateU = {
  fmt(d: Date): string {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  },
  parse(s: string): Date {
    return new Date(s + 'T00:00:00')
  },
  today(): string {
    return this.fmt(new Date())
  },
  addDays(s: string, n: number): string {
    const d = this.parse(s)
    d.setDate(d.getDate() + n)
    return this.fmt(d)
  },
  weekdayCN(s: string): string {
    return ['日', '一', '二', '三', '四', '五', '六'][this.parse(s).getDay()]
  },
  human(s: string | null): string {
    if (!s) return ''
    const t = this.today()
    if (s === t) return '今天'
    if (s === this.addDays(t, 1)) return '明天'
    if (s === this.addDays(t, -1)) return '昨天'
    const d = this.parse(s)
    const diff = (d.getTime() - this.parse(t).getTime()) / 86400000
    if (diff > 1 && diff < 7) return '周' + this.weekdayCN(s)
    const sameYear = d.getFullYear() === new Date().getFullYear()
    return (sameYear ? '' : d.getFullYear() + '年') + (d.getMonth() + 1) + '月' + d.getDate() + '日'
  },
  isOverdue(s: string | null): boolean {
    return !!s && s < this.today()
  },
  monthGrid(year: number, month: number): { date: string; day: number; inMonth: boolean }[] {
    const first = new Date(year, month, 1)
    const startOffset = first.getDay() === 0 ? 6 : first.getDay() - 1
    const cells: { date: string; day: number; inMonth: boolean }[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(year, month, 1 - startOffset + i)
      cells.push({ date: this.fmt(d), day: d.getDate(), inMonth: d.getMonth() === month })
    }
    return cells
  },
}
