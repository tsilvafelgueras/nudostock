'use client'

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { FallaCategoriaRow } from '../queries/calidad'
import type { FallaCategoria } from '../queries/tintorerias'

// Misma familia de colores que el gráfico de fallas por tintorería:
// naranja = teñido, rojo = tejeduría, gris = otro.
const FALLA_COLOR: Record<FallaCategoria, string> = {
  Mancha: '#f59e0b',
  'Color disparejo': '#fbbf24',
  'Tono diferente': '#fcd34d',
  Agujero: '#ef4444',
  'Rotura de tejido': '#f87171',
  Otro: '#94a3b8',
}

export default function FallasDonaChart({
  data,
}: {
  data: FallaCategoriaRow[]
}) {
  const total = data.reduce((s, d) => s + d.rollos, 0)

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="rollos"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={2}
        >
          {data.map((d) => (
            <Cell key={d.categoria} fill={FALLA_COLOR[d.categoria]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, _name, item) => {
            const v = Number(value)
            const pct = total > 0 ? (v / total) * 100 : 0
            const label =
              (item?.payload as FallaCategoriaRow | undefined)?.label ?? ''
            return [`${v} rollos · ${pct.toFixed(1)}%`, label]
          }}
          contentStyle={{
            borderRadius: 8,
            border: '1px solid var(--border)',
            fontSize: 12,
          }}
        />
        <Legend
          formatter={(value) => (
            <span className="text-xs text-muted-foreground">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
