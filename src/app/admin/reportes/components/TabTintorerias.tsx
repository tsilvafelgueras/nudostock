import { Factory, Layers, Boxes, Percent } from 'lucide-react'
import KpiCard from './KpiCard'
import ChartCard from './ChartCard'
import RindeTintoreriaChart from '../charts/RindeTintoreriaChart'
import FallasChart from '../charts/FallasChart'
import { SeccionTintorerias } from './LegacySections'
import type {
  TintoreriaPerformance,
  ScorecardRow,
} from '../queries/tintorerias'
import type { PedidosTintoreriaRow } from '../queries'

const fmtKg = (n: number) =>
  n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
const fmt1 = (n: number) =>
  n.toLocaleString('es-AR', { maximumFractionDigits: 1 })

export type TabTintoreriasData = {
  performance: TintoreriaPerformance
  volumen: PedidosTintoreriaRow[]
}

export default function TabTintorerias({
  data,
  csv,
}: {
  data: TabTintoreriasData
  csv: Record<'scorecard' | 'volumen', string>
}) {
  const { scorecard, fallas } = data.performance

  const rollosRecibidos = scorecard.reduce((s, r) => s + r.rollosRecibidos, 0)
  const rollosSegunda = scorecard.reduce((s, r) => s + r.rollosSegunda, 0)
  const tasaGlobal =
    rollosRecibidos > 0 ? (rollosSegunda / rollosRecibidos) * 100 : 0

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Tintorerías con movimiento"
          value={scorecard.length}
          icon={Factory}
          detail="Con rollos recibidos en el período"
        />
        <KpiCard
          label="Rollos recibidos"
          value={rollosRecibidos}
          icon={Boxes}
          detail="Total en el período"
        />
        <KpiCard
          label="Tasa de fallas global"
          value={`${fmt1(tasaGlobal)}%`}
          icon={Percent}
          tone={tasaGlobal > 15 ? 'destructive' : tasaGlobal > 5 ? 'warning' : 'success'}
          detail="Rollos en segunda / recibidos"
        />
        <KpiCard
          label="Rollos en segunda"
          value={rollosSegunda}
          icon={Layers}
          tone={rollosSegunda > 0 ? 'destructive' : 'default'}
          detail="Calidad inferior"
        />
      </div>

      {/* Scorecard */}
      <ChartCard
        title="Scorecard por tintorería"
        description="Rinde ponderado por kilos, tasa de fallas, diferencia declarado vs propio y tiempo de ciclo (despacho → primera reserva)."
        csvHref={csv.scorecard}
        isEmpty={scorecard.length === 0}
        emptyMessage="Sin rollos recibidos de tintorerías en el período."
      >
        <ScorecardTable rows={scorecard} />
      </ChartCard>

      {/* Rinde + Fallas */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Rinde por tintorería"
          description="Metros por kilo, promedio ponderado. En verde la mejor, en rojo la peor."
          isEmpty={scorecard.every((r) => r.rindePonderado == null)}
          emptyMessage="Sin datos de rinde cargados."
        >
          <RindeTintoreriaChart data={scorecard} />
        </ChartCard>

        <ChartCard
          title="Fallas por tintorería"
          description="Rollos en segunda por categoría. Tonos naranja = teñido (mancha, color disparejo, tono); rojo = tejeduría (agujero, rotura)."
          isEmpty={fallas.every((f) =>
            (['Mancha', 'Color disparejo', 'Tono diferente', 'Agujero', 'Rotura de tejido', 'Otro'] as const).every(
              (c) => f[c] === 0
            )
          )}
          emptyMessage="Sin fallas registradas en el período."
        >
          <FallasChart data={fallas} />
        </ChartCard>
      </div>

      {/* Volumen (heredado) */}
      <SeccionTintorerias data={data.volumen} csvHref={csv.volumen} />
    </div>
  )
}

// ── Scorecard con semáforos ─────────────────────────────────

function celdaFallas(pct: number): string {
  if (pct > 15) return 'text-destructive'
  if (pct > 5) return 'text-warning'
  return 'text-success'
}

function celdaDif(pct: number | null): string {
  if (pct == null) return 'text-muted-foreground'
  const abs = Math.abs(pct)
  if (abs > 5) return 'text-destructive'
  if (abs > 2) return 'text-warning'
  return 'text-success'
}

function celdaCiclo(dias: number | null): string {
  if (dias == null) return 'text-muted-foreground'
  if (dias > 30) return 'text-destructive'
  if (dias > 15) return 'text-warning'
  return 'text-success'
}

function ScorecardTable({ rows }: { rows: ScorecardRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Tintorería</th>
            <th className="pb-2 pr-4 font-medium text-right">Recibidos</th>
            <th className="pb-2 pr-4 font-medium text-right">Rinde (m/kg)</th>
            <th className="pb-2 pr-4 font-medium text-right">Tasa fallas</th>
            <th className="pb-2 pr-4 font-medium text-right">Dif. decl. vs propio</th>
            <th className="pb-2 font-medium text-right">Ciclo (días)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tintoreria_id ?? 'sin'} className="border-t">
              <td className="py-2 pr-4 font-medium">{r.tintoreria}</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {r.rollosRecibidos}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {r.rindePonderado != null ? fmt1(r.rindePonderado) : '—'}
              </td>
              <td
                className={`py-2 pr-4 text-right tabular-nums font-medium ${celdaFallas(
                  r.tasaFallasPct
                )}`}
              >
                {fmt1(r.tasaFallasPct)}%
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  ({r.rollosSegunda})
                </span>
              </td>
              <td
                className={`py-2 pr-4 text-right tabular-nums font-medium ${celdaDif(
                  r.difPct
                )}`}
              >
                {r.difKg == null ? (
                  <span className="text-muted-foreground">sin dato</span>
                ) : (
                  <>
                    {r.difKg > 0 ? '+' : ''}
                    {fmtKg(r.difKg)} kg
                    {r.difPct != null && (
                      <span className="ml-1 text-[11px] font-normal">
                        ({r.difPct > 0 ? '+' : ''}
                        {fmt1(r.difPct)}%)
                      </span>
                    )}
                  </>
                )}
              </td>
              <td
                className={`py-2 text-right tabular-nums font-medium ${celdaCiclo(
                  r.tiempoCicloDias
                )}`}
              >
                {r.tiempoCicloDias != null ? fmt1(r.tiempoCicloDias) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
