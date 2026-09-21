import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

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

if (typeof window !== "undefined") {
  window.storage = {
    get: storageGet,
    set: storageSet,
  };
}
