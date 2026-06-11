import { useEffect, useState } from 'react'
import { db } from '../lib/firebase'
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore'
import { useSession } from '../components/Layout'

export default function Stats() {
  const session = useSession()
  const restoId = session?.restoId
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('hoy')

  useEffect(() => {
    if (!restoId) return
    async function load() {
      setLoading(true)
      try {
        const col = collection(db, 'restaurantes', restoId, 'historial')
        let startISO = ''
        if (period === 'hoy') {
          const s = new Date(); s.setHours(0,0,0,0); startISO = s.toISOString()
        } else if (period === 'semana') {
          const s = new Date(); s.setDate(s.getDate()-7); startISO = s.toISOString()
        } else if (period === 'mes') {
          const s = new Date(); s.setDate(1); s.setHours(0,0,0,0); startISO = s.toISOString()
        }

        let snap
        try {
          snap = startISO
            ? await getDocs(query(col, where('completedAtISO','>=',startISO), orderBy('completedAtISO','desc'), limit(500)))
            : await getDocs(query(col, orderBy('completedAtISO','desc'), limit(500)))
        } catch {
          snap = await getDocs(query(col, limit(500)))
        }

        const orders = snap.docs.map(d => d.data())

        // Stats básicos
        const totalVentas   = orders.reduce((a,o) => a + (o.totalFinal || (o.items||[]).reduce((b,i) => b+i.price*i.qty, 0) + (o.extrasPrice||0)), 0)
        const totalPedidos  = orders.length
        const totalYape     = orders.reduce((a,o) => a + (o.pagoYape     || 0), 0)
        const totalEfectivo = orders.reduce((a,o) => a + (o.pagoEfectivo || 0), 0)

        // Por plato
        const byItem = {}
        orders.forEach(o => {
          (o.items||[]).forEach(item => {
            if (!byItem[item.name]) byItem[item.name] = { qty:0, total:0 }
            byItem[item.name].qty   += item.qty
            byItem[item.name].total += item.price * item.qty
          })
        })
        const topItems = Object.entries(byItem).sort(([,a],[,b]) => b.qty - a.qty).slice(0,10)

        // Por mesa
        const byMesa = {}
        orders.forEach(o => {
          if (!byMesa[o.mesa]) byMesa[o.mesa] = { count:0, total:0 }
          byMesa[o.mesa].count++
          byMesa[o.mesa].total += (o.totalFinal || (o.items||[]).reduce((a,i) => a+i.price*i.qty,0) + (o.extrasPrice||0))
        })
        const topMesas = Object.entries(byMesa).sort(([,a],[,b]) => b.total-a.total)

        // Por hora
        const byHour = {}
        orders.forEach(o => {
          if (o.completedAtISO) {
            const h = new Date(o.completedAtISO).getHours()
            byHour[h] = (byHour[h]||0) + 1
          }
        })
        const peakHour = Object.entries(byHour).sort(([,a],[,b]) => b-a)[0]

        // Por día (últimos 7 días)
        const byDay = {}
        orders.forEach(o => {
          if (o.completedAtISO) {
            const d = new Date(o.completedAtISO).toLocaleDateString('es-PE', { weekday:'short', day:'numeric' })
            if (!byDay[d]) byDay[d] = { count:0, total:0 }
            byDay[d].count++
            byDay[d].total += (o.totalFinal || (o.items||[]).reduce((a,i) => a+i.price*i.qty,0) + (o.extrasPrice||0))
          }
        })

        setData({ totalVentas, totalPedidos, totalYape, totalEfectivo, topItems, topMesas, peakHour, byHour, byDay })
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [period])

  const fmt12h = (h) => {
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h%12||12
    return `${h12}:00 ${ampm}`
  }

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-title">ESTADÍSTICAS</span>
      </div>

      {/* Period tabs */}
      <div style={{ display:'flex', gap:8, padding:'12px 16px',
        borderBottom:'1px solid var(--border)' }}>
        {[['hoy','Hoy'],['semana','7 días'],['mes','Este mes'],['todo','Todo']].map(([v,l]) => (
          <button key={v} onClick={() => setPeriod(v)} style={{
            background: period===v ? 'var(--accent)' : 'var(--card)',
            border:`1.5px solid ${period===v ? 'var(--accent)' : 'var(--border)'}`,
            color: period===v ? '#111' : 'var(--muted)',
            borderRadius:20, padding:'7px 14px', fontSize:12,
            fontWeight:700, cursor:'pointer', fontFamily:'var(--font)',
          }}>{l}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>Calculando...</div>
      ) : !data ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>Sin datos</div>
      ) : (
        <div style={{ padding:'14px 16px' }}>

          {/* KPIs */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
            {[
              ['💰','Total ventas',`S/${data.totalVentas.toFixed(2)}`,'var(--green)'],
              ['📋','Pedidos',data.totalPedidos,'var(--accent)'],
              ['🏆','Hora pico', data.peakHour ? fmt12h(parseInt(data.peakHour[0])) : '—','var(--blue)'],
              ['🍽','Ticket prom.',data.totalPedidos>0 ? `S/${(data.totalVentas/data.totalPedidos).toFixed(2)}` : '—','var(--yellow)'],
            ].map(([icon,label,value,color]) => (
              <div key={label} style={{ background:'var(--card)',
                border:'1.5px solid var(--border)', borderRadius:14, padding:'14px 16px' }}>
                <div style={{ fontSize:22, marginBottom:4 }}>{icon}</div>
                <div style={{ fontFamily:'var(--mono)', fontSize:20, fontWeight:500, color }}>{value}</div>
                <div style={{ fontSize:10, color:'var(--muted)', letterSpacing:2,
                  textTransform:'uppercase', marginTop:2 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Desglose pago */}
          {(data.totalYape > 0 || data.totalEfectivo > 0) && (
            <div style={{ marginBottom:20 }}>
              <div className="section-label">💳 Desglose de cobros</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div style={{ background:'var(--card)', border:'1.5px solid #6c47ff44',
                  borderRadius:14, padding:'14px 16px' }}>
                  <div style={{ fontSize:20, marginBottom:4 }}>📲</div>
                  <div style={{ fontFamily:'var(--mono)', fontSize:18, fontWeight:500,
                    color:'#a78bfa' }}>S/{data.totalYape.toFixed(2)}</div>
                  <div style={{ fontSize:10, color:'var(--muted)', letterSpacing:2,
                    textTransform:'uppercase', marginTop:2 }}>Yape</div>
                </div>
                <div style={{ background:'var(--card)', border:'1.5px solid var(--green)44',
                  borderRadius:14, padding:'14px 16px' }}>
                  <div style={{ fontSize:20, marginBottom:4 }}>💵</div>
                  <div style={{ fontFamily:'var(--mono)', fontSize:18, fontWeight:500,
                    color:'var(--green)' }}>S/{data.totalEfectivo.toFixed(2)}</div>
                  <div style={{ fontSize:10, color:'var(--muted)', letterSpacing:2,
                    textTransform:'uppercase', marginTop:2 }}>Efectivo</div>
                </div>
              </div>
              {/* Barra proporcional */}
              {data.totalVentas > 0 && (
                <div style={{ marginTop:10 }}>
                  <div style={{ height:8, background:'var(--border)', borderRadius:4, overflow:'hidden', display:'flex' }}>
                    <div style={{ height:'100%', background:'#6c47ff',
                      width:`${(data.totalYape/data.totalVentas)*100}%`, transition:'width .5s' }} />
                    <div style={{ height:'100%', background:'var(--green)',
                      width:`${(data.totalEfectivo/data.totalVentas)*100}%`, transition:'width .5s' }} />
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between',
                    fontSize:10, color:'var(--muted)', marginTop:4 }}>
                    <span>Yape {data.totalVentas>0?Math.round(data.totalYape/data.totalVentas*100):0}%</span>
                    <span>Efectivo {data.totalVentas>0?Math.round(data.totalEfectivo/data.totalVentas*100):0}%</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Ventas por día */}
          {Object.keys(data.byDay).length > 1 && (
            <div style={{ marginBottom:20 }}>
              <div className="section-label">📅 Ventas por día</div>
              <div style={{ background:'var(--card)', border:'1.5px solid var(--border)',
                borderRadius:14, padding:'14px 16px' }}>
                {(() => {
                  const dias = Object.entries(data.byDay)
                  const maxTotal = Math.max(...dias.map(([,d]) => d.total))
                  return dias.map(([dia, d]) => (
                    <div key={dia} style={{ marginBottom:10 }}>
                      <div style={{ display:'flex', justifyContent:'space-between',
                        fontSize:12, marginBottom:4 }}>
                        <span style={{ fontWeight:700, color:'var(--text)' }}>{dia}</span>
                        <span style={{ fontFamily:'var(--mono)', color:'var(--green)' }}>
                          S/{d.total.toFixed(2)} · {d.count} ped.
                        </span>
                      </div>
                      <div style={{ height:6, background:'var(--border)', borderRadius:3 }}>
                        <div style={{ height:'100%', borderRadius:3,
                          background:'linear-gradient(90deg,var(--green),var(--accent))',
                          width:`${(d.total/maxTotal)*100}%`, transition:'width .5s' }} />
                      </div>
                    </div>
                  ))
                })()}
              </div>
            </div>
          )}

          {/* Top platos */}
          <div style={{ marginBottom:20 }}>
            <div className="section-label">🏆 Platos más pedidos</div>
            {data.topItems.length === 0 ? (
              <div style={{ color:'var(--muted)', fontSize:13, padding:'10px 0' }}>Sin datos</div>
            ) : data.topItems.map(([name,d], i) => {
              const max = data.topItems[0][1].qty
              return (
                <div key={name} style={{ marginBottom:10 }}>
                  <div style={{ display:'flex', justifyContent:'space-between',
                    fontSize:13, marginBottom:4 }}>
                    <span style={{ fontWeight:700 }}>
                      <span style={{ color:'var(--accent)', marginRight:8, fontFamily:'var(--mono)' }}>
                        #{i+1}
                      </span>{name}
                    </span>
                    <span style={{ fontFamily:'var(--mono)', color:'var(--muted)' }}>
                      ×{d.qty} · S/{d.total.toFixed(0)}
                    </span>
                  </div>
                  <div style={{ height:6, background:'var(--border)', borderRadius:3 }}>
                    <div style={{ height:'100%', borderRadius:3,
                      background:`linear-gradient(90deg,var(--accent),var(--accent2))`,
                      width:`${(d.qty/max)*100}%`, transition:'width .5s' }} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Por mesa */}
          <div>
            <div className="section-label">🪑 Ventas por mesa</div>
            {data.topMesas.map(([mesa,d]) => (
              <div key={mesa} style={{ display:'flex', justifyContent:'space-between',
                alignItems:'center', background:'var(--card)',
                border:'1.5px solid var(--border)', borderRadius:12,
                padding:'10px 14px', marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ background:'linear-gradient(135deg,var(--accent),var(--accent2))',
                    color:'#111', width:32, height:32, borderRadius:8,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontFamily:'var(--mono)', fontWeight:700, fontSize:14 }}>{mesa}</div>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14 }}>Mesa {mesa}</div>
                    <div style={{ fontSize:11, color:'var(--muted)' }}>{d.count} pedido(s)</div>
                  </div>
                </div>
                <div style={{ fontFamily:'var(--mono)', color:'var(--green)',
                  fontSize:15, fontWeight:500 }}>S/{d.total.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
