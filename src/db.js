import { supabase } from './supabase.js';

/**
 * Interface to database. Falls back to localStorage if Supabase is not configured.
 */
export const db = {
    async loadProjects() {
        if (supabase) {
            try {
                const { data, error } = await supabase.from('projects').select('*');
                if (error) throw error;
                return (data || []).map(row => row.metadata);
            } catch (err) {
                console.error("Supabase load error:", err);
                return this.loadLocal();
            }
        }
        return this.loadLocal();
    },

    async upsertProject(project) {
        if (supabase) {
            try {
                const { error } = await supabase.from('projects').upsert({
                    id: project.id,
                    metadata: project
                });
                if (error) throw error;
                return true;
            } catch (err) {
                console.error("Supabase upsert error:", err);
            }
        }
        this.upsertLocal(project);
        return true;
    },

    async deleteProject(id) {
        if (supabase) {
            try {
                const { error } = await supabase.from('projects').delete().eq('id', id);
                if (error) throw error;
                return true;
            } catch (err) {
                console.error("Supabase delete error:", err);
            }
        }
        this.deleteLocal(id);
        return true;
    },

    subscribeToChanges(onUpdate) {
        if (!supabase) return;
        supabase.channel('public:projects')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, payload => {
                console.log('Realtime change received!', payload);
                onUpdate(payload);
            })
            .subscribe();
    },

    // LocalStorage Fallbacks
    loadLocal() {
        const active = localStorage.getItem('gp_active');
        const archived = localStorage.getItem('gp_archived');
        let all = [];
        if (active) all = all.concat(JSON.parse(active));
        if (archived) all = all.concat(JSON.parse(archived));
        return all;
    },

    upsertLocal(project) {
        let active = JSON.parse(localStorage.getItem('gp_active') || '[]');
        let archived = JSON.parse(localStorage.getItem('gp_archived') || '[]');
        
        // Remove from both to avoid duplicates
        active = active.filter(p => p.id !== project.id);
        archived = archived.filter(p => p.id !== project.id);

        if (project.metadata && project.metadata.isArchived) {
            archived.push(project);
        } else {
            active.push(project);
        }

        localStorage.setItem('gp_active', JSON.stringify(active));
        localStorage.setItem('gp_archived', JSON.stringify(archived));
    },

    deleteLocal(id) {
        let active = JSON.parse(localStorage.getItem('gp_active') || '[]');
        let archived = JSON.parse(localStorage.getItem('gp_archived') || '[]');
        active = active.filter(p => p.id !== id);
        archived = archived.filter(p => p.id !== id);
        localStorage.setItem('gp_active', JSON.stringify(active));
        localStorage.setItem('gp_archived', JSON.stringify(archived));
    }
};
