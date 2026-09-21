import React, { useState, useEffect, useCallback, useMemo } from "react";

/* ---------------------------------------------------------------------
   FlowQR — prototipo funcional (panel jefe + app trabajador)
   Datos persistidos en window.storage (compartidos), no hay backend real.
--------------------------------------------------------------------- */

const STORAGE_KEY = "flowqr_lotes_v1";
const IDENTITY_KEY = "flowqr_worker_identity";
const MI_EMPRESA_KEY = "flowqr_mi_empresa"; // qué empresa es este dispositivo/navegador (personal)
const EMPRESAS_KEY = "flowqr_empresas"; // registro global de empresas dadas de alta (compartido)
const INVITACIONES_KEY = "flowqr_invitaciones"; // códigos generados por el propietario (compartido)
const ROLE_INVITACIONES_KEY = "flowqr_invitaciones_rol"; // códigos que el jefe genera para su equipo, ligados a un rol fijo (compartido)
// El código de propietario ya NO vive aquí — se valida en el servidor (ver src/lib/storage.js y owner-security.sql).

function lotesKeyFor(empresaId) {
  return `flowqr_lotes_${empresaId}`;
}
function maquinasKeyFor(empresaId) {
  return `flowqr_maquinas_${empresaId}`;
}
function configKeyFor(empresaId) {
  return `flowqr_config_${empresaId}`;
}
function defaultConfig() {
  return {
    metas: { "Zona 1": 300, "Zona 2": 300, "Zona 3": 300 },
    costosActivo: false,
    tarifaHoraManoObra: 60,
  };
}
const ESTADOS_MAQUINA = ["operando", "paro", "mantenimiento", "fuera_servicio"];
const ESTADO_MAQUINA_LABEL = {
  operando: "Operando",
  paro: "En paro",
  mantenimiento: "En mantenimiento",
  fuera_servicio: "Fuera de servicio",
};
function generarCodigoInvitacion() {
  return "FQR-" + Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

const PLANTILLAS = {
  Calzado: ["Corte", "Pespunte", "Montado", "Suela", "Acabado", "Empaque"],
  Textil: ["Corte", "Costura", "Acabado", "Empaque"],
  General: ["Preparación", "Producción", "Calidad", "Empaque"],
};

const INSTRUCCIONES = {
  Corte: "Corta las piezas según el molde del modelo. Verifica color y cantidad antes de pasar al siguiente proceso.",
  Pespunte: "Une el corte delantero, cose el lateral y revisa la costura antes de continuar.",
  Costura: "Une las piezas cortadas siguiendo la ficha técnica. Revisa tensión de hilo y puntada.",
  Montado: "Monta la pieza sobre la horma. Verifica alineación y ajuste antes de pasar a la siguiente etapa.",
  Suela: "Aplica y prensa la suela. Verifica adhesión completa en todo el contorno.",
  Acabado: "Limpieza final, retirar excedentes de pegamento o hilos sueltos. Revisión visual completa.",
  Empaque: "Empaca en la caja correspondiente con talla y modelo visibles. Sella y etiqueta.",
  Preparación: "Reúne materiales e insumos necesarios para el lote antes de iniciar producción.",
  Producción: "Ejecuta el proceso principal de producción según la ficha del modelo.",
  Calidad: "Inspecciona el lote contra la muestra de referencia. Registra cualquier defecto encontrado.",
};

const MOTIVOS_DEFECTO = ["Costura abierta", "Mancha", "Talla incorrecta", "Material defectuoso", "Otro"];
const TIPOS_PROBLEMA = ["Falta material", "Máquina descompuesta", "Pieza defectuosa de proveedor", "Instrucción confusa", "Otro"];
const ZONAS = ["Zona 1", "Zona 2", "Zona 3"];
const WORKERS_POR_ZONA = {
  "Zona 1": ["Trabajador 04", "Trabajador 11", "Trabajador 08"],
  "Zona 2": ["Trabajador 02", "Trabajador 15"],
  "Zona 3": ["Trabajador 07", "Trabajador 09", "Trabajador 03"],
};
const UMBRAL_HORAS_SIN_REPORTE = 4; // horas sin actividad para marcar un lote como "sin reportar"

function uid() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}
function nowISO() {
  return new Date().toISOString();
}
function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}
function horasDesde(iso) {
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}
function formatDuracion(horasTotales) {
  if (horasTotales == null) return "—";
  if (horasTotales < 1) return Math.max(1, Math.round(horasTotales * 60)) + " min";
  const dias = Math.floor(horasTotales / 24);
  const horas = Math.round(horasTotales % 24);
  if (dias > 0) return `${dias}d ${horas}h`;
  return `${horas}h`;
}
function produccionHoyPorZona(lotes, zona) {
  const hoy = new Date().toISOString().slice(0, 10);
  return lotes
    .filter((l) => l.zona === zona)
    .reduce((sum, l) => {
      const avanzoHoy = l.historial.some((h) => h.ts.slice(0, 10) === hoy && (h.accion === "Terminé" || h.accion.startsWith("Entregado")));
      return sum + (avanzoHoy ? l.cantidad : 0);
    }, 0);
}

function resizeImageFile(file, maxW = 480, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagen inválida"));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function seedLotes() {
  const hoy = new Date();
  const enDiez = new Date(hoy.getTime() + 10 * 86400000).toISOString().slice(0, 10);
  const ayer = new Date(hoy.getTime() - 86400000).toISOString().slice(0, 10);
  const hace3 = new Date(hoy.getTime() - 3 * 86400000).toISOString();
  const hace2 = new Date(hoy.getTime() - 2 * 86400000).toISOString();
  const hace1 = new Date(hoy.getTime() - 1 * 3600000).toISOString();
  const hace5d = new Date(hoy.getTime() - 5 * 86400000).toISOString();
  const hace4d = new Date(hoy.getTime() - 4 * 86400000).toISOString();

  return [
    {
      id: "A-2847",
      producto: "Tenis X-500",
      color: "Negro",
      talla: "25–29",
      cantidad: 120,
      cliente: "Distribuidora León",
      fechaEntrega: enDiez,
      prioridad: "Alta",
      plantilla: "Calzado",
      zona: "Zona 1",
      creadoEn: hace5d,
      trabajadorAsignado: "Trabajador 11",
      empresaDestino: "",
      terminadoEn: null,
      etapas: PLANTILLAS.Calzado,
      etapaIndex: 1,
      estado: "en_proceso",
      enProgreso: false,
      historial: [
        { ts: hace3, etapa: "Corte", accion: "Terminé", por: "Trabajador 04" },
        { ts: hace2, etapa: "Pespunte", accion: "Inició", por: "Trabajador 11" },
      ],
      defectos: [{ ts: hace1, etapa: "Pespunte", motivo: "Costura abierta", cantidad: 3, estado: "pendiente" }],
      problemas: [],
    },
    {
      id: "B-1190",
      producto: "Bota Trail Z",
      color: "Café",
      talla: "26–30",
      cantidad: 80,
      cliente: "Calzado del Bajío",
      fechaEntrega: ayer,
      prioridad: "Alta",
      plantilla: "Calzado",
      zona: "Zona 2",
      creadoEn: hace5d,
      trabajadorAsignado: "Trabajador 02",
      empresaDestino: "",
      terminadoEn: null,
      etapas: PLANTILLAS.Calzado,
      etapaIndex: 2,
      estado: "en_proceso",
      enProgreso: false,
      historial: [{ ts: hace3, etapa: "Montado", accion: "Inició", por: "Trabajador 02" }],
      defectos: [],
      problemas: [{ ts: hace1, etapa: "Montado", tipo: "Falta material", activo: true }],
    },
    {
      id: "C-0552",
      producto: "Playera Deportiva",
      color: "Azul marino",
      talla: "S–XL",
      cantidad: 300,
      cliente: "Uniformes MX",
      fechaEntrega: enDiez,
      prioridad: "Media",
      plantilla: "Textil",
      zona: "Zona 3",
      creadoEn: hace4d,
      trabajadorAsignado: "Trabajador 07",
      empresaDestino: "Uniformes MX — Corporativo",
      terminadoEn: hace1,
      etapas: PLANTILLAS.Textil,
      etapaIndex: 4,
      estado: "terminado",
      enProgreso: false,
      historial: [{ ts: hace3, etapa: "Empaque", accion: "Terminé", por: "Trabajador 07" }],
      defectos: [],
      problemas: [],
    },
  ];
}

/* --------------------------- iconos mínimos --------------------------- */
const Icon = {
  Scan: (p) => (
    <svg viewBox="0 0 24 24" width={p.s || 20} height={p.s || 20} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M4 12h16" />
    </svg>
  ),
  Check: (p) => (
    <svg viewBox="0 0 24 24" width={p.s || 20} height={p.s || 20} fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M4 12l5 5L20 6" />
    </svg>
  ),
  Alert: (p) => (
    <svg viewBox="0 0 24 24" width={p.s || 20} height={p.s || 20} fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v4" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </svg>
  ),
  Camera: (p) => (
    <svg viewBox="0 0 24 24" width={p.s || 20} height={p.s || 20} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
      <circle cx="12" cy="13.5" r="3.2" />
    </svg>
  ),
  Play: (p) => (
    <svg viewBox="0 0 24 24" width={p.s || 20} height={p.s || 20} fill="currentColor">
      <path d="M6 4l14 8-14 8V4z" />
    </svg>
  ),
};

/* ------------------------------ App root ------------------------------ */
export default function App() {
  const [booting, setBooting] = useState(true);
  const [miEmpresa, setMiEmpresa] = useState(null); // { id, nombre }
  const [suspendida, setSuspendida] = useState(false);
  const [ownerMode, setOwnerMode] = useState(false);
  const [lotes, setLotes] = useState(null);
  const [maquinas, setMaquinas] = useState([]);
  const [config, setConfig] = useState(defaultConfig());
  const [role, setRole] = useState("admin");
  const [supervisorZona, setSupervisorZona] = useState(ZONAS[0]);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);

  // Paso 1: al abrir, revisa si este dispositivo ya pertenece a una empresa registrada
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(MI_EMPRESA_KEY, false);
        if (res && res.value) {
          const emp = JSON.parse(res.value);
          setMiEmpresa(emp);
          if (emp.rolFijo === "supervisor" || emp.rolFijo === "worker") setRole(emp.rolFijo);
        }
      } catch (e) {
        // sin empresa registrada todavía en este dispositivo
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Paso 1.5: revisa contra el registro del propietario si esa empresa sigue activa
  useEffect(() => {
    if (!miEmpresa) return;
    (async () => {
      try {
        const res = await window.storage.get(EMPRESAS_KEY, true);
        const empresas = res && res.value ? JSON.parse(res.value) : [];
        const actual = empresas.find((e) => e.id === miEmpresa.id);
        setSuspendida(actual ? actual.activa === false : false);
      } catch (e) {
        setSuspendida(false);
      }
    })();
  }, [miEmpresa]);

  // Paso 2: una vez que sabemos la empresa, carga (o crea) sus lotes de forma aislada
  useEffect(() => {
    if (!miEmpresa) return;
    (async () => {
      setLoading(true);
      const key = lotesKeyFor(miEmpresa.id);
      try {
        const res = await window.storage.get(key, true);
        if (res && res.value) {
          setLotes(JSON.parse(res.value));
        } else {
          const seed = seedLotes().map((l) => ({ ...l, empresaId: miEmpresa.id }));
          setLotes(seed);
          await window.storage.set(key, JSON.stringify(seed), true);
        }
      } catch (e) {
        setLotes(seedLotes().map((l) => ({ ...l, empresaId: miEmpresa.id })));
      } finally {
        setLoading(false);
      }
    })();
  }, [miEmpresa]);

  // Paso 2.5: carga máquinas y configuración (metas, costos) de esta empresa
  useEffect(() => {
    if (!miEmpresa) return;
    (async () => {
      try {
        const res = await window.storage.get(maquinasKeyFor(miEmpresa.id), true);
        setMaquinas(res && res.value ? JSON.parse(res.value) : []);
      } catch (e) {
        setMaquinas([]);
      }
      try {
        const res = await window.storage.get(configKeyFor(miEmpresa.id), true);
        setConfig(res && res.value ? { ...defaultConfig(), ...JSON.parse(res.value) } : defaultConfig());
      } catch (e) {
        setConfig(defaultConfig());
      }
    })();
  }, [miEmpresa]);

  const persistMaquinas = useCallback(
    async (next) => {
      if (!miEmpresa) return;
      setMaquinas(next);
      try {
        await window.storage.set(maquinasKeyFor(miEmpresa.id), JSON.stringify(next), true);
      } catch (e) {
        // si falla, la sesión sigue funcionando solo con el estado en memoria
      }
    },
    [miEmpresa]
  );

  const addMaquina = useCallback(
    (maquina) => {
      setMaquinas((prev) => {
        const next = [maquina, ...prev];
        persistMaquinas(next);
        return next;
      });
    },
    [persistMaquinas]
  );

  const updateMaquina = useCallback(
    (id, updater) => {
      setMaquinas((prev) => {
        const next = prev.map((m) => (m.id === id ? updater(m) : m));
        persistMaquinas(next);
        return next;
      });
    },
    [persistMaquinas]
  );

  const updateConfig = useCallback(
    async (patch) => {
      if (!miEmpresa) return;
      setConfig((prev) => {
        const next = { ...prev, ...patch };
        window.storage.set(configKeyFor(miEmpresa.id), JSON.stringify(next), true).catch(() => {});
        return next;
      });
    },
    [miEmpresa]
  );

  const persist = useCallback(
    async (next) => {
      if (!miEmpresa) return;
      setLotes(next);
      try {
        const res = await window.storage.set(lotesKeyFor(miEmpresa.id), JSON.stringify(next), true);
        if (!res) setSaveError(true);
        else setSaveError(false);
      } catch (e) {
        setSaveError(true);
      }
    },
    [miEmpresa]
  );

  const updateLote = useCallback(
    (id, updater) => {
      setLotes((prev) => {
        const next = prev.map((l) => (l.id === id ? updater(l) : l));
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const addLote = useCallback(
    (lote) => {
      setLotes((prev) => {
        const next = [{ ...lote, empresaId: miEmpresa ? miEmpresa.id : null }, ...prev];
        persist(next);
        return next;
      });
    },
    [persist, miEmpresa]
  );

  async function registrarEmpresa(nombre, codigo) {
    const invRes = await window.storage.get(INVITACIONES_KEY, true).catch(() => null);
    const invitaciones = invRes && invRes.value ? JSON.parse(invRes.value) : [];
    const idx = invitaciones.findIndex((i) => i.codigo === codigo.trim().toUpperCase());
    if (idx === -1) return { error: "Código de invitación no válido." };
    if (invitaciones[idx].usado) return { error: "Este código ya fue usado por otra empresa." };

    const empresa = { id: uid() + uid(), nombre, creadaEn: nowISO(), activa: true };
    invitaciones[idx] = { ...invitaciones[idx], usado: true, empresaId: empresa.id, empresaNombre: nombre, usadoEn: nowISO() };

    const empRes = await window.storage.get(EMPRESAS_KEY, true).catch(() => null);
    const empresas = empRes && empRes.value ? JSON.parse(empRes.value) : [];
    empresas.push(empresa);

    await window.storage.set(INVITACIONES_KEY, JSON.stringify(invitaciones), true);
    await window.storage.set(EMPRESAS_KEY, JSON.stringify(empresas), true);
    await window.storage.set(MI_EMPRESA_KEY, JSON.stringify({ ...empresa, rolFijo: null }), false);

    setMiEmpresa({ ...empresa, rolFijo: null });
    return { ok: true };
  }

  async function unirseConCodigoRol(codigo) {
    const res = await window.storage.get(ROLE_INVITACIONES_KEY, true).catch(() => null);
    const codigos = res && res.value ? JSON.parse(res.value) : [];
    const idx = codigos.findIndex((c) => c.codigo === codigo.trim().toUpperCase());
    if (idx === -1) return { error: "Código no válido." };
    if (codigos[idx].usado) return { error: "Este código ya fue usado." };

    const encontrado = codigos[idx];
    codigos[idx] = { ...encontrado, usado: true, usadoEn: nowISO() };
    await window.storage.set(ROLE_INVITACIONES_KEY, JSON.stringify(codigos), true);

    const miEmp = { id: encontrado.empresaId, nombre: encontrado.empresaNombre, rolFijo: encontrado.rol };
    await window.storage.set(MI_EMPRESA_KEY, JSON.stringify(miEmp), false);

    setMiEmpresa(miEmp);
    setRole(encontrado.rol);
    return { ok: true };
  }

  function salirDeEmpresa() {
    setMiEmpresa(null);
    setLotes(null);
    window.storage.set(MI_EMPRESA_KEY, "", false).catch(() => {});
  }

  if (booting) {
    return (
      <div className="fq-root">
        <Style />
        <div className="fq-loading">Cargando FlowQR…</div>
      </div>
    );
  }

  if (ownerMode) {
    return (
      <div className="fq-root">
        <Style />
        <OwnerPanel onExit={() => setOwnerMode(false)} />
      </div>
    );
  }

  if (!miEmpresa) {
    return (
      <div className="fq-root">
        <Style />
        <RegistroEmpresaScreen onRegistrar={registrarEmpresa} onOwnerAccess={() => setOwnerMode(true)} onUnirseRol={unirseConCodigoRol} />
      </div>
    );
  }

  if (suspendida) {
    return (
      <div className="fq-root">
        <Style />
        <div className="fq-register-wrap">
          <div className="fq-register-card fq-suspended-card">
            <div className="fq-brand" style={{ marginBottom: 18 }}>
              <span className="fq-brand-mark">FQ</span>
              <div className="fq-brand-text">
                <span className="fq-brand-name" style={{ color: "var(--graphite)" }}>FlowQR</span>
                <span className="fq-brand-sub" style={{ color: "#6b7280" }}>{miEmpresa.nombre}</span>
              </div>
            </div>
            <h2 className="fq-register-title">Acceso suspendido</h2>
            <p className="fq-register-sub">
              El acceso de <strong>{miEmpresa.nombre}</strong> a FlowQR fue pausado por quien les dio el servicio.
              Contáctalo para reactivarlo.
            </p>
            <button className="fq-btn fq-btn-ghost fq-btn-huge" style={{ marginTop: 18 }} onClick={salirDeEmpresa}>
              Registrar otra empresa
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fq-root">
      <Style />
      <TopBar role={role} setRole={setRole} saveError={saveError} empresa={miEmpresa} onSalir={salirDeEmpresa} rolFijo={miEmpresa && miEmpresa.rolFijo} />
      <main className="fq-main">
        {loading || !lotes ? (
          <div className="fq-loading">Cargando planta…</div>
        ) : role === "admin" ? (
          <AdminPanel
            lotes={lotes}
            updateLote={updateLote}
            addLote={addLote}
            maquinas={maquinas}
            addMaquina={addMaquina}
            updateMaquina={updateMaquina}
            config={config}
            updateConfig={updateConfig}
            empresaId={miEmpresa.id}
            empresaNombre={miEmpresa.nombre}
          />
        ) : role === "supervisor" ? (
          <SupervisorPanel
            lotes={lotes}
            updateLote={updateLote}
            zona={supervisorZona}
            setZona={setSupervisorZona}
            maquinas={maquinas}
            updateMaquina={updateMaquina}
            config={config}
          />
        ) : (
          <WorkerApp lotes={lotes} updateLote={updateLote} maquinas={maquinas} />
        )}
      </main>
    </div>
  );
}

/* ------------------------- registro de empresa -------------------------- */
function RegistroEmpresaScreen({ onRegistrar, onOwnerAccess, onUnirseRol }) {
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mostrarOwner, setMostrarOwner] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [ownerError, setOwnerError] = useState("");
  const [mostrarEquipo, setMostrarEquipo] = useState(false);
  const [codigoEquipo, setCodigoEquipo] = useState("");
  const [errorEquipo, setErrorEquipo] = useState("");
  const [enviandoEquipo, setEnviandoEquipo] = useState(false);

  async function submit() {
    if (!nombre.trim() || !codigo.trim()) return;
    setEnviando(true);
    setError("");
    const res = await onRegistrar(nombre.trim(), codigo);
    setEnviando(false);
    if (res && res.error) setError(res.error);
  }

  async function submitEquipo() {
    if (!codigoEquipo.trim()) return;
    setEnviandoEquipo(true);
    setErrorEquipo("");
    const res = await onUnirseRol(codigoEquipo);
    setEnviandoEquipo(false);
    if (res && res.error) setErrorEquipo(res.error);
  }

  async function intentarOwner() {
    setOwnerError("");
    try {
      let ok;
      if (typeof window !== "undefined" && window.checkOwnerPasscode) {
        // Producción real: el código nunca viaja al navegador, se valida en Supabase.
        ok = await window.checkOwnerPasscode(passcode.trim());
      } else {
        // Solo dentro de la vista previa de Claude (sin Supabase real conectado).
        ok = passcode === "202622";
      }
      if (ok) onOwnerAccess();
      else setOwnerError("Código de propietario incorrecto.");
    } catch (e) {
      setOwnerError("No se pudo verificar el código. Intenta de nuevo.");
    }
  }

  return (
    <div className="fq-register-wrap">
      <div className="fq-register-card">
        <div className="fq-brand" style={{ marginBottom: 18 }}>
          <span className="fq-brand-mark">FQ</span>
          <div className="fq-brand-text">
            <span className="fq-brand-name" style={{ color: "var(--graphite)" }}>FlowQR</span>
            <span className="fq-brand-sub" style={{ color: "#6b7280" }}>control de producción</span>
          </div>
        </div>

        <h2 className="fq-register-title">Registra tu empresa</h2>
        <p className="fq-register-sub">
          Ingresa el nombre de tu fábrica y el código de invitación que te dio quien te compartió FlowQR.
        </p>

        <label className="fq-field" style={{ marginTop: 14 }}>
          <span>Nombre de tu empresa</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Calzado del Bajío" />
        </label>
        <label className="fq-field" style={{ marginTop: 10 }}>
          <span>Código de invitación</span>
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Ej. FQR-AB12-CD34"
            style={{ fontFamily: "'IBM Plex Mono',monospace", letterSpacing: "0.04em" }}
          />
        </label>

        {error && <p className="fq-register-error">{error}</p>}

        <button
          className="fq-btn fq-btn-primary fq-btn-huge"
          style={{ marginTop: 16 }}
          disabled={!nombre.trim() || !codigo.trim() || enviando}
          onClick={submit}
        >
          {enviando ? "Registrando…" : "Registrar mi empresa"}
        </button>

        <button className="fq-register-owner-link" onClick={() => setMostrarEquipo((v) => !v)}>
          ¿Ya tu empresa está registrada? Unirme como Supervisor o Trabajador
        </button>

        {mostrarEquipo && (
          <div className="fq-register-owner-box" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <input
              value={codigoEquipo}
              onChange={(e) => setCodigoEquipo(e.target.value)}
              placeholder="Código que te dio tu jefe"
              style={{ fontFamily: "'IBM Plex Mono',monospace" }}
            />
            <button
              className="fq-btn fq-btn-primary"
              style={{ marginTop: 8 }}
              disabled={!codigoEquipo.trim() || enviandoEquipo}
              onClick={submitEquipo}
            >
              {enviandoEquipo ? "Entrando…" : "Unirme"}
            </button>
            {errorEquipo && <p className="fq-register-error" style={{ marginTop: 6 }}>{errorEquipo}</p>}
          </div>
        )}

        <button className="fq-register-owner-link" onClick={() => setMostrarOwner((v) => !v)}>
          ¿Eres el propietario de FlowQR?
        </button>

        {mostrarOwner && (
          <div className="fq-register-owner-box">
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Código de propietario"
            />
            <button className="fq-btn fq-btn-tiny" onClick={intentarOwner}>Entrar</button>
            {ownerError && <p className="fq-register-error" style={{ marginTop: 6 }}>{ownerError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- panel propietario -------------------------- */
function OwnerPanel({ onExit }) {
  const [empresas, setEmpresas] = useState([]);
  const [invitaciones, setInvitaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);

  async function cargar() {
    setLoading(true);
    try {
      const [empRes, invRes] = await Promise.all([
        window.storage.get(EMPRESAS_KEY, true).catch(() => null),
        window.storage.get(INVITACIONES_KEY, true).catch(() => null),
      ]);
      setEmpresas(empRes && empRes.value ? JSON.parse(empRes.value) : []);
      setInvitaciones(invRes && invRes.value ? JSON.parse(invRes.value) : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function generarCodigo() {
    setGenerando(true);
    try {
      const res = await window.storage.get(INVITACIONES_KEY, true).catch(() => null);
      const actuales = res && res.value ? JSON.parse(res.value) : [];
      const nuevo = { codigo: generarCodigoInvitacion(), creadaEn: nowISO(), usado: false };
      const next = [nuevo, ...actuales];
      await window.storage.set(INVITACIONES_KEY, JSON.stringify(next), true);
      setInvitaciones(next);
    } finally {
      setGenerando(false);
    }
  }

  async function toggleActiva(empresaId) {
    const res = await window.storage.get(EMPRESAS_KEY, true).catch(() => null);
    const actuales = res && res.value ? JSON.parse(res.value) : [];
    const next = actuales.map((e) => (e.id === empresaId ? { ...e, activa: e.activa === false ? true : false } : e));
    await window.storage.set(EMPRESAS_KEY, JSON.stringify(next), true);
    setEmpresas(next);
  }

  const pendientes = invitaciones.filter((i) => !i.usado);
  const usados = invitaciones.filter((i) => i.usado);

  return (
    <div className="fq-admin">
      <div className="fq-topbar" style={{ margin: "-16px -16px 16px", borderRadius: 0 }}>
        <div className="fq-brand">
          <span className="fq-brand-mark">FQ</span>
          <div className="fq-brand-text">
            <span className="fq-brand-name">FlowQR</span>
            <span className="fq-brand-sub">panel del propietario</span>
          </div>
        </div>
        <button className="fq-btn fq-btn-tiny" onClick={onExit}>Salir</button>
      </div>

      <section className="fq-stats">
        <StatTile label="Empresas registradas" value={empresas.length} tone="steel" />
        <StatTile label="Códigos sin usar" value={pendientes.length} tone="amber" />
        <StatTile label="Códigos usados" value={usados.length} tone="steel" />
      </section>

      <section className="fq-admin-toolbar">
        <h2 className="fq-section-title">Códigos de invitación</h2>
        <button className="fq-btn fq-btn-primary" onClick={generarCodigo} disabled={generando}>
          {generando ? "Generando…" : "+ Generar código"}
        </button>
      </section>
      <p className="fq-form-hint" style={{ marginBottom: 12 }}>
        Comparte un código con cada fábrica nueva. Es de un solo uso: en cuanto una empresa lo registra, deja de
        funcionar — esa empresa no puede volver a usarlo ni pasárselo a otro negocio.
      </p>

      {loading ? (
        <p className="fq-empty">Cargando…</p>
      ) : (
        <>
          {pendientes.length > 0 && (
            <div className="fq-invite-list">
              {pendientes.map((i) => (
                <div className="fq-invite-row" key={i.codigo}>
                  <span className="fq-invite-code">{i.codigo}</span>
                  <span className="fq-flag fq-flag-amber">Sin usar</span>
                </div>
              ))}
            </div>
          )}

          <h2 className="fq-section-title" style={{ marginTop: 22 }}>Empresas registradas</h2>
          {empresas.length === 0 ? (
            <p className="fq-empty">Todavía no se ha registrado ninguna empresa.</p>
          ) : (
            <div className="fq-invite-list">
              {empresas.map((e) => (
                <div className="fq-invite-row" key={e.id}>
                  <div>
                    <strong>{e.nombre}</strong>
                    <div className="fq-pending-time">Registrada: {fmtTime(e.creadaEn)}</div>
                  </div>
                  <div className="fq-empresa-actions">
                    <span className={"fq-flag " + (e.activa === false ? "fq-flag-red" : "fq-flag-green")}>
                      {e.activa === false ? "Suspendida" : "Activa"}
                    </span>
                    <button
                      className={"fq-btn fq-btn-tiny" + (e.activa === false ? " fq-btn-success" : " fq-btn-reject")}
                      onClick={() => toggleActiva(e.id)}
                    >
                      {e.activa === false ? "Reactivar" : "Suspender"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------ Top bar -------------------------------- */
function TopBar({ role, setRole, saveError, empresa, onSalir, rolFijo }) {
  const ROLE_LABEL = { admin: "Jefe", supervisor: "Supervisor", worker: "Trabajador" };
  return (
    <header className="fq-topbar">
      <div className="fq-brand">
        <span className="fq-brand-mark">FQ</span>
        <div className="fq-brand-text">
          <span className="fq-brand-name">FlowQR</span>
          <span className="fq-brand-sub">{empresa ? empresa.nombre : "control de producción"}</span>
        </div>
      </div>
      {rolFijo ? (
        <span className="fq-role-locked">{ROLE_LABEL[rolFijo]}</span>
      ) : (
        <div className="fq-switch" role="tablist" aria-label="Cambiar vista">
          <button
            role="tab"
            aria-selected={role === "admin"}
            className={"fq-switch-btn" + (role === "admin" ? " is-active" : "")}
            onClick={() => setRole("admin")}
          >
            Jefe
          </button>
          <button
            role="tab"
            aria-selected={role === "supervisor"}
            className={"fq-switch-btn" + (role === "supervisor" ? " is-active" : "")}
            onClick={() => setRole("supervisor")}
          >
            Supervisor
          </button>
          <button
            role="tab"
            aria-selected={role === "worker"}
            className={"fq-switch-btn" + (role === "worker" ? " is-active" : "")}
            onClick={() => setRole("worker")}
          >
            Trabajador
          </button>
        </div>
      )}
      {saveError && <span className="fq-save-warn">Sin conexión — cambios no guardados</span>}
      {onSalir && (
        <button className="fq-topbar-exit" onClick={onSalir} title="Salir de esta empresa">
          ⎋
        </button>
      )}
    </header>
  );
}

/* ============================== ADMIN ================================== */
function AdminPanel({ lotes, updateLote, addLote, maquinas, addMaquina, updateMaquina, config, updateConfig, empresaId, empresaNombre }) {
  const [showForm, setShowForm] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showEquipo, setShowEquipo] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [vista, setVista] = useState("lotes");

  const today = new Date().toISOString().slice(0, 10);
  const stats = useMemo(() => {
    const enProceso = lotes.filter((l) => l.estado === "en_proceso").length;
    const atrasados = lotes.filter((l) => l.estado !== "terminado" && l.fechaEntrega < today).length;
    const defectosHoy = lotes.reduce((acc, l) => acc + l.defectos.filter((d) => d.ts.slice(0, 10) === today).length, 0);
    const problemasActivos = lotes.reduce((acc, l) => acc + l.problemas.filter((p) => p.activo).length, 0);
    return { enProceso, atrasados, defectosHoy, problemasActivos, total: lotes.length };
  }, [lotes, today]);

  const alertasMaquina = maquinas.filter((m) => m.estado === "paro" || m.horasUso >= m.umbralHoras).length;
  const detailLote = lotes.find((l) => l.id === detailId) || null;

  return (
    <div className="fq-admin">
      <div className="fq-subtabs">
        <button className={"fq-subtab" + (vista === "lotes" ? " is-active" : "")} onClick={() => setVista("lotes")}>
          Lotes
        </button>
        <button className={"fq-subtab" + (vista === "pendientes" ? " is-active" : "")} onClick={() => setVista("pendientes")}>
          Pendientes {stats.atrasados > 0 && <span className="fq-subtab-dot" />}
        </button>
        <button className={"fq-subtab" + (vista === "maquinas" ? " is-active" : "")} onClick={() => setVista("maquinas")}>
          Máquinas {alertasMaquina > 0 && <span className="fq-subtab-dot" />}
        </button>
        <button className={"fq-subtab" + (vista === "terminados" ? " is-active" : "")} onClick={() => setVista("terminados")}>
          Terminados
        </button>
      </div>

      {vista === "lotes" && (
        <>
          <section className="fq-stats">
            <StatTile label="Lotes en planta" value={stats.total} tone="steel" />
            <StatTile label="En proceso" value={stats.enProceso} tone="steel" />
            <StatTile label="Atrasados" value={stats.atrasados} tone="red" />
            <StatTile label="Defectos hoy" value={stats.defectosHoy} tone="amber" />
            <StatTile label="Alertas activas" value={stats.problemasActivos} tone="red" />
          </section>

          <MetaVsReal lotes={lotes} metas={config.metas} zonas={ZONAS} />

          <section className="fq-admin-toolbar">
            <h2 className="fq-section-title">Lotes de producción</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="fq-btn fq-btn-ghost" onClick={() => setShowEquipo(true)}>👥 Equipo</button>
              <button className="fq-btn fq-btn-ghost" onClick={() => setShowConfig(true)}>⚙ Configuración</button>
              <button className="fq-btn fq-btn-primary" onClick={() => setShowForm(true)}>+ Nuevo lote</button>
            </div>
          </section>

          <section className="fq-lote-grid">
            {lotes.map((l) => (
              <LoteCard key={l.id} lote={l} today={today} onOpen={() => setDetailId(l.id)} />
            ))}
          </section>
        </>
      )}

      {vista === "pendientes" && <PendientesList lotes={lotes} zonaFiltro={null} onOpen={setDetailId} />}
      {vista === "maquinas" && (
        <MaquinasPanel maquinas={maquinas} lotes={lotes} zonaFiltro={null} addMaquina={addMaquina} updateMaquina={updateMaquina} esAdmin />
      )}
      {vista === "terminados" && <TerminadosList lotes={lotes} zonaFiltro={null} config={config} />}

      {showForm && (
        <LoteFormModal
          config={config}
          onClose={() => setShowForm(false)}
          onCreate={(l) => {
            addLote(l);
            setShowForm(false);
          }}
        />
      )}

      {showConfig && <ConfigModal config={config} onSave={updateConfig} onClose={() => setShowConfig(false)} />}

      {showEquipo && (
        <EquipoModal empresaId={empresaId} empresaNombre={empresaNombre} onClose={() => setShowEquipo(false)} />
      )}

      {detailLote && (
        <LoteDetailModal
          lote={detailLote}
          onClose={() => setDetailId(null)}
          onUpdate={(patch) => updateLote(detailLote.id, (l) => ({ ...l, ...patch }))}
          maquinas={maquinas}
          onResolveProblem={(idx) =>
            updateLote(detailLote.id, (l) => {
              const problemas = l.problemas.map((p, i) => (i === idx ? { ...p, activo: false, resueltoEn: nowISO() } : p));
              return { ...l, problemas };
            })
          }
        />
      )}
    </div>
  );
}

function StatTile({ label, value, tone }) {
  return (
    <div className={"fq-stat fq-stat-" + tone}>
      <span className="fq-stat-value">{value}</span>
      <span className="fq-stat-label">{label}</span>
    </div>
  );
}

function MetaVsReal({ lotes, metas, zonas }) {
  return (
    <section className="fq-meta-block">
      <h3 className="fq-meta-title">Meta vs. real de hoy</h3>
      <p className="fq-form-hint" style={{ margin: "0 0 10px" }}>
        Real = piezas de lotes que avanzaron o se entregaron hoy en esa zona (aproximado por lote, no pieza por pieza).
      </p>
      <div className="fq-meta-grid">
        {zonas.map((z) => {
          const meta = metas[z] || 0;
          const real = produccionHoyPorZona(lotes, z);
          const pct = meta > 0 ? Math.min(100, Math.round((real / meta) * 100)) : 0;
          return (
            <div className="fq-meta-card" key={z}>
              <div className="fq-meta-card-top">
                <span>{z}</span>
                <span className="fq-meta-numbers">{real} / {meta} pzas</span>
              </div>
              <div className="fq-progress">
                <div className="fq-progress-fill" style={{ width: pct + "%", background: pct >= 100 ? "var(--green)" : "var(--steel)" }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MaquinasPanel({ maquinas, lotes, zonaFiltro, addMaquina, updateMaquina, esAdmin }) {
  const [showForm, setShowForm] = useState(false);
  const [fallaAbiertaId, setFallaAbiertaId] = useState(null);
  const [descripcionFalla, setDescripcionFalla] = useState("");

  const lista = zonaFiltro ? maquinas.filter((m) => m.zona === zonaFiltro) : maquinas;
  const zonasParaProblemas = zonaFiltro ? [zonaFiltro] : ZONAS;
  const paros = [];
  lotes.forEach((l) => {
    if (!zonasParaProblemas.includes(l.zona)) return;
    l.problemas.forEach((p) => paros.push({ ...p, loteId: l.id, producto: l.producto, zona: l.zona }));
  });
  paros.sort((a, b) => new Date(b.ts) - new Date(a.ts));

  const hoy = new Date().toISOString().slice(0, 10);
  const parosHoy = paros.filter((p) => p.ts.slice(0, 10) === hoy);
  const porCausa = {};
  parosHoy.forEach((p) => {
    porCausa[p.tipo] = (porCausa[p.tipo] || 0) + 1;
  });
  const tiempoTotalHoy = parosHoy.reduce((sum, p) => {
    const fin = p.activo ? Date.now() : new Date(p.resueltoEn || p.ts).getTime();
    return sum + (fin - new Date(p.ts).getTime()) / 3600000;
  }, 0);

  function registrarFalla(maquinaId) {
    if (!descripcionFalla.trim()) return;
    updateMaquina(maquinaId, (m) => ({
      ...m,
      estado: "paro",
      fallas: [...m.fallas, { ts: nowISO(), descripcion: descripcionFalla.trim() }],
    }));
    setDescripcionFalla("");
    setFallaAbiertaId(null);
  }

  return (
    <div>
      <section className="fq-stats">
        <StatTile label="Paros hoy" value={parosHoy.length} tone="red" />
        <StatTile label="Horas de paro hoy" value={formatDuracion(tiempoTotalHoy)} tone="amber" />
        <StatTile label="Máquinas en paro" value={lista.filter((m) => m.estado === "paro").length} tone="red" />
        <StatTile label="Con mantenimiento vencido" value={lista.filter((m) => m.horasUso >= m.umbralHoras).length} tone="amber" />
      </section>

      {Object.keys(porCausa).length > 0 && (
        <div className="fq-causa-list">
          {Object.entries(porCausa).map(([causa, n]) => (
            <span className="fq-causa-chip" key={causa}>{causa}: {n}</span>
          ))}
        </div>
      )}

      <section className="fq-admin-toolbar">
        <h2 className="fq-section-title">Máquinas{zonaFiltro ? ` — ${zonaFiltro}` : ""}</h2>
        {esAdmin && (
          <button className="fq-btn fq-btn-primary" onClick={() => setShowForm(true)}>+ Agregar máquina</button>
        )}
      </section>

      {lista.length === 0 ? (
        <p className="fq-empty">Todavía no hay máquinas registradas{zonaFiltro ? " en esta zona" : ""}.</p>
      ) : (
        <div className="fq-maquina-grid">
          {lista.map((m) => {
            const enAlerta = m.horasUso >= m.umbralHoras;
            return (
              <div className="fq-maquina-card" key={m.id}>
                <div className="fq-maquina-top">
                  <strong>{m.nombre}</strong>
                  <span className="fq-badge fq-badge-zona">{m.zona}</span>
                </div>
                <div className="fq-maquina-estados">
                  {ESTADOS_MAQUINA.map((es) => (
                    <button
                      key={es}
                      className={"fq-estado-chip fq-estado-" + es + (m.estado === es ? " is-active" : "")}
                      onClick={() => updateMaquina(m.id, (mm) => ({ ...mm, estado: es }))}
                    >
                      {ESTADO_MAQUINA_LABEL[es]}
                    </button>
                  ))}
                </div>
                <p className="fq-maquina-horas">
                  Horas de uso: {m.horasUso} / {m.umbralHoras} {enAlerta && <span className="fq-flag fq-flag-amber">Mantenimiento sugerido</span>}
                </p>
                <div className="fq-maquina-actions">
                  <button
                    className="fq-btn fq-btn-tiny"
                    onClick={() => updateMaquina(m.id, (mm) => ({ ...mm, horasUso: mm.horasUso + 8 }))}
                  >
                    +8h de uso (turno)
                  </button>
                  <button
                    className="fq-btn fq-btn-tiny fq-btn-success"
                    onClick={() => updateMaquina(m.id, (mm) => ({ ...mm, horasUso: 0, estado: "operando" }))}
                  >
                    Mantenimiento realizado
                  </button>
                  <button className="fq-btn fq-btn-tiny fq-btn-reject" onClick={() => setFallaAbiertaId(m.id)}>
                    Registrar falla
                  </button>
                </div>
                {fallaAbiertaId === m.id && (
                  <div className="fq-falla-form">
                    <input
                      value={descripcionFalla}
                      onChange={(e) => setDescripcionFalla(e.target.value)}
                      placeholder="Describe la falla…"
                    />
                    <button className="fq-btn fq-btn-tiny fq-btn-primary" onClick={() => registrarFalla(m.id)}>Guardar</button>
                  </div>
                )}
                {m.fallas.length > 0 && (
                  <p className="fq-form-hint" style={{ margin: "6px 0 0" }}>
                    Última falla: {m.fallas[m.fallas.length - 1].descripcion} ({fmtTime(m.fallas[m.fallas.length - 1].ts)})
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h3 className="fq-section-title" style={{ marginTop: 22 }}>Paros registrados{zonaFiltro ? ` en ${zonaFiltro}` : ""}</h3>
      {paros.length === 0 ? (
        <p className="fq-empty">Sin paros registrados todavía.</p>
      ) : (
        <div className="fq-hist" style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
          <ul>
            {paros.slice(0, 20).map((p, i) => (
              <li key={i}>
                <span className="fq-hist-time">{fmtTime(p.ts)}</span>
                <span>
                  {p.tipo} — {p.loteId} · {p.zona}{" "}
                  {p.activo ? (
                    <span className="fq-flag fq-flag-red">en curso, {formatDuracion(horasDesde(p.ts))}</span>
                  ) : (
                    <span className="fq-flag fq-flag-green">
                      resuelto{p.resueltoEn ? `, duró ${formatDuracion((new Date(p.resueltoEn) - new Date(p.ts)) / 3600000)}` : ""}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showForm && (
        <MachineForm
          onClose={() => setShowForm(false)}
          onCreate={(m) => {
            addMaquina(m);
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}

function MachineForm({ onClose, onCreate }) {
  const [nombre, setNombre] = useState("");
  const [zona, setZona] = useState(ZONAS[0]);
  const [umbralHoras, setUmbralHoras] = useState(200);

  function submit() {
    if (!nombre.trim()) return;
    onCreate({ id: uid() + uid(), nombre: nombre.trim(), zona, estado: "operando", horasUso: 0, umbralHoras: Number(umbralHoras) || 200, fallas: [] });
  }

  return (
    <div className="fq-modal-overlay" onClick={onClose}>
      <div className="fq-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fq-modal-head">
          <h3>Agregar máquina</h3>
          <button className="fq-modal-close" onClick={onClose}>✕</button>
        </div>
        <label className="fq-field">
          <span>Nombre / identificador</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Máquina de coser 3" />
        </label>
        <label className="fq-field" style={{ marginTop: 10 }}>
          <span>Zona / línea</span>
          <select value={zona} onChange={(e) => setZona(e.target.value)}>
            {ZONAS.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <label className="fq-field" style={{ marginTop: 10 }}>
          <span>Mantenimiento cada (horas de uso)</span>
          <input type="number" value={umbralHoras} onChange={(e) => setUmbralHoras(e.target.value)} />
        </label>
        <div className="fq-modal-actions">
          <button className="fq-btn fq-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="fq-btn fq-btn-primary" disabled={!nombre.trim()} onClick={submit}>Agregar</button>
        </div>
      </div>
    </div>
  );
}

function ConfigModal({ config, onSave, onClose }) {
  const [metas, setMetas] = useState(config.metas);
  const [costosActivo, setCostosActivo] = useState(config.costosActivo);
  const [tarifa, setTarifa] = useState(config.tarifaHoraManoObra);

  function guardar() {
    onSave({ metas, costosActivo, tarifaHoraManoObra: Number(tarifa) || 0 });
    onClose();
  }

  return (
    <div className="fq-modal-overlay" onClick={onClose}>
      <div className="fq-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fq-modal-head">
          <h3>Configuración</h3>
          <button className="fq-modal-close" onClick={onClose}>✕</button>
        </div>

        <h4 className="fq-config-subtitle">Meta diaria de producción por zona (piezas)</h4>
        {ZONAS.map((z) => (
          <label className="fq-field" style={{ marginTop: 8 }} key={z}>
            <span>{z}</span>
            <input
              type="number"
              value={metas[z] || 0}
              onChange={(e) => setMetas({ ...metas, [z]: Number(e.target.value) })}
            />
          </label>
        ))}

        <h4 className="fq-config-subtitle" style={{ marginTop: 18 }}>Control de costos (opcional)</h4>
        <p className="fq-form-hint" style={{ margin: "0 0 8px" }}>
          Si lo activas, al crear un lote podrás poner un costo estimado y al terminarlo verás un costo real
          aproximado (mano de obra según el tiempo que tardó, más materiales). Si no te interesa este dato, déjalo
          apagado y la app no te lo muestra en ningún lado.
        </p>
        <button
          className={"fq-zona-chip" + (costosActivo ? " is-active" : "")}
          onClick={() => setCostosActivo((v) => !v)}
        >
          {costosActivo ? "Activado" : "Desactivado"}
        </button>
        {costosActivo && (
          <label className="fq-field" style={{ marginTop: 10 }}>
            <span>Tarifa por hora de mano de obra ($)</span>
            <input type="number" value={tarifa} onChange={(e) => setTarifa(e.target.value)} />
          </label>
        )}

        <div className="fq-modal-actions">
          <button className="fq-btn fq-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="fq-btn fq-btn-primary" onClick={guardar}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function EquipoModal({ empresaId, empresaNombre, onClose }) {
  const [codigos, setCodigos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(null); // 'supervisor' | 'worker' | null

  async function cargar() {
    setLoading(true);
    try {
      const res = await window.storage.get(ROLE_INVITACIONES_KEY, true).catch(() => null);
      const todos = res && res.value ? JSON.parse(res.value) : [];
      setCodigos(todos.filter((c) => c.empresaId === empresaId));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function generar(rol) {
    setGenerando(rol);
    try {
      const res = await window.storage.get(ROLE_INVITACIONES_KEY, true).catch(() => null);
      const actuales = res && res.value ? JSON.parse(res.value) : [];
      const nuevo = {
        codigo: generarCodigoInvitacion(),
        empresaId,
        empresaNombre,
        rol,
        usado: false,
        creadaEn: nowISO(),
      };
      const next = [nuevo, ...actuales];
      await window.storage.set(ROLE_INVITACIONES_KEY, JSON.stringify(next), true);
      setCodigos(next.filter((c) => c.empresaId === empresaId));
    } finally {
      setGenerando(null);
    }
  }

  const ROLE_LABEL = { supervisor: "Supervisor", worker: "Trabajador" };

  return (
    <div className="fq-modal-overlay" onClick={onClose}>
      <div className="fq-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fq-modal-head">
          <h3>Invitar a tu equipo</h3>
          <button className="fq-modal-close" onClick={onClose}>✕</button>
        </div>

        <p className="fq-form-hint" style={{ margin: "0 0 12px" }}>
          Genera un código para tu supervisor o para un trabajador. Ese código solo les deja entrar con ese rol —
          no pueden usarlo para ver el panel del jefe.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button className="fq-btn fq-btn-primary" disabled={generando} onClick={() => generar("supervisor")}>
            {generando === "supervisor" ? "Generando…" : "+ Código de Supervisor"}
          </button>
          <button className="fq-btn fq-btn-primary" disabled={generando} onClick={() => generar("worker")}>
            {generando === "worker" ? "Generando…" : "+ Código de Trabajador"}
          </button>
        </div>

        {loading ? (
          <p className="fq-empty">Cargando…</p>
        ) : codigos.length === 0 ? (
          <p className="fq-empty">Todavía no has generado códigos para tu equipo.</p>
        ) : (
          <div className="fq-invite-list">
            {codigos.map((c) => (
              <div className="fq-invite-row" key={c.codigo}>
                <div>
                  <span className="fq-invite-code">{c.codigo}</span>
                  <div className="fq-pending-time">{ROLE_LABEL[c.rol]}</div>
                </div>
                <span className={"fq-flag " + (c.usado ? "fq-flag-green" : "fq-flag-amber")}>
                  {c.usado ? "Usado" : "Sin usar"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PendientesList({ lotes, zonaFiltro, onOpen }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const base = zonaFiltro ? lotes.filter((l) => l.zona === zonaFiltro) : lotes;
  const zonasAMostrar = zonaFiltro ? [zonaFiltro] : ZONAS;

  const pendientes = base.filter((l) => {
    if (l.estado === "terminado") return false;
    const ultimo = l.historial[l.historial.length - 1];
    const horasSinReporte = ultimo ? horasDesde(ultimo.ts) : 999;
    const atrasado = l.fechaEntrega && l.fechaEntrega < hoy;
    return atrasado || horasSinReporte > UMBRAL_HORAS_SIN_REPORTE;
  });

  return (
    <div>
      <h2 className="fq-section-title">Proyectos sin terminar o sin reportar</h2>
      {pendientes.length === 0 ? (
        <p className="fq-empty">Todo al día — no hay lotes atrasados ni sin reportar.</p>
      ) : (
        <div className="fq-pend-grid">
          {pendientes.map((l) => {
            const ultimo = l.historial[l.historial.length - 1];
            const horasSinReporte = ultimo ? horasDesde(ultimo.ts) : null;
            const atrasado = l.fechaEntrega && l.fechaEntrega < hoy;
            return (
              <button className="fq-pend-card" key={l.id} onClick={() => onOpen && onOpen(l.id)}>
                <div className="fq-pend-card-head">
                  <span className="fq-lote-id">{l.id}</span>
                  <span className="fq-badge fq-badge-zona">{l.zona}</span>
                </div>
                <h4>{l.producto}</h4>
                <p className="fq-pend-etapa">
                  Detenido en: <strong>{l.etapas[l.etapaIndex]}</strong>
                </p>
                <p className="fq-pend-worker">Responsable: {l.trabajadorAsignado || "Sin asignar"}</p>
                <div className="fq-pend-flags">
                  {atrasado && <span className="fq-flag fq-flag-red">Fecha de entrega vencida</span>}
                  {horasSinReporte != null && (
                    <span className="fq-flag fq-flag-amber">Sin reportar hace {formatDuracion(horasSinReporte)}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <h3 className="fq-section-title" style={{ marginTop: 24 }}>
        Personal — quién ha reportado hoy
      </h3>
      <div className="fq-roster-grid">
        {zonasAMostrar.map((z) => (
          <div className="fq-roster-zona" key={z}>
            <span className="fq-roster-zona-name">{z}</span>
            {(WORKERS_POR_ZONA[z] || []).map((w) => {
              const reporto = base.some((l) => l.zona === z && l.historial.some((h) => h.por === w && h.ts.slice(0, 10) === hoy));
              return (
                <div key={w} className={"fq-roster-row" + (reporto ? " reporto" : " no-reporto")}>
                  <span>{w}</span>
                  <span className="fq-roster-status">{reporto ? "Reportó hoy" : "No ha reportado hoy"}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminadosList({ lotes, zonaFiltro, readOnly, config }) {
  const [orden, setOrden] = useState("reciente");
  const costosActivo = config && config.costosActivo;
  const base = (zonaFiltro ? lotes.filter((l) => l.zona === zonaFiltro) : lotes).filter((l) => l.estado === "terminado");
  const ordenados = [...base].sort((a, b) => {
    if (orden === "empresa") return (a.empresaDestino || a.cliente || "").localeCompare(b.empresaDestino || b.cliente || "");
    return new Date(b.terminadoEn || b.creadoEn || 0) - new Date(a.terminadoEn || a.creadoEn || 0);
  });

  return (
    <div>
      <div className="fq-admin-toolbar">
        <h2 className="fq-section-title">Entregas terminadas{readOnly ? " — listas para presentar" : ""}</h2>
        <div className="fq-switch">
          <button className={"fq-switch-btn" + (orden === "reciente" ? " is-active" : "")} onClick={() => setOrden("reciente")}>
            Más recientes
          </button>
          <button className={"fq-switch-btn" + (orden === "empresa" ? " is-active" : "")} onClick={() => setOrden("empresa")}>
            Por empresa
          </button>
        </div>
      </div>

      {ordenados.length === 0 ? (
        <p className="fq-empty">Aún no hay entregas terminadas.</p>
      ) : (
        <div className="fq-lote-grid">
          {ordenados.map((l) => {
            const duracion = l.terminadoEn && l.creadoEn ? (new Date(l.terminadoEn) - new Date(l.creadoEn)) / 3600000 : null;
            const mostrarCosto = costosActivo && l.costoManoObraEstimado != null;
            const costoManoObraReal = mostrarCosto && duracion != null ? duracion * (config.tarifaHoraManoObra || 0) : null;
            const costoTotalReal = mostrarCosto ? (costoManoObraReal || 0) + (l.costoMaterialesEstimado || 0) : null;
            const costoTotalEstimado = mostrarCosto ? (l.costoManoObraEstimado || 0) + (l.costoMaterialesEstimado || 0) : null;
            return (
              <div className="fq-done-card" key={l.id}>
                <div className="fq-done-card-top">
                  <span className="fq-lote-id">{l.id}</span>
                  <span className="fq-flag fq-flag-green">Terminado</span>
                </div>
                <h4>{l.producto}</h4>
                <p className="fq-done-empresa">
                  Para: <strong>{l.empresaDestino || l.cliente}</strong>
                </p>
                <p className="fq-lote-meta">
                  {l.color} · {l.talla} · {l.cantidad} pzas · {l.zona}
                </p>
                <p className="fq-done-duracion">Tiempo total del proceso: {formatDuracion(duracion)}</p>
                <p className="fq-done-fecha">Entregado: {l.terminadoEn ? fmtTime(l.terminadoEn) : "—"}</p>
                {mostrarCosto && (
                  <div className="fq-costo-box">
                    <span>Costo real aprox.: <strong>${costoTotalReal.toFixed(0)}</strong></span>
                    <span className={"fq-costo-desv" + (costoTotalReal > costoTotalEstimado ? " sobre" : " bajo")}>
                      vs. estimado ${costoTotalEstimado.toFixed(0)} ({costoTotalReal > costoTotalEstimado ? "+" : ""}
                      {(costoTotalReal - costoTotalEstimado).toFixed(0)})
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LoteCard({ lote, today, onOpen }) {
  const atrasado = lote.estado !== "terminado" && lote.fechaEntrega < today;
  const pct =
    lote.estado === "terminado" ? 100 : Math.round((lote.etapaIndex / (lote.etapas.length - 1)) * 100);
  const etapaLabel = lote.estado === "terminado" ? "Terminado" : lote.etapas[lote.etapaIndex];
  const alertas = lote.problemas.filter((p) => p.activo).length;

  return (
    <button className="fq-lote-card" onClick={onOpen}>
      <div className="fq-lote-card-top">
        <span className="fq-lote-id">{lote.id}</span>
        <span className={"fq-badge fq-prio-" + lote.prioridad.toLowerCase()}>{lote.prioridad}</span>
      </div>
      <h3 className="fq-lote-nombre">{lote.producto}</h3>
      <p className="fq-lote-meta">
        {lote.color} · {lote.talla} · {lote.cantidad} pzas
      </p>
      <div className="fq-progress">
        <div className="fq-progress-fill" style={{ width: pct + "%" }} />
      </div>
      <div className="fq-lote-card-bottom">
        <span className={"fq-etapa-tag" + (lote.estado === "terminado" ? " is-done" : "")}>{etapaLabel}</span>
        {atrasado && <span className="fq-flag fq-flag-red">Atrasado</span>}
        {alertas > 0 && <span className="fq-flag fq-flag-amber">{alertas} alerta{alertas > 1 ? "s" : ""}</span>}
      </div>
    </button>
  );
}

function LoteFormModal({ onClose, onCreate, config }) {
  const [producto, setProducto] = useState("");
  const [color, setColor] = useState("");
  const [talla, setTalla] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [cliente, setCliente] = useState("");
  const [fechaEntrega, setFechaEntrega] = useState("");
  const [prioridad, setPrioridad] = useState("Media");
  const [plantilla, setPlantilla] = useState("Calzado");
  const [zona, setZona] = useState(ZONAS[0]);
  const [trabajadorAsignado, setTrabajadorAsignado] = useState("");
  const [metodoId, setMetodoId] = useState("qr");
  const [fotoTag, setFotoTag] = useState(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [costoMaterialesEstimado, setCostoMaterialesEstimado] = useState("");
  const [costoManoObraEstimado, setCostoManoObraEstimado] = useState("");

  const costosActivo = config && config.costosActivo;
  const canSubmit = producto && cantidad && fechaEntrega;

  async function handleFoto(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setSubiendoFoto(true);
    try {
      const dataUrl = await resizeImageFile(file);
      setFotoTag(dataUrl);
    } catch (err) {
      // si falla la compresión, simplemente no se adjunta la foto
    } finally {
      setSubiendoFoto(false);
    }
  }

  function submit() {
    if (!canSubmit) return;
    const lote = {
      id: uid(),
      producto,
      color: color || "—",
      talla: talla || "—",
      cantidad: Number(cantidad),
      cliente: cliente || "—",
      fechaEntrega,
      prioridad,
      plantilla,
      zona,
      creadoEn: nowISO(),
      trabajadorAsignado: trabajadorAsignado || "Sin asignar",
      empresaDestino: "",
      terminadoEn: null,
      metodoId,
      fotoTag: metodoId === "foto" ? fotoTag : null,
      costoMaterialesEstimado: costosActivo ? Number(costoMaterialesEstimado) || 0 : null,
      costoManoObraEstimado: costosActivo ? Number(costoManoObraEstimado) || 0 : null,
      etapas: PLANTILLAS[plantilla],
      etapaIndex: 0,
      estado: "en_proceso",
      enProgreso: false,
      historial: [{ ts: nowISO(), etapa: PLANTILLAS[plantilla][0], accion: "Lote creado", por: "Administrador" }],
      defectos: [],
      problemas: [],
    };
    onCreate(lote);
  }

  return (
    <div className="fq-modal-overlay" onClick={onClose}>
      <div className="fq-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fq-modal-head">
          <h3>Nuevo lote de producción</h3>
          <button className="fq-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="fq-form-grid">
          <label className="fq-field">
            <span>Producto / modelo</span>
            <input value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Ej. Tenis X-500" />
          </label>
          <label className="fq-field">
            <span>Color</span>
            <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Negro" />
          </label>
          <label className="fq-field">
            <span>Talla / medida</span>
            <input value={talla} onChange={(e) => setTalla(e.target.value)} placeholder="25–29" />
          </label>
          <label className="fq-field">
            <span>Cantidad</span>
            <input type="number" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="120" />
          </label>
          <label className="fq-field">
            <span>Cliente</span>
            <input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Distribuidora León" />
          </label>
          <label className="fq-field">
            <span>Fecha de entrega</span>
            <input type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
          </label>
          <label className="fq-field">
            <span>Prioridad</span>
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
              <option>Alta</option>
              <option>Media</option>
              <option>Baja</option>
            </select>
          </label>
          <label className="fq-field">
            <span>Flujo de proceso</span>
            <select value={plantilla} onChange={(e) => setPlantilla(e.target.value)}>
              {Object.keys(PLANTILLAS).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="fq-field">
            <span>Zona / línea</span>
            <select value={zona} onChange={(e) => setZona(e.target.value)}>
              {ZONAS.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
          <label className="fq-field">
            <span>Trabajador asignado</span>
            <input value={trabajadorAsignado} onChange={(e) => setTrabajadorAsignado(e.target.value)} placeholder="Ej. Trabajador 04" />
          </label>
        </div>

        <div className="fq-field" style={{ marginTop: 12 }}>
          <span>Cómo identificarás este lote</span>
          <div className="fq-zona-chips">
            <button type="button" className={"fq-zona-chip" + (metodoId === "qr" ? " is-active" : "")} onClick={() => setMetodoId("qr")}>
              Imprimir QR
            </button>
            <button type="button" className={"fq-zona-chip" + (metodoId === "foto" ? " is-active" : "")} onClick={() => setMetodoId("foto")}>
              Dejarlo con foto
            </button>
          </div>
          {metodoId === "foto" && (
            <div className="fq-foto-upload">
              {fotoTag ? (
                <img src={fotoTag} alt="Foto de referencia del lote" className="fq-foto-preview" />
              ) : (
                <span className="fq-form-hint" style={{ margin: 0 }}>
                  {subiendoFoto ? "Procesando foto…" : "Sin foto todavía — puedes agregarla ahora o después."}
                </span>
              )}
              <label className="fq-btn fq-btn-ghost fq-foto-btn">
                {fotoTag ? "Cambiar foto" : "Tomar / subir foto"}
                <input type="file" accept="image/*" capture="environment" onChange={handleFoto} hidden />
              </label>
            </div>
          )}
        </div>

        {costosActivo && (
          <div className="fq-form-grid" style={{ marginTop: 12 }}>
            <label className="fq-field">
              <span>Costo materiales estimado ($)</span>
              <input type="number" value={costoMaterialesEstimado} onChange={(e) => setCostoMaterialesEstimado(e.target.value)} placeholder="0" />
            </label>
            <label className="fq-field">
              <span>Costo mano de obra estimado ($)</span>
              <input type="number" value={costoManoObraEstimado} onChange={(e) => setCostoManoObraEstimado(e.target.value)} placeholder="0" />
            </label>
          </div>
        )}

        <p className="fq-form-hint">Etapas: {PLANTILLAS[plantilla].join(" → ")}</p>
        <div className="fq-modal-actions">
          <button className="fq-btn fq-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="fq-btn fq-btn-primary" disabled={!canSubmit} onClick={submit}>
            {metodoId === "qr" ? "Crear lote y generar QR" : "Crear lote"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoteDetailModal({ lote, onClose, onResolveProblem, onUpdate, maquinas }) {
  const qrData = encodeURIComponent("FLOWQR|" + lote.id);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${qrData}`;
  const metodoId = lote.metodoId || "qr";
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  async function handleFoto(e) {
    const file = e.target.files && e.target.files[0];
    if (!file || !onUpdate) return;
    setSubiendoFoto(true);
    try {
      const dataUrl = await resizeImageFile(file);
      onUpdate({ fotoTag: dataUrl });
    } catch (err) {
      // si falla, no se adjunta
    } finally {
      setSubiendoFoto(false);
    }
  }

  return (
    <div className="fq-modal-overlay" onClick={onClose}>
      <div className="fq-modal fq-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="fq-modal-head">
          <h3>Lote {lote.id} — {lote.producto}</h3>
          <button className="fq-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="fq-detail-layout">
          <div className="fq-tag" id={`fq-print-tag-${lote.id}`}>
            <div className="fq-tag-perf" />

            {onUpdate && (
              <div className="fq-tag-method-switch">
                <button
                  className={"fq-tag-method-btn" + (metodoId === "qr" ? " is-active" : "")}
                  onClick={() => onUpdate({ metodoId: "qr" })}
                >
                  QR
                </button>
                <button
                  className={"fq-tag-method-btn" + (metodoId === "foto" ? " is-active" : "")}
                  onClick={() => onUpdate({ metodoId: "foto" })}
                >
                  Foto
                </button>
              </div>
            )}

            {metodoId === "qr" ? (
              <div className="fq-tag-qr">
                <img src={qrUrl} alt={"QR del lote " + lote.id} width="140" height="140" />
              </div>
            ) : lote.fotoTag ? (
              <img src={lote.fotoTag} alt={"Foto de referencia del lote " + lote.id} className="fq-tag-foto" />
            ) : (
              <div className="fq-tag-foto-empty">{subiendoFoto ? "Procesando…" : "Sin foto todavía"}</div>
            )}

            <div className="fq-tag-info">
              <span className="fq-tag-id">{lote.id}</span>
              <span className="fq-tag-line">{lote.producto}</span>
              <span className="fq-tag-line">{lote.color} · {lote.talla}</span>
              <span className="fq-tag-line">{lote.cantidad} pzas · {lote.cliente}</span>
              <span className="fq-tag-line">Entrega: {fmtDate(lote.fechaEntrega)}</span>
            </div>

            {metodoId === "qr" ? (
              <div className="fq-tag-actions">
                <button className="fq-btn fq-btn-primary fq-tag-dl" onClick={() => window.print()}>
                  Imprimir QR
                </button>
                <a className="fq-btn fq-btn-ghost fq-tag-dl" href={qrUrl} download={`flowqr-${lote.id}.png`}>
                  Descargar imagen
                </a>
              </div>
            ) : (
              onUpdate && (
                <label className="fq-btn fq-btn-ghost fq-tag-dl fq-foto-btn">
                  {lote.fotoTag ? "Cambiar foto" : "Tomar / subir foto"}
                  <input type="file" accept="image/*" capture="environment" onChange={handleFoto} hidden />
                </label>
              )
            )}
          </div>

          <div className="fq-detail-right">
            <div className="fq-etapa-track">
              {lote.etapas.map((e, i) => (
                <div
                  key={e}
                  className={
                    "fq-etapa-step" +
                    (i < lote.etapaIndex || lote.estado === "terminado" ? " is-done" : i === lote.etapaIndex ? " is-current" : "")
                  }
                >
                  <span className="fq-etapa-dot" />
                  <span className="fq-etapa-name">{e}</span>
                </div>
              ))}
            </div>

            {lote.problemas.some((p) => p.activo) && (
              <div className="fq-alert-box">
                <strong>Alertas activas — paro en curso</strong>
                {lote.problemas.map((p, i) =>
                  p.activo ? (
                    <div className="fq-alert-row" key={i}>
                      <span>
                        <Icon.Alert s={16} /> {p.tipo} · {p.etapa} · lleva {formatDuracion(horasDesde(p.ts))} parado
                      </span>
                      <button className="fq-btn fq-btn-tiny" onClick={() => onResolveProblem(i)}>Resolver</button>
                    </div>
                  ) : null
                )}
              </div>
            )}

            {lote.problemas.some((p) => !p.activo) && (
              <div className="fq-hist">
                <h4>Paros resueltos</h4>
                <ul>
                  {lote.problemas
                    .filter((p) => !p.activo)
                    .map((p, i) => (
                      <li key={i}>
                        <span className="fq-hist-time">{fmtTime(p.ts)}</span>
                        <span>
                          {p.tipo} — {p.etapa}
                          {p.resueltoEn ? ` · duró ${formatDuracion((new Date(p.resueltoEn) - new Date(p.ts)) / 3600000)}` : ""}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <div className="fq-hist">
              <h4>Historial</h4>
              <ul>
                {[...lote.historial].reverse().map((h, i) => (
                  <li key={i}>
                    <span className="fq-hist-time">{fmtTime(h.ts)}</span>
                    <span>{h.accion} — {h.etapa} <em>({h.por}{h.puesto ? " · " + h.puesto : ""})</em></span>
                  </li>
                ))}
              </ul>
            </div>

            {lote.defectos.length > 0 && (
              <div className="fq-hist">
                <h4>Defectos registrados</h4>
                <ul>
                  {lote.defectos.map((d, i) => {
                    const maquina = d.maquinaId && maquinas ? maquinas.find((m) => m.id === d.maquinaId) : null;
                    return (
                      <li key={i}>
                        <span className="fq-hist-time">{fmtTime(d.ts)}</span>
                        <span>
                          {d.motivo} — {d.etapa} · {d.cantidad} pzas{maquina ? ` · ${maquina.nombre}` : ""}{" "}
                          <span className={"fq-defstatus fq-defstatus-" + (d.estado || "pendiente")}>{d.estado || "pendiente"}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================= SUPERVISOR =============================== */
function SupervisorPanel({ lotes, updateLote, zona, setZona, maquinas, updateMaquina, config }) {
  const [detailId, setDetailId] = useState(null);
  const [vista, setVista] = useState("lotes");
  const today = new Date().toISOString().slice(0, 10);

  const lotesZona = lotes.filter((l) => l.zona === zona);
  const pendientes = [];
  lotesZona.forEach((l) => {
    l.defectos.forEach((d, idx) => {
      if ((d.estado || "pendiente") === "pendiente") pendientes.push({ lote: l, idx, d });
    });
  });

  const stats = useMemo(() => {
    const enProceso = lotesZona.filter((l) => l.estado === "en_proceso").length;
    const atrasados = lotesZona.filter((l) => l.estado !== "terminado" && l.fechaEntrega < today).length;
    const alertas = lotesZona.reduce((acc, l) => acc + l.problemas.filter((p) => p.activo).length, 0);
    return { enProceso, atrasados, alertas, total: lotesZona.length, pendientes: pendientes.length };
  }, [lotesZona, today, pendientes.length]);

  function decidirDefecto(loteId, idx, decision) {
    updateLote(loteId, (l) => {
      const defectos = l.defectos.map((d, i) => (i === idx ? { ...d, estado: decision } : d));
      return {
        ...l,
        defectos,
        historial: [
          ...l.historial,
          { ts: nowISO(), etapa: l.etapas[l.etapaIndex], accion: `Defecto ${decision} por supervisor`, por: `Supervisor (${zona})` },
        ],
      };
    });
  }

  function reasignarZona(loteId, nuevaZona) {
    updateLote(loteId, (l) => ({
      ...l,
      zona: nuevaZona,
      historial: [...l.historial, { ts: nowISO(), etapa: l.etapas[l.etapaIndex], accion: `Reasignado a ${nuevaZona}`, por: `Supervisor (${zona})` }],
    }));
  }

  const detailLote = lotes.find((l) => l.id === detailId) || null;

  return (
    <div className="fq-admin">
      <div className="fq-zona-picker">
        <span className="fq-zona-picker-label">Estás viendo:</span>
        <div className="fq-zona-chips">
          {ZONAS.map((z) => (
            <button key={z} className={"fq-zona-chip" + (z === zona ? " is-active" : "")} onClick={() => setZona(z)}>
              {z}
            </button>
          ))}
        </div>
      </div>

      <section className="fq-stats">
        <StatTile label="Lotes en la zona" value={stats.total} tone="steel" />
        <StatTile label="En proceso" value={stats.enProceso} tone="steel" />
        <StatTile label="Atrasados" value={stats.atrasados} tone="red" />
        <StatTile label="Alertas activas" value={stats.alertas} tone="red" />
        <StatTile label="Defectos por aprobar" value={stats.pendientes} tone="amber" />
      </section>

      <MetaVsReal lotes={lotes} metas={config.metas} zonas={[zona]} />

      <div className="fq-subtabs">
        <button className={"fq-subtab" + (vista === "lotes" ? " is-active" : "")} onClick={() => setVista("lotes")}>
          Lotes
        </button>
        <button className={"fq-subtab" + (vista === "pendientes" ? " is-active" : "")} onClick={() => setVista("pendientes")}>
          Sin terminar {stats.atrasados > 0 && <span className="fq-subtab-dot" />}
        </button>
        <button className={"fq-subtab" + (vista === "maquinas" ? " is-active" : "")} onClick={() => setVista("maquinas")}>
          Máquinas
        </button>
        <button className={"fq-subtab" + (vista === "terminados" ? " is-active" : "")} onClick={() => setVista("terminados")}>
          Terminados
        </button>
      </div>

      {vista === "lotes" && (
        <>
          {pendientes.length > 0 && (
            <section>
              <h2 className="fq-section-title">Defectos pendientes de aprobación</h2>
              <div className="fq-pending-list">
                {pendientes.map(({ lote, idx, d }) => (
                  <div className="fq-pending-row" key={lote.id + "-" + idx}>
                    <div>
                      <strong>{lote.id}</strong> · {lote.producto} — {d.motivo} ({d.cantidad} pzas, {d.etapa})
                      <div className="fq-pending-time">{fmtTime(d.ts)}</div>
                    </div>
                    <div className="fq-pending-actions">
                      <button className="fq-btn fq-btn-tiny fq-btn-success" onClick={() => decidirDefecto(lote.id, idx, "aprobado")}>
                        Aprobar
                      </button>
                      <button className="fq-btn fq-btn-tiny fq-btn-reject" onClick={() => decidirDefecto(lote.id, idx, "rechazado")}>
                        Rechazar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="fq-admin-toolbar">
            <h2 className="fq-section-title">Lotes en {zona}</h2>
          </section>

          <section className="fq-lote-grid">
            {lotesZona.map((l) => (
              <div key={l.id} className="fq-sup-card-wrap">
                <LoteCard lote={l} today={today} onOpen={() => setDetailId(l.id)} />
                <div className="fq-reassign">
                  <span>Mover a:</span>
                  {ZONAS.filter((z) => z !== l.zona).map((z) => (
                    <button key={z} className="fq-btn fq-btn-tiny" onClick={() => reasignarZona(l.id, z)}>
                      {z}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {lotesZona.length === 0 && <p className="fq-empty">No hay lotes asignados a esta zona.</p>}
          </section>
        </>
      )}

      {vista === "pendientes" && <PendientesList lotes={lotes} zonaFiltro={zona} onOpen={setDetailId} />}
      {vista === "maquinas" && (
        <MaquinasPanel maquinas={maquinas} lotes={lotes} zonaFiltro={zona} updateMaquina={updateMaquina} esAdmin={false} />
      )}
      {vista === "terminados" && <TerminadosList lotes={lotes} zonaFiltro={zona} config={config} />}

      {detailLote && (
        <LoteDetailModal
          lote={detailLote}
          onClose={() => setDetailId(null)}
          onUpdate={(patch) => updateLote(detailLote.id, (l) => ({ ...l, ...patch }))}
          maquinas={maquinas}
          onResolveProblem={(idx) =>
            updateLote(detailLote.id, (l) => {
              const problemas = l.problemas.map((p, i) => (i === idx ? { ...p, activo: false, resueltoEn: nowISO() } : p));
              return { ...l, problemas };
            })
          }
        />
      )}
    </div>
  );
}

/* ============================== WORKER ================================= */
function WorkerApp({ lotes, updateLote, maquinas }) {
  const [scannedId, setScannedId] = useState(null);
  const [modal, setModal] = useState(null); // 'defecto' | 'problema' | 'finalizar' | null
  const [verTerminados, setVerTerminados] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [identityLoading, setIdentityLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(IDENTITY_KEY, false);
        if (res && res.value) setIdentity(JSON.parse(res.value));
      } catch (e) {
        // sin identidad guardada todavía
      } finally {
        setIdentityLoading(false);
      }
    })();
  }, []);

  async function guardarIdentidad(nombre, zona, puesto) {
    const val = { nombre, zona, puesto };
    setIdentity(val);
    try {
      await window.storage.set(IDENTITY_KEY, JSON.stringify(val), false);
    } catch (e) {
      // si falla el guardado, la sesión sigue funcionando solo para este uso
    }
  }

  if (identityLoading) {
    return <div className="fq-loading">Cargando…</div>;
  }

  if (!identity) {
    return <WorkerIdentityScreen onSubmit={guardarIdentidad} />;
  }

  const activos = lotes.filter((l) => l.estado !== "terminado" && l.zona === identity.zona);
  const lote = lotes.find((l) => l.id === scannedId) || null;

  if (verTerminados) {
    return (
      <div className="fq-worker">
        <button className="fq-back" onClick={() => setVerTerminados(false)}>← Volver a escanear</button>
        <TerminadosList lotes={lotes} zonaFiltro={null} readOnly />
      </div>
    );
  }

  if (!lote) {
    return (
      <div className="fq-worker">
        <div className="fq-worker-idbar">
          <span>👤 {identity.nombre} · {identity.puesto} · {identity.zona}</span>
          <button onClick={() => setIdentity(null)}>Cambiar</button>
        </div>
        <div className="fq-scan-hero">
          <Icon.Scan s={40} />
          <h2>Escanear lote</h2>
          <p>Selecciona un lote para simular el escaneo del QR pegado a la caja.</p>
        </div>
        <button className="fq-btn fq-btn-outline fq-view-done-btn" onClick={() => setVerTerminados(true)}>
          Ver entregas terminadas
        </button>
        <div className="fq-scan-list">
          {activos.map((l) => (
            <button key={l.id} className="fq-scan-item" onClick={() => setScannedId(l.id)}>
              <span className="fq-scan-item-id">{l.id}</span>
              <span className="fq-scan-item-name">{l.producto}</span>
              <span className="fq-scan-item-etapa">{l.etapas[l.etapaIndex]}</span>
            </button>
          ))}
          {activos.length === 0 && <p className="fq-empty">No hay lotes activos en tu zona ({identity.zona}).</p>}
        </div>
      </div>
    );
  }

  const etapaActual = lote.etapas[lote.etapaIndex];
  const esUltima = lote.etapaIndex === lote.etapas.length - 1;

  function iniciar() {
    updateLote(lote.id, (l) => ({
      ...l,
      enProgreso: true,
      trabajadorAsignado: `${identity.nombre} (${identity.puesto})`,
      historial: [...l.historial, { ts: nowISO(), etapa: l.etapas[l.etapaIndex], accion: "Inició", por: identity.nombre, puesto: identity.puesto }],
    }));
  }

  function terminar() {
    if (esUltima) {
      setModal("finalizar");
      return;
    }
    updateLote(lote.id, (l) => {
      const historial = [...l.historial, { ts: nowISO(), etapa: l.etapas[l.etapaIndex], accion: "Terminé", por: identity.nombre, puesto: identity.puesto }];
      return { ...l, etapaIndex: l.etapaIndex + 1, enProgreso: false, historial };
    });
    setScannedId(null);
  }

  function confirmarEntrega(empresa) {
    updateLote(lote.id, (l) => ({
      ...l,
      estado: "terminado",
      enProgreso: false,
      terminadoEn: nowISO(),
      empresaDestino: empresa,
      historial: [...l.historial, { ts: nowISO(), etapa: l.etapas[l.etapaIndex], accion: `Entregado a ${empresa}`, por: identity.nombre, puesto: identity.puesto }],
    }));
    setModal(null);
    setScannedId(null);
  }

  function reportarDefecto(motivo, cantidad, maquinaId) {
    updateLote(lote.id, (l) => ({
      ...l,
      defectos: [...l.defectos, { ts: nowISO(), etapa: l.etapas[l.etapaIndex], motivo, cantidad, estado: "pendiente", maquinaId: maquinaId || null }],
      historial: [...l.historial, { ts: nowISO(), etapa: l.etapas[l.etapaIndex], accion: `Defecto: ${motivo} (${cantidad})`, por: identity.nombre, puesto: identity.puesto }],
    }));
    setModal(null);
  }

  function reportarProblema(tipo) {
    updateLote(lote.id, (l) => ({
      ...l,
      problemas: [...l.problemas, { ts: nowISO(), etapa: l.etapas[l.etapaIndex], tipo, activo: true }],
      historial: [...l.historial, { ts: nowISO(), etapa: l.etapas[l.etapaIndex], accion: `Problema: ${tipo}`, por: identity.nombre, puesto: identity.puesto }],
    }));
    setModal(null);
  }

  return (
    <div className="fq-worker">
      <div className="fq-worker-idbar">
        <span>👤 {identity.nombre} · {identity.puesto} · {identity.zona}</span>
        <button onClick={() => setIdentity(null)}>Cambiar</button>
      </div>
      <button className="fq-back" onClick={() => setScannedId(null)}>← Volver a escanear</button>

      <div className="fq-work-card">
        <div className="fq-work-photo">
          <span>{lote.producto.slice(0, 1)}</span>
        </div>
        <div className="fq-work-info">
          <span className="fq-work-id">{lote.id}</span>
          <h2>{lote.producto}</h2>
          <p>{lote.color} · {lote.talla} · {lote.cantidad} pzas</p>
        </div>
      </div>

      <div className="fq-work-etapa">
        <span className="fq-work-etapa-label">Etapa actual</span>
        <span className="fq-work-etapa-name">{etapaActual}</span>
      </div>

      <p className="fq-work-instr">{INSTRUCCIONES[etapaActual] || "Sigue el procedimiento estándar de esta etapa."}</p>

      <div className="fq-work-actions">
        {!lote.enProgreso ? (
          <button className="fq-btn fq-btn-huge fq-btn-primary" onClick={iniciar}>
            <Icon.Play s={22} /> Iniciar trabajo
          </button>
        ) : (
          <button className="fq-btn fq-btn-huge fq-btn-success" onClick={terminar}>
            <Icon.Check s={22} /> {esUltima ? "Terminé — cerrar lote" : "Terminé"}
          </button>
        )}
        <div className="fq-work-secondary">
          <button className="fq-btn fq-btn-outline" onClick={() => setModal("defecto")}>
            <Icon.Alert s={18} /> Reportar defecto
          </button>
          <button className="fq-btn fq-btn-outline" onClick={() => setModal("problema")}>
            ⚠ Problema rápido
          </button>
        </div>
        <button className="fq-btn fq-btn-ghost fq-work-photo-btn" disabled>
          <Icon.Camera s={18} /> Tomar foto (demo)
        </button>
      </div>

      {modal === "defecto" && (
        <QuickModal title="Reportar defecto" onClose={() => setModal(null)}>
          <DefectoForm onSubmit={reportarDefecto} maquinas={maquinas.filter((m) => m.zona === identity.zona)} />
        </QuickModal>
      )}
      {modal === "problema" && (
        <QuickModal title="Problema rápido" onClose={() => setModal(null)}>
          <div className="fq-quick-grid">
            {TIPOS_PROBLEMA.map((t) => (
              <button key={t} className="fq-quick-opt" onClick={() => reportarProblema(t)}>
                {t}
              </button>
            ))}
          </div>
        </QuickModal>
      )}
      {modal === "finalizar" && (
        <QuickModal title="Finalizar y entregar lote" onClose={() => setModal(null)}>
          <FinalizarForm defaultEmpresa={lote.cliente !== "—" ? lote.cliente : ""} onSubmit={confirmarEntrega} />
        </QuickModal>
      )}
    </div>
  );
}

function WorkerIdentityScreen({ onSubmit }) {
  const [nombre, setNombre] = useState("");
  const [puesto, setPuesto] = useState("");
  const [zona, setZona] = useState(ZONAS[0]);

  const canSubmit = nombre.trim() && puesto.trim();

  return (
    <div className="fq-worker">
      <div className="fq-scan-hero">
        <Icon.Scan s={36} />
        <h2>¿Quién eres?</h2>
        <p>Ingresa tu nombre, tu puesto y tu área de trabajo para empezar a escanear lotes.</p>
      </div>
      <label className="fq-field">
        <span>Tu nombre</span>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Juan Pérez" />
      </label>
      <label className="fq-field" style={{ marginTop: 10 }}>
        <span>Tu puesto</span>
        <input value={puesto} onChange={(e) => setPuesto(e.target.value)} placeholder="Ej. Cortador, Costurero, Montador…" />
      </label>
      <label className="fq-field" style={{ marginTop: 10 }}>
        <span>Tu área / zona</span>
        <div className="fq-zona-chips">
          {ZONAS.map((z) => (
            <button
              key={z}
              type="button"
              className={"fq-zona-chip" + (zona === z ? " is-active" : "")}
              onClick={() => setZona(z)}
            >
              {z}
            </button>
          ))}
        </div>
      </label>
      <button
        className="fq-btn fq-btn-primary fq-btn-huge"
        style={{ marginTop: 16 }}
        disabled={!canSubmit}
        onClick={() => onSubmit(nombre.trim(), zona, puesto.trim())}
      >
        Entrar
      </button>
    </div>
  );
}

function FinalizarForm({ defaultEmpresa, onSubmit }) {
  const [empresa, setEmpresa] = useState(defaultEmpresa || "");
  return (
    <div>
      <p className="fq-form-hint" style={{ margin: "0 0 10px" }}>
        Este lote terminó su última etapa. Indica la empresa a la que se le presentará esta entrega.
      </p>
      <label className="fq-field">
        <span>Empresa a la que se presentará</span>
        <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Nombre de la empresa" />
      </label>
      <button
        className="fq-btn fq-btn-primary fq-btn-huge"
        style={{ marginTop: 12 }}
        disabled={!empresa}
        onClick={() => onSubmit(empresa)}
      >
        Confirmar entrega
      </button>
    </div>
  );
}

function DefectoForm({ onSubmit, maquinas }) {
  const [motivo, setMotivo] = useState(MOTIVOS_DEFECTO[0]);
  const [cantidad, setCantidad] = useState(1);
  const [maquinaId, setMaquinaId] = useState("");
  return (
    <div>
      <div className="fq-quick-grid">
        {MOTIVOS_DEFECTO.map((m) => (
          <button
            key={m}
            className={"fq-quick-opt" + (motivo === m ? " is-selected" : "")}
            onClick={() => setMotivo(m)}
          >
            {m}
          </button>
        ))}
      </div>
      <label className="fq-field" style={{ marginTop: 14 }}>
        <span>Piezas afectadas</span>
        <input type="number" min="1" value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} />
      </label>
      {maquinas && maquinas.length > 0 && (
        <label className="fq-field" style={{ marginTop: 10 }}>
          <span>¿En qué máquina? (opcional)</span>
          <select value={maquinaId} onChange={(e) => setMaquinaId(e.target.value)}>
            <option value="">No aplica / no sé</option>
            {maquinas.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
        </label>
      )}
      <button className="fq-btn fq-btn-primary fq-btn-huge" style={{ marginTop: 12 }} onClick={() => onSubmit(motivo, cantidad, maquinaId)}>
        Enviar reporte
      </button>
    </div>
  );
}

function QuickModal({ title, onClose, children }) {
  return (
    <div className="fq-modal-overlay" onClick={onClose}>
      <div className="fq-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fq-modal-head">
          <h3>{title}</h3>
          <button className="fq-modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------- styles -------------------------------- */
function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

      .fq-root{
        --graphite:#1C1F24; --graphite-2:#262B33; --concrete:#EEF0F2; --concrete-2:#E1E5E8;
        --steel:#3E5C76; --amber:#F2A93B; --red:#D6483E; --green:#4C9A6A; --ink:#14171A; --line:#CBD1D6;
        font-family:'Inter',sans-serif; color:var(--ink); background:var(--concrete);
        min-height:100vh; display:flex; flex-direction:column;
      }
      .fq-root *{ box-sizing:border-box; }
      .fq-main{ flex:1; padding:16px; max-width:960px; margin:0 auto; width:100%; }
      .fq-loading{ padding:60px 0; text-align:center; color:#6b7280; font-family:'IBM Plex Mono',monospace; }

      /* topbar */
      .fq-topbar{
        background:var(--graphite); color:#fff; display:flex; align-items:center; justify-content:space-between;
        padding:12px 16px; flex-wrap:wrap; gap:10px; position:sticky; top:0; z-index:20;
        border-bottom:3px solid var(--amber);
      }
      .fq-brand{ display:flex; align-items:center; gap:10px; }
      .fq-brand-mark{
        font-family:'Archivo',sans-serif; font-weight:900; background:var(--amber); color:var(--graphite);
        width:34px; height:34px; display:flex; align-items:center; justify-content:center; border-radius:6px; font-size:15px;
      }
      .fq-brand-text{ display:flex; flex-direction:column; line-height:1.1; }
      .fq-brand-name{ font-family:'Archivo',sans-serif; font-weight:800; font-size:17px; letter-spacing:0.02em; }
      .fq-brand-sub{ font-size:10.5px; color:#a9b3bd; text-transform:uppercase; letter-spacing:0.08em; }

      .fq-switch{ display:flex; background:var(--graphite-2); border-radius:999px; padding:3px; }
      .fq-switch-btn{
        border:none; background:transparent; color:#a9b3bd; padding:7px 14px; border-radius:999px;
        font-family:'Inter',sans-serif; font-weight:600; font-size:13px; cursor:pointer; transition:all .15s;
      }
      .fq-switch-btn.is-active{ background:var(--amber); color:var(--graphite); }
      .fq-save-warn{ font-size:11.5px; color:var(--amber); font-family:'IBM Plex Mono',monospace; }
      .fq-topbar-exit{ background:var(--graphite-2); border:none; color:#a9b3bd; width:32px; height:32px; border-radius:8px; cursor:pointer; font-size:15px; }
      .fq-role-locked{ background:var(--amber); color:var(--graphite); font-weight:700; font-size:13px; padding:6px 16px; border-radius:999px; }
      .fq-topbar-exit:hover{ color:#fff; }

      /* registro de empresa */
      .fq-register-wrap{ min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; background:var(--concrete); }
      .fq-register-card{ background:#fff; border-radius:16px; padding:26px 22px; width:100%; max-width:380px; border:1px solid var(--line); }
      .fq-register-title{ font-family:'Archivo',sans-serif; font-weight:800; font-size:20px; margin:0 0 6px; }
      .fq-register-sub{ font-size:13px; color:#6b7280; margin:0; line-height:1.4; }
      .fq-register-error{ font-size:12.5px; color:var(--red); font-weight:600; margin:10px 0 0; }
      .fq-register-owner-link{
        display:block; width:100%; text-align:center; background:none; border:none; color:#9aa2ab;
        font-size:12px; margin-top:18px; cursor:pointer; text-decoration:underline;
      }
      .fq-register-owner-box{ display:flex; gap:6px; margin-top:10px; }
      .fq-register-owner-box input{
        flex:1; padding:8px 10px; border-radius:7px; border:1.5px solid var(--line); font-size:13px;
      }

      /* panel propietario */
      .fq-invite-list{ display:flex; flex-direction:column; gap:8px; }
      .fq-invite-row{
        display:flex; justify-content:space-between; align-items:center; background:#fff; border:1px solid var(--line);
        border-radius:10px; padding:10px 14px; font-size:13px;
      }
      .fq-invite-code{ font-family:'IBM Plex Mono',monospace; font-weight:600; letter-spacing:0.04em; }
      .fq-empresa-actions{ display:flex; align-items:center; gap:8px; flex-shrink:0; }
      .fq-suspended-card{ border-top:4px solid var(--red); }

      /* buttons */
      .fq-btn{
        font-family:'Inter',sans-serif; font-weight:600; border-radius:8px; border:1.5px solid transparent;
        padding:10px 16px; font-size:14px; cursor:pointer; display:inline-flex; align-items:center; gap:8px;
        justify-content:center; transition:transform .05s ease, filter .15s;
      }
      .fq-btn:active{ transform:scale(0.98); }
      .fq-btn:disabled{ opacity:0.45; cursor:not-allowed; }
      .fq-btn-primary{ background:var(--amber); color:var(--graphite); }
      .fq-btn-primary:hover:not(:disabled){ filter:brightness(1.05); }
      .fq-btn-success{ background:var(--green); color:#fff; }
      .fq-btn-ghost{ background:transparent; border-color:var(--line); color:var(--ink); }
      .fq-btn-outline{ background:#fff; border-color:var(--line); color:var(--ink); }
      .fq-btn-tiny{ font-size:12px; padding:5px 10px; background:var(--graphite); color:#fff; }
      .fq-btn-huge{ width:100%; padding:18px; font-size:16px; font-weight:700; border-radius:12px; }

      /* admin stats */
      .fq-stats{ display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:20px; }
      .fq-stat{ background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:2px; border-left:4px solid var(--steel); }
      .fq-stat-red{ border-left-color:var(--red); }
      .fq-stat-amber{ border-left-color:var(--amber); }
      .fq-stat-value{ font-family:'Archivo',sans-serif; font-weight:800; font-size:26px; }
      .fq-stat-label{ font-size:11.5px; color:#6b7280; text-transform:uppercase; letter-spacing:0.04em; }

      .fq-admin-toolbar{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
      .fq-section-title{ font-family:'Archivo',sans-serif; font-weight:800; font-size:18px; }

      .fq-lote-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:12px; }
      .fq-lote-card{
        text-align:left; background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px;
        cursor:pointer; display:flex; flex-direction:column; gap:8px; font-family:inherit;
      }
      .fq-lote-card:hover{ border-color:var(--steel); }
      .fq-lote-card-top{ display:flex; justify-content:space-between; align-items:center; }
      .fq-lote-id{ font-family:'IBM Plex Mono',monospace; font-weight:500; font-size:13px; color:#6b7280; }
      .fq-badge{ font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:.03em; }
      .fq-prio-alta{ background:#FDE8E6; color:var(--red); }
      .fq-prio-media{ background:#FCEFD6; color:#9a6b1a; }
      .fq-prio-baja{ background:#E7F0EB; color:var(--green); }
      .fq-lote-nombre{ font-family:'Archivo',sans-serif; font-weight:800; font-size:16px; margin:0; }
      .fq-lote-meta{ font-size:12.5px; color:#6b7280; margin:0; }
      .fq-progress{ height:6px; background:var(--concrete-2); border-radius:999px; overflow:hidden; }
      .fq-progress-fill{ height:100%; background:var(--steel); }
      .fq-lote-card-bottom{ display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
      .fq-etapa-tag{ font-size:11.5px; font-weight:600; background:var(--concrete); padding:3px 9px; border-radius:6px; }
      .fq-etapa-tag.is-done{ background:#E7F0EB; color:var(--green); }
      .fq-flag{ font-size:11px; font-weight:700; padding:3px 8px; border-radius:6px; }
      .fq-flag-red{ background:var(--red); color:#fff; }
      .fq-flag-amber{ background:var(--amber); color:var(--graphite); }

      /* modal */
      .fq-modal-overlay{ position:fixed; inset:0; background:rgba(20,23,26,0.55); display:flex; align-items:flex-end; justify-content:center; z-index:50; padding:0; }
      .fq-modal{ background:#fff; width:100%; max-width:480px; max-height:92vh; overflow-y:auto; border-radius:16px 16px 0 0; padding:18px; }
      .fq-modal-wide{ max-width:640px; }
      @media (min-width:640px){ .fq-modal-overlay{ align-items:center; } .fq-modal{ border-radius:16px; } }
      .fq-modal-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
      .fq-modal-head h3{ font-family:'Archivo',sans-serif; font-weight:800; font-size:17px; margin:0; }
      .fq-modal-close{ background:var(--concrete); border:none; border-radius:8px; width:30px; height:30px; cursor:pointer; font-size:14px; }

      .fq-form-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      .fq-field{ display:flex; flex-direction:column; gap:4px; font-size:12.5px; font-weight:600; color:#4b5563; }
      .fq-field input, .fq-field select{
        font-family:'Inter',sans-serif; padding:9px 10px; border-radius:7px; border:1.5px solid var(--line); font-size:14px; color:var(--ink);
      }
      .fq-field input:focus, .fq-field select:focus{ outline:2px solid var(--steel); outline-offset:1px; }
      .fq-form-hint{ font-size:12px; color:#6b7280; margin:10px 0 0; font-family:'IBM Plex Mono',monospace; }
      .fq-modal-actions{ display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }

      /* lot tag (signature element) */
      .fq-detail-layout{ display:flex; gap:18px; flex-wrap:wrap; }
      .fq-tag{
        width:200px; border:1.5px dashed #b8bfc5; border-radius:10px; padding:14px; position:relative;
        background:repeating-linear-gradient(135deg, #fff, #fff 10px, #fbfbfc 10px, #fbfbfc 20px);
        display:flex; flex-direction:column; align-items:center; gap:8px; flex-shrink:0;
      }
      .fq-tag-qr{ background:#fff; padding:6px; border-radius:6px; border:1px solid var(--line); }
      .fq-tag-qr img{ display:block; }
      .fq-tag-info{ text-align:center; display:flex; flex-direction:column; gap:2px; }
      .fq-tag-id{ font-family:'IBM Plex Mono',monospace; font-weight:600; font-size:13px; letter-spacing:.05em; }
      .fq-tag-line{ font-size:11.5px; color:#4b5563; }
      .fq-tag-dl{ width:100%; margin-top:4px; font-size:12.5px; padding:8px; }
      .fq-tag-actions{ display:flex; flex-direction:column; gap:6px; width:100%; }

      .fq-tag-method-switch{ display:flex; gap:4px; background:#fff; border:1px solid var(--line); border-radius:999px; padding:2px; }
      .fq-tag-method-btn{ border:none; background:transparent; font-size:11.5px; font-weight:700; padding:4px 12px; border-radius:999px; cursor:pointer; color:#6b7280; }
      .fq-tag-method-btn.is-active{ background:var(--graphite); color:#fff; }

      .fq-tag-foto{ width:140px; height:140px; object-fit:cover; border-radius:6px; border:1px solid var(--line); background:#fff; }
      .fq-tag-foto-empty{
        width:140px; height:140px; border-radius:6px; border:1.5px dashed var(--line); background:#fff;
        display:flex; align-items:center; justify-content:center; text-align:center; font-size:11.5px; color:#9aa2ab; padding:8px;
      }

      .fq-foto-upload{ display:flex; flex-direction:column; align-items:flex-start; gap:8px; margin-top:8px; }
      .fq-foto-preview{ width:100px; height:100px; object-fit:cover; border-radius:8px; border:1px solid var(--line); }
      .fq-foto-btn{ cursor:pointer; font-size:12.5px; padding:8px 12px; }

      @media print{
        body *{ visibility:hidden; }
        .fq-tag, .fq-tag *{ visibility:visible; }
        .fq-tag{ position:fixed; top:20px; left:20px; background:#fff; }
        .fq-tag-method-switch, .fq-tag-actions{ display:none !important; }
      }

      .fq-detail-right{ flex:1; min-width:240px; display:flex; flex-direction:column; gap:16px; }
      .fq-etapa-track{ display:flex; flex-direction:column; gap:0; }
      .fq-etapa-step{ display:flex; align-items:center; gap:10px; padding:5px 0; color:#9aa2ab; font-size:13.5px; font-weight:600; }
      .fq-etapa-dot{ width:10px; height:10px; border-radius:50%; background:#d7dbdf; flex-shrink:0; }
      .fq-etapa-step.is-done{ color:var(--green); }
      .fq-etapa-step.is-done .fq-etapa-dot{ background:var(--green); }
      .fq-etapa-step.is-current{ color:var(--graphite); }
      .fq-etapa-step.is-current .fq-etapa-dot{ background:var(--amber); box-shadow:0 0 0 4px #F2A93B33; }

      .fq-alert-box{ background:#FDF3E9; border:1px solid var(--amber); border-radius:10px; padding:10px 12px; font-size:13px; }
      .fq-alert-box strong{ display:block; margin-bottom:6px; font-family:'Archivo',sans-serif; font-size:13px; }
      .fq-alert-row{ display:flex; justify-content:space-between; align-items:center; gap:8px; padding:4px 0; color:#7a4b12; }

      .fq-hist h4{ font-family:'Archivo',sans-serif; font-size:13.5px; margin:0 0 6px; color:#4b5563; }
      .fq-hist ul{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:5px; }
      .fq-hist li{ display:flex; gap:10px; font-size:12.5px; color:var(--ink); }
      .fq-hist-time{ font-family:'IBM Plex Mono',monospace; color:#9aa2ab; flex-shrink:0; width:98px; }
      .fq-hist em{ color:#9aa2ab; font-style:normal; }

      /* worker */
      .fq-worker{ display:flex; flex-direction:column; gap:14px; max-width:420px; margin:0 auto; }
      .fq-scan-hero{ text-align:center; color:var(--graphite); padding:30px 10px 6px; display:flex; flex-direction:column; align-items:center; gap:6px; }
      .fq-scan-hero h2{ font-family:'Archivo',sans-serif; font-size:20px; margin:4px 0 0; }
      .fq-scan-hero p{ font-size:13px; color:#6b7280; max-width:280px; margin:0; }
      .fq-scan-list{ display:flex; flex-direction:column; gap:8px; }
      .fq-scan-item{
        background:#fff; border:1.5px solid var(--line); border-radius:10px; padding:14px; display:flex;
        flex-direction:column; gap:2px; text-align:left; cursor:pointer; font-family:inherit;
      }
      .fq-scan-item:active{ border-color:var(--amber); }
      .fq-scan-item-id{ font-family:'IBM Plex Mono',monospace; font-size:11.5px; color:#9aa2ab; }
      .fq-scan-item-name{ font-family:'Archivo',sans-serif; font-weight:700; font-size:15px; }
      .fq-scan-item-etapa{ font-size:12px; color:var(--steel); font-weight:600; }
      .fq-empty{ text-align:center; color:#9aa2ab; font-size:13px; padding:20px; }

      .fq-back{ background:none; border:none; color:var(--steel); font-weight:600; font-size:13px; cursor:pointer; align-self:flex-start; padding:4px 0; }

      .fq-worker-idbar{
        display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#6b7280;
        background:#fff; border:1px solid var(--line); border-radius:9px; padding:8px 12px; margin-bottom:2px;
      }
      .fq-worker-idbar button{ background:none; border:none; color:var(--steel); font-weight:700; font-size:12px; cursor:pointer; }

      .fq-work-card{ display:flex; gap:12px; align-items:center; background:var(--graphite); color:#fff; border-radius:14px; padding:16px; }
      .fq-work-photo{
        width:56px; height:56px; border-radius:10px; background:var(--amber); color:var(--graphite); flex-shrink:0;
        display:flex; align-items:center; justify-content:center; font-family:'Archivo',sans-serif; font-weight:900; font-size:22px;
      }
      .fq-work-id{ font-family:'IBM Plex Mono',monospace; font-size:11px; color:#a9b3bd; }
      .fq-work-info h2{ font-family:'Archivo',sans-serif; font-size:18px; margin:2px 0; }
      .fq-work-info p{ font-size:12.5px; color:#c3cad1; margin:0; }

      .fq-work-etapa{ display:flex; justify-content:space-between; align-items:center; background:#fff; border:1.5px solid var(--line); border-radius:10px; padding:12px 14px; }
      .fq-work-etapa-label{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#9aa2ab; }
      .fq-work-etapa-name{ font-family:'Archivo',sans-serif; font-weight:800; font-size:17px; color:var(--graphite); }

      .fq-work-instr{ font-size:14px; color:#374151; background:#fff; border-radius:10px; padding:14px; border:1px solid var(--line); line-height:1.5; margin:0; }

      .fq-work-actions{ display:flex; flex-direction:column; gap:10px; }
      .fq-work-secondary{ display:flex; gap:8px; }
      .fq-work-secondary .fq-btn{ flex:1; }
      .fq-work-photo-btn{ opacity:0.55; }

      .fq-quick-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .fq-quick-opt{
        border:1.5px solid var(--line); background:#fff; border-radius:9px; padding:12px 10px; font-size:13px;
        font-weight:600; cursor:pointer; text-align:left;
      }
      .fq-quick-opt.is-selected{ border-color:var(--amber); background:#FDF3E9; }

      /* supervisor */
      .fq-zona-picker{ display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
      .fq-zona-picker-label{ font-size:12.5px; color:#6b7280; font-weight:600; }
      .fq-zona-chips{ display:flex; gap:6px; }
      .fq-zona-chip{ border:1.5px solid var(--line); background:#fff; border-radius:999px; padding:6px 14px; font-size:13px; font-weight:600; cursor:pointer; }
      .fq-zona-chip.is-active{ background:var(--graphite); color:#fff; border-color:var(--graphite); }

      .fq-pending-list{ display:flex; flex-direction:column; gap:8px; margin-bottom:20px; }
      .fq-pending-row{
        display:flex; justify-content:space-between; align-items:center; gap:10px; background:#FDF3E9;
        border:1px solid var(--amber); border-radius:10px; padding:10px 14px; font-size:13px; flex-wrap:wrap;
      }
      .fq-pending-time{ font-family:'IBM Plex Mono',monospace; font-size:11px; color:#9a7a3e; margin-top:2px; }
      .fq-pending-actions{ display:flex; gap:6px; flex-shrink:0; }
      .fq-btn-reject{ background:#fff; border:1.5px solid var(--red); color:var(--red); }

      .fq-defstatus{ font-size:10.5px; font-weight:700; padding:1px 7px; border-radius:999px; text-transform:uppercase; }
      .fq-defstatus-pendiente{ background:#FCEFD6; color:#9a6b1a; }
      .fq-defstatus-aprobado{ background:#E7F0EB; color:var(--green); }
      .fq-defstatus-rechazado{ background:#FDE8E6; color:var(--red); }

      .fq-sup-card-wrap{ display:flex; flex-direction:column; gap:6px; }
      .fq-reassign{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:11.5px; color:#6b7280; padding:0 2px; }

      /* subtabs */
      .fq-subtabs{ display:flex; gap:4px; border-bottom:1.5px solid var(--line); margin-bottom:16px; }
      .fq-subtab{
        background:none; border:none; padding:9px 4px; margin-right:16px; font-family:'Inter',sans-serif; font-weight:600;
        font-size:13.5px; color:#9aa2ab; cursor:pointer; border-bottom:2.5px solid transparent; display:flex; align-items:center; gap:5px;
      }
      .fq-subtab.is-active{ color:var(--graphite); border-bottom-color:var(--amber); }
      .fq-subtab-dot{ width:6px; height:6px; border-radius:50%; background:var(--red); display:inline-block; }

      /* pendientes / sin reportar */
      .fq-pend-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin-bottom:8px; }
      .fq-pend-card{
        text-align:left; background:#fff; border:1.5px solid #F0C48A; border-left:4px solid var(--amber); border-radius:12px;
        padding:14px; cursor:pointer; display:flex; flex-direction:column; gap:6px; font-family:inherit;
      }
      .fq-pend-card-head{ display:flex; justify-content:space-between; align-items:center; }
      .fq-pend-card h4{ font-family:'Archivo',sans-serif; font-weight:800; font-size:15px; margin:0; }
      .fq-pend-etapa{ font-size:12.5px; color:#4b5563; margin:0; }
      .fq-pend-worker{ font-size:12px; color:#6b7280; margin:0; }
      .fq-pend-flags{ display:flex; gap:6px; flex-wrap:wrap; margin-top:4px; }
      .fq-badge-zona{ background:var(--concrete); color:#4b5563; }

      /* roster de personal */
      .fq-roster-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; }
      .fq-roster-zona{ background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:6px; }
      .fq-roster-zona-name{ font-family:'Archivo',sans-serif; font-weight:800; font-size:13px; margin-bottom:2px; }
      .fq-roster-row{ display:flex; justify-content:space-between; align-items:center; font-size:12.5px; padding:5px 8px; border-radius:7px; }
      .fq-roster-row.reporto{ background:#E7F0EB; color:var(--green); }
      .fq-roster-row.no-reporto{ background:#FDE8E6; color:var(--red); }
      .fq-roster-status{ font-weight:700; font-size:11px; }

      /* terminados */
      .fq-flag-green{ background:var(--green); color:#fff; }
      .fq-done-card{ background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:5px; }
      .fq-done-card-top{ display:flex; justify-content:space-between; align-items:center; }
      .fq-done-card h4{ font-family:'Archivo',sans-serif; font-weight:800; font-size:15px; margin:0; }
      .fq-done-empresa{ font-size:12.5px; color:var(--graphite); margin:0; }
      .fq-done-duracion{ font-size:12px; color:var(--steel); font-weight:600; margin:2px 0 0; }
      .fq-done-fecha{ font-family:'IBM Plex Mono',monospace; font-size:11px; color:#9aa2ab; margin:0; }
      .fq-view-done-btn{ margin:0 0 4px; }

      /* meta vs real */
      .fq-meta-block{ background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:18px; }
      .fq-meta-title{ font-family:'Archivo',sans-serif; font-weight:800; font-size:14px; margin:0 0 4px; }
      .fq-meta-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; }
      .fq-meta-card{ display:flex; flex-direction:column; gap:6px; }
      .fq-meta-card-top{ display:flex; justify-content:space-between; font-size:12.5px; font-weight:600; }
      .fq-meta-numbers{ font-family:'IBM Plex Mono',monospace; color:#6b7280; }

      /* paros por causa */
      .fq-causa-list{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px; }
      .fq-causa-chip{ background:#FDE8E6; color:var(--red); font-size:11.5px; font-weight:700; padding:4px 10px; border-radius:999px; }

      /* máquinas */
      .fq-maquina-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px; margin-bottom:8px; }
      .fq-maquina-card{ background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:8px; }
      .fq-maquina-top{ display:flex; justify-content:space-between; align-items:center; font-family:'Archivo',sans-serif; font-size:14.5px; }
      .fq-maquina-estados{ display:flex; flex-wrap:wrap; gap:5px; }
      .fq-estado-chip{ font-size:11px; font-weight:700; padding:4px 9px; border-radius:999px; border:1.5px solid var(--line); background:#fff; color:#6b7280; cursor:pointer; }
      .fq-estado-chip.is-active.fq-estado-operando{ background:var(--green); border-color:var(--green); color:#fff; }
      .fq-estado-chip.is-active.fq-estado-paro{ background:var(--red); border-color:var(--red); color:#fff; }
      .fq-estado-chip.is-active.fq-estado-mantenimiento{ background:var(--amber); border-color:var(--amber); color:var(--graphite); }
      .fq-estado-chip.is-active.fq-estado-fuera_servicio{ background:var(--graphite); border-color:var(--graphite); color:#fff; }
      .fq-maquina-horas{ font-size:12px; color:#4b5563; margin:0; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .fq-maquina-actions{ display:flex; flex-wrap:wrap; gap:6px; }
      .fq-falla-form{ display:flex; gap:6px; margin-top:4px; }
      .fq-falla-form input{ flex:1; padding:7px 9px; border-radius:7px; border:1.5px solid var(--line); font-size:12.5px; }

      /* configuración */
      .fq-config-subtitle{ font-family:'Archivo',sans-serif; font-weight:800; font-size:13.5px; margin:0 0 4px; }

      /* costos */
      .fq-costo-box{ display:flex; flex-direction:column; gap:2px; font-size:12.5px; margin-top:4px; padding-top:8px; border-top:1px dashed var(--line); }
      .fq-costo-desv{ font-size:11px; font-weight:600; }
      .fq-costo-desv.sobre{ color:var(--red); }
      .fq-costo-desv.bajo{ color:var(--green); }
    `}</style>
  );
}

