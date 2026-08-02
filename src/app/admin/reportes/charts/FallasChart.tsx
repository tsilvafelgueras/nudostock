'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  FALLA_CATEGORIAS,
  FALLA_LABEL,
  type FallaCategoria,
  type FallasTintoreriaRow,
} from '../queries/tintorerias'

// Colores por categoría: familia naranja = fallas de teñido, familia roja =
// fallas de tejeduría, gris = otro. Así se separan visualmente los dos
// orígenes de la falla.
const FALLA_COLOR: Record<FallaCategoria, string> = {
  Mancha: '#f59e0b',
  'Color disparejo': '#fbbf24',
  'Tono diferente': '#fcd34d',
  Agujero: '#ef4444',
  'Rotura de tejido': '#f87171',
  Otro: '#94a3b8',
}

export default function FallasChart({
  data,
}: {
  data: FallasTintoreriaRow[]
}) {
  // Solo tintorerías con al menos una falla.
  const rows = data.filter((d) =>
    FALLA_CATEGORIAS.some((c) => d[c] > 0)
  )

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="tintoreria"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={{
            borderRadius: 8,
            border: '1px solid var(--border)',
            fontSize: 12,
          }}
        />
        <Legend
          formatter={(value) => (
            <span className="text-xs text-muted-foreground">
              {FALLA_LABEL[value as FallaCategoria] ?? value}
            </span>
          )}
        />
        {FALLA_CATEGORIAS.map((cat) => (
          <Bar
            key={cat}
            dataKey={cat}
            name={cat}
            stackId="fallas"
            fill={FALLA_COLOR[cat]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
