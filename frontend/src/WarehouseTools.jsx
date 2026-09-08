import React, { useEffect, useRef, useState } from 'react';
import { DollarSign, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
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
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({ name: '', price: '' });
  const nameRef = useRef(null);

  async function load() {
    setLoading(true);
    try { setRows(await api(scope('/producalza/warehouse-prices'))); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (showForm) {
      nameRef.current?.focus();
      nameRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [showForm, editingId]);

  function openForm(row = null) {
    setEditingId(row?.id || null);
    setForm({ name: row?.name || '', price: row ? String(row.price) : '' });
    setError('');
    setShowForm(true);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api(scope(`/producalza/warehouse-prices${editingId ? '/' + editingId : ''}`), {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      setShowForm(false);
      await load();
      setNotice(editingId ? 'Precio actualizado' : 'Modelo agregado a precios');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function remove(row) {
    setSaving(true);
    setError('');
    try {
      await api(scope(`/producalza/warehouse-prices/${row.id}`), { method: 'DELETE' });
      setDeleteId(null);
      if (editingId === row.id) setShowForm(false);
      await load();
      setNotice('Modelo eliminado de precios');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  const filtered = rows.filter((row) => row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const money = (value) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(value);
  return (
    <div className="prod-warehouse-prices">
      <section className="prod-inventory-hero">
        <div><span>BODEGA PRODUCALZA</span><h2>Precios de modelos</h2><p>Consulta y actualiza el precio de cada modelo.</p></div>
        {canManage && <button className="prod-primary-button" type="button" disabled={saving} onClick={() => openForm()}><Plus size={18} />Agregar modelo</button>}
      </section>
      {error && <div className="alert error" role="alert">{error}</div>}
      {showForm && canManage && (
        <form className="prod-panel prod-warehouse-price-form" onSubmit={save}>
          <div className="prod-panel-title"><h3>{editingId ? 'Editar precio' : 'Agregar modelo'}</h3></div>
          <div className="prod-form-grid two">
            <label>Modelo<input ref={nameRef} required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Precio (USD)<input required type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
          </div>
          <div className="prod-form-actions">
            <button type="button" className="prod-secondary-button" disabled={saving} onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="prod-primary-button" disabled={saving}><Save size={17} />Guardar precio</button>
          </div>
        </form>
      )}
      <label className="prod-warehouse-price-search"><Search size={18} /><input aria-label="Buscar modelo en precios" placeholder="Buscar modelo" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="prod-warehouse-price-list">
        {loading ? <div className="prod-empty">Cargando precios...</div> : filtered.map((row) => (
          <article key={row.id}>
            <div className="prod-warehouse-price-name"><DollarSign size={20} /><strong>{row.name}</strong></div>
            <b className="prod-warehouse-price-value">{money(row.price)}</b>
            {canManage && <div className="prod-warehouse-price-actions">
              <button type="button" className="prod-secondary-button" aria-label={`Editar precio de ${row.name}`} disabled={saving} onClick={() => openForm(row)}><Pencil size={16} />Editar</button>
              <button type="button" className="prod-secondary-button" aria-label={`Eliminar precio de ${row.name}`} disabled={saving} onClick={() => setDeleteId(row.id)}><Trash2 size={16} />Eliminar</button>
            </div>}
            {deleteId === row.id && <div className="prod-warehouse-price-delete">
              <span>Eliminar {row.name} del catalogo de precios?</span>
              <button type="button" disabled={saving} onClick={() => setDeleteId(null)}>Cancelar</button>
              <button type="button" disabled={saving} onClick={() => remove(row)}>Si, eliminar</button>
            </div>}
          </article>
        ))}
        {!loading && !filtered.length && <div className="prod-empty">{rows.length ? 'No hay modelos con esa busqueda.' : 'Todavia no hay precios registrados.'}</div>}
      </div>
    </div>
  );
}
