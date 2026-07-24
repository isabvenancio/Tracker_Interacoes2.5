import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = (supabaseUrl && supabaseKey) 
    ? createClient(supabaseUrl, supabaseKey) 
    : null;

if (!supabase) {
    console.warn('Supabase credentials not found. App will not sync data in real-time until they are configured.');
}

// ===== ADICIONE ESTA FUNÇÃO ABAIXO =====
export function listenToRealtime(onChangeCallback) {
    if (!supabase) return;

    supabase
        .channel('public:projects')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'projects' },
            (payload) => {
                // Apenas executa a atualização no JS (sem dar reload na página!)
                if (typeof onChangeCallback === 'function') {
                    onChangeCallback(payload);
                }
            }
        )
        .subscribe();
}