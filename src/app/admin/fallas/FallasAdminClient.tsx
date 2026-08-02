'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Check, X, GripVertical } from 'lucide-react'
import {
  crearTipoFalla,
  actualizarTipoFalla,
  toggleTipoFalla,
} from './actions'

export type TipoFallaRow = {
  id: string
  nombre: string
  activo: boolean
  orden: number
}

export default function FallasAdminClient({
  tipos,
}: {
  tipos: TipoFallaRow[]
}) {
  const router = useRouter()
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [pending, startTransition] = useTransition()

  function crear() {
    if (!nuevoNombre.trim()) return
    startTransition(async () => {
      const res = await crearTipoFalla(nuevoNombre)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Categoría creada.')
      setNuevoNombre('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Nueva categoría de falla</h2>
        <div className="mt-3 flex gap-2">
          <input
            value={nuevoNombre}
            onChange={(e) => setNuevoNombre(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && crear()}
            className="flex-1 rounded-md border px-3 py-2 text-sm"
            placeholder="Ej. Marca de aguja"
            maxLength={80}
          />
          <button
            type="button"
            onClick={crear}
            disabled={pending || !nuevoNombre.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? 'Guardando...' : 'Crear'}
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
        <div className="border-b bg-zinc-50 px-4 py-3">
          <h2 className="text-sm font-semibold">
            Categorías ({tipos.length})
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Las categorías inactivas no aparecen en los formularios pero mantienen los registros históricos.
          </p>
        </div>
        <div className="divide-y">
          {tipos.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Sin categorías. Creá la primera.
            </p>
          ) : (
            tipos.map((tipo) => (
              <TipoFallaRow
                key={tipo.id}
                tipo={tipo}
                onRefresh={() => router.refresh()}
              />
            ))
          )}
        </div>
      </section>
    </div>
  )
}

function TipoFallaRow({
  tipo,
  onRefresh,
}: {
  tipo: TipoFallaRow
  onRefresh: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(tipo.nombre)
  const [pending, startTransition] = useTransition()

  function guardar() {
    if (!editValue.trim() || editValue.trim() === tipo.nombre) {
      setEditing(false)
      setEditValue(tipo.nombre)
      return
    }
    startTransition(async () => {
      const res = await actualizarTipoFalla(tipo.id, editValue)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Categoría actualizada.')
      setEditing(false)
      onRefresh()
    })
  }

  function toggle() {
    startTransition(async () => {
      const res = await toggleTipoFalla(tipo.id, !tipo.activo)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      onRefresh()
    })
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <GripVertical className="size-4 shrink-0 text-zinc-300" />

      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') guardar()
              if (e.key === 'Escape') {
                setEditing(false)
                setEditValue(tipo.nombre)
              }
            }}
            className="w-full rounded border px-2 py-1 text-sm"
            autoFocus
            maxLength={80}
          />
        ) : (
          <span className={`text-sm ${!tipo.activo ? 'text-muted-foreground line-through' : ''}`}>
            {tipo.nombre}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <button
              type="button"
              onClick={guardar}
              disabled={pending}
              className="rounded p-1.5 text-success hover:bg-success/10 disabled:opacity-50"
              title="Guardar"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setEditValue(tipo.nombre) }}
              className="rounded p-1.5 text-muted-foreground hover:bg-zinc-100"
              title="Cancelar"
            >
              <X className="size-4" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded p-1.5 text-muted-foreground hover:bg-zinc-100"
              title="Editar"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={toggle}
              disabled={pending}
              className={`rounded px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                tipo.activo
                  ? 'bg-success/10 text-success hover:bg-success/20'
                  : 'bg-zinc-100 text-muted-foreground hover:bg-zinc-200'
              }`}
            >
              {tipo.activo ? 'Activa' : 'Inactiva'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
