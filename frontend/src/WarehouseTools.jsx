import React, { useEffect, useRef, useState } from 'react';
import { DollarSign, Pencil, Save, Search, X } from 'lucide-react';
import { api } from './api.js';
import './warehouse.css';

export function WarehouseCategoryField({ value, options, onChange }) {
  const [creating, setCreating] = useState(Boolean(value && !options.includes(value)));
  return (
    <div className="prod-warehouse-category">
      <label>Categoria
        <select required value={creating ? '__new__' : value} onChange={(event) => {
          const isNew = event.target.value === '__new__';
          setCreating(isNew);
          onChange(isNew ? '' : event.target.value);
        }}>
          <option value="" disabled>Selecciona una categoria</option>
          {options.map((category) => <option key={category} value={category}>{category}</option>)}
          <option value="__new__">+ Crear nueva categoria</option>
        </select>
      </label>
      {creating && <label>Nombre de nueva categoria
        <input required maxLength={100} placeholder="Escribe la nueva categoria" value={value} onChange={(event) => onChange(event.target.value)} />
      </label>}
    </div>
  );
}

export function WarehousePhotoViewer({ photo, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
      previousFocus?.focus();
    };
  }, []);
  return (
    <div className="prod-warehouse-photo-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="prod-warehouse-photo-dialog" role="dialog" aria-modal="true" aria-label={`Foto de ${photo.name}`}>
        <header><strong>{photo.name}</strong><button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar foto"><X size={24} /></button></header>
        <img src={photo.photo_url} alt={photo.name} />
      </section>
    </div>
  );
}

export function WarehousePrices({ scope, canManage, setNotice }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [price, setPrice] = useState('');
  const priceRef = useRef(null);

  async function load() {
    setLoading(true);
    try { setRows(await api(scope('/producalza/warehouse-prices'))); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (editingId) {
      priceRef.current?.focus();
      priceRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [editingId]);

  function openPriceEditor(row) {
    setEditingId(row.id);
    setPrice(row.price === null ? '' : String(row.price));
    setError('');
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api(scope(`/producalza/warehouse-prices/${editingId}`), {
        method: 'PUT',
        body: JSON.stringify({ price })
      });
      setEditingId(null);
      await load();
      setNotice('Precio actualizado');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  const filtered = rows.filter((row) => [row.name, row.code, row.category, row.color]
    .some((value) => String(value || '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const money = (value) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(value);
  return (
    <div className="prod-warehouse-prices">
      <section className="prod-inventory-hero">
        <div><span>BODEGA PRODUCALZA</span><h2>Precios de materiales</h2><p>Estos son los mismos materiales de Bodega. Aqui solo registras su precio.</p></div>
      </section>
      {error && <div className="alert error" role="alert">{error}</div>}
      <label className="prod-warehouse-price-search"><Search size={18} /><input aria-label="Buscar material en precios" placeholder="Buscar material, codigo, categoria o color" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="prod-warehouse-price-list">
        {loading ? <div className="prod-empty">Cargando precios...</div> : filtered.map((row) => (
          <article key={row.id}>
            <div className="prod-warehouse-price-material">
              {row.photo_url ? <img src={row.photo_url} alt="" /> : <span className="prod-warehouse-price-placeholder"><DollarSign size={20} /></span>}
              <div><small>{row.category}{row.code ? ` · ${row.code}` : ''}</small><strong>{row.name}</strong>{row.color && <span>{row.color}</span>}</div>
            </div>
            <b className={`prod-warehouse-price-value${row.price === null ? ' empty' : ''}`}>{row.price === null ? 'Sin precio' : money(row.price)}</b>
            {canManage && <div className="prod-warehouse-price-actions">
              <button type="button" className="prod-secondary-button" aria-label={`Editar precio de ${row.name}`} disabled={saving} onClick={() => openPriceEditor(row)}><Pencil size={16} />{row.price === null ? 'Asignar precio' : 'Editar precio'}</button>
            </div>}
            {editingId === row.id && canManage && <form className="prod-warehouse-price-form" onSubmit={save}>
              <label>Precio de {row.name} (USD)<input ref={priceRef} required type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
              <div className="prod-form-actions"><button type="button" className="prod-secondary-button" disabled={saving} onClick={() => setEditingId(null)}>Cancelar</button><button className="prod-primary-button" disabled={saving}><Save size={17} />Guardar precio</button></div>
            </form>}
          </article>
        ))}
        {!loading && !filtered.length && <div className="prod-empty">{rows.length ? 'No hay materiales con esa busqueda.' : 'Todavia no hay materiales en Bodega.'}</div>}
      </div>
    </div>
  );
}
