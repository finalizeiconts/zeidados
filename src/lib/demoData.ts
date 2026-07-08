import type { EventStatus, FinancialEvent } from './types'

/**
 * Gera um conjunto de lançamentos fictícios porém realistas para um escritório
 * de contabilidade (o caso da Finalizei): honorários recorrentes de clientes,
 * serviços avulsos e despesas fixas. Determinístico por seed, para o painel não
 * "dançar" a cada render. Serve para rodar o app sem Supabase/Conta Azul.
 */

// PRNG determinístico (mulberry32).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

const CLIENTES: Array<{ nome: string; honorario: number }> = [
  { nome: 'Grolli e Matos Arquitetura', honorario: 980 },
  { nome: 'Talita de Franco Advocacia', honorario: 550 },
  { nome: 'Padaria Pão Nosso Ltda', honorario: 720 },
  { nome: 'Studio Vértice Design', honorario: 640 },
  { nome: 'Óptica Visão Clara', honorario: 890 },
  { nome: 'TransLog Transportes ME', honorario: 1450 },
  { nome: 'Clínica Bem Viver', honorario: 1680 },
  { nome: 'Mercado São Jorge', honorario: 1240 },
  { nome: 'NovaTech Sistemas', honorario: 2100 },
  { nome: 'Bella Moda Confecções', honorario: 760 },
  { nome: 'Restaurante Sabor da Terra', honorario: 1120 },
  { nome: 'Auto Peças Bom Giro', honorario: 680 },
  { nome: 'Escola Pequeno Príncipe', honorario: 1890 },
  { nome: 'Farmácia Saúde Total', honorario: 1350 },
  { nome: 'Construtora Alvorada', honorario: 2450 },
  { nome: 'Pet Shop Amigo Fiel', honorario: 590 },
  { nome: 'Marcenaria Nobre Madeira', honorario: 830 },
  { nome: 'Academia Corpo & Movimento', honorario: 940 },
  { nome: 'Salão Beleza Pura', honorario: 480 },
  { nome: 'Distribuidora Norte Sul', honorario: 3200 },
  { nome: 'Café Grão Especial', honorario: 620 },
  { nome: 'Imobiliária Lar Feliz', honorario: 1560 },
  { nome: 'Oficina do Parafuso', honorario: 710 },
  { nome: 'Gráfica Impressão Rápida', honorario: 990 },
  { nome: 'Consultório Dr. Andrade', honorario: 1280 },
]

const SERVICOS_AVULSOS = [
  { desc: 'Abertura de empresa', min: 900, max: 1800 },
  { desc: 'Declaração de IRPF', min: 250, max: 700 },
  { desc: 'Parcelamento de débitos', min: 400, max: 1200 },
  { desc: 'Regularização fiscal', min: 800, max: 2500 },
  { desc: 'Consultoria tributária', min: 1500, max: 4500 },
  { desc: 'Alteração contratual', min: 600, max: 1400 },
]

interface DespesaFixa {
  category: string
  counterparty: string
  base: number
  varia: number
  dia: number
}

const DESPESAS_FIXAS: DespesaFixa[] = [
  { category: 'Folha de pagamento', counterparty: 'Equipe interna', base: 9000, varia: 900, dia: 5 },
  { category: 'Pró-labore', counterparty: 'Sócios', base: 5000, varia: 0, dia: 5 },
  { category: 'Impostos', counterparty: 'Simples Nacional (DAS)', base: 2100, varia: 600, dia: 20 },
  { category: 'Aluguel', counterparty: 'Imobiliária Central', base: 2200, varia: 0, dia: 10 },
  { category: 'Software', counterparty: 'Conta Azul + ferramentas', base: 780, varia: 120, dia: 15 },
  { category: 'Infraestrutura', counterparty: 'Energia, internet e água', base: 760, varia: 250, dia: 12 },
  { category: 'Marketing', counterparty: 'Tráfego e mídia', base: 1100, varia: 500, dia: 8 },
  { category: 'Serviços terceiros', counterparty: 'Contabilidade jurídica', base: 640, varia: 260, dia: 18 },
]

let uid = 0
function nextId(prefix: string): string {
  uid += 1
  return `${prefix}-${uid.toString(36)}`
}

/**
 * @param now data de referência (o "hoje" do painel)
 * @param months quantos meses para trás gerar
 * @param seed semente do PRNG
 */
export function generateDemoEvents(
  now: Date = new Date(),
  months = 14,
  seed = 20260708,
): FinancialEvent[] {
  const rand = mulberry32(seed)
  const events: FinancialEvent[] = []
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const DAY = 86_400_000
  const settleStatus = (due: Date): { status: EventStatus; settled: string | null } => {
    const ageDays = (today.getTime() - due.getTime()) / DAY

    // Títulos antigos (> 45 dias) já se resolveram — foram pagos, alguns com
    // atraso. Evita acúmulo irreal de vencidos de meses/anos atrás.
    if (ageDays > 45) {
      const lag = Math.floor(rand() * 9) - 1 // -1..+7 dias
      const s = new Date(due)
      s.setDate(s.getDate() + lag)
      return { status: 'pago', settled: isoDate(s > today ? today : s) }
    }

    // Vencidos recentes: maioria paga, ~8% ainda em aberto (inadimplência).
    if (ageDays > 0) {
      if (rand() < 0.92) {
        const lag = Math.floor(rand() * 6) - 1
        const s = new Date(due)
        s.setDate(s.getDate() + lag)
        return { status: 'pago', settled: isoDate(s > today ? today : s) }
      }
      return { status: 'vencido', settled: null }
    }

    // Vencimento hoje ou futuro: alguns adiantam, a maioria fica pendente.
    if (rand() < 0.35) {
      const s = new Date(due)
      s.setDate(s.getDate() - Math.floor(rand() * 3))
      return { status: 'pago', settled: isoDate(s > today ? today : s) }
    }
    return { status: 'pendente', settled: null }
  }

  for (let m = months - 1; m >= 0; m--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - m, 1)

    // ── Honorários recorrentes ──────────────────────────────────────────
    for (const cli of CLIENTES) {
      // Cliente pode ter entrado depois (churn/onboarding) — pula alguns meses antigos.
      if (m > 10 && rand() < 0.25) continue
      const due = new Date(ref.getFullYear(), ref.getMonth(), 10)
      const { status, settled } = settleStatus(due)
      const jitter = 1 + (rand() - 0.5) * 0.04
      events.push({
        id: nextId('rec'),
        kind: 'receita',
        description: `Honorários contábeis — ${cli.nome.split(' ')[0]}`,
        category: 'Honorários',
        counterparty: cli.nome,
        amount: Math.round(cli.honorario * jitter),
        dueDate: isoDate(due),
        settledDate: settled,
        status,
      })
    }

    // ── Serviços avulsos (1–3 por mês) ──────────────────────────────────
    const nAvulsos = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < nAvulsos; i++) {
      const svc = SERVICOS_AVULSOS[Math.floor(rand() * SERVICOS_AVULSOS.length)]
      const cli = CLIENTES[Math.floor(rand() * CLIENTES.length)]
      const day = 3 + Math.floor(rand() * 24)
      const due = new Date(ref.getFullYear(), ref.getMonth(), day)
      const { status, settled } = settleStatus(due)
      events.push({
        id: nextId('svc'),
        kind: 'receita',
        description: svc.desc,
        category: 'Serviços avulsos',
        counterparty: cli.nome,
        amount: Math.round(svc.min + rand() * (svc.max - svc.min)),
        dueDate: isoDate(due),
        settledDate: settled,
        status,
      })
    }

    // ── Despesas fixas ──────────────────────────────────────────────────
    for (const dsp of DESPESAS_FIXAS) {
      const due = new Date(ref.getFullYear(), ref.getMonth(), dsp.dia)
      const { status, settled } = settleStatus(due)
      const amount = Math.round(dsp.base + (rand() - 0.5) * 2 * dsp.varia)
      events.push({
        id: nextId('dsp'),
        kind: 'despesa',
        description: dsp.category,
        category: dsp.category,
        counterparty: dsp.counterparty,
        amount,
        dueDate: isoDate(due),
        settledDate: settled,
        status,
      })
    }
  }

  return events
}

/**
 * Cria um novo lançamento aleatório "recém-chegado" — usado pelo modo demo para
 * simular a chegada de dados em tempo real (novo recebimento/pagamento hoje).
 */
export function makeLiveEvent(now: Date, rand: () => number = Math.random): FinancialEvent {
  const isReceita = rand() < 0.62
  const today = isoDate(now)
  if (isReceita) {
    const cli = CLIENTES[Math.floor(rand() * CLIENTES.length)]
    return {
      id: nextId('live'),
      kind: 'receita',
      description: `Recebimento — ${cli.nome.split(' ')[0]}`,
      category: rand() < 0.7 ? 'Honorários' : 'Serviços avulsos',
      counterparty: cli.nome,
      amount: Math.round(cli.honorario * (0.8 + rand() * 0.6)),
      dueDate: today,
      settledDate: today,
      status: 'pago',
    }
  }
  const dsp = DESPESAS_FIXAS[Math.floor(rand() * DESPESAS_FIXAS.length)]
  return {
    id: nextId('live'),
    kind: 'despesa',
    description: `Pagamento — ${dsp.category}`,
    category: dsp.category,
    counterparty: dsp.counterparty,
    amount: Math.round(dsp.base * (0.1 + rand() * 0.3)),
    dueDate: today,
    settledDate: today,
    status: 'pago',
  }
}
