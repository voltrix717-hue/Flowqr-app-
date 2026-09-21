// Reemplazo real de window.storage (que solo existe dentro de Claude.ai).
//
// Regla simple:
//  - shared = false -> vive en localStorage de ESE navegador/dispositivo
//    (ej. "a qué empresa pertenece este celular", "quién es este trabajador")
//  - shared = true  -> vive en Supabase, una base de datos Postgres real,
//    para que todos los dispositivos de la misma fábrica vean lo mismo
//    (lotes, empresas registradas, códigos de invitación, máquinas, config)
//
// Esto imita a propósito la forma de window.storage.get/set para que el
// resto de App.jsx casi no tuviera que cambiar.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Revisa tu archivo .env (mira .env.example)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function storageGet(key, shared) {
  if (!shared) {
    const value = localStorage.getItem(key);
    return value ? { key, value, shared: false } : null;
  }
  const { data, error } = await supabase.from("kv_store").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data ? { key, value: data.value, shared: true } : null;
}

export async function storageSet(key, value, shared) {
  if (!shared) {
    localStorage.setItem(key, value);
    return { key, value, shared: false };
  }
  const { error } = await supabase
    .from("kv_store")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
  return { key, value, shared: true };
}

export async function checkOwnerPasscode(candidate) {
  const { data, error } = await supabase.rpc("check_owner_passcode", { candidate });
  if (error) throw error;
  return !!data;
}

if (typeof window !== "undefined") {
  window.storage = {
    get: storageGet,
    set: storageSet,
  };
  window.checkOwnerPasscode = checkOwnerPasscode;
}

  
