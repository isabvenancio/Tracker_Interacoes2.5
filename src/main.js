import { db } from './db.js';

/* ==========================================================================
   1. ESTADO CENTRAL — fonte única de verdade
   ========================================================================== */
const State = {
    activeProjects: [],
    archivedProjects: [],

    async load() {
        const all = await db.loadProjects();
        this.activeProjects = all.filter(p => !p.isArchived);
        this.archivedProjects = all.filter(p => p.isArchived);
        
        // If DB is empty, let's load defaults just for preview
        if (all.length === 0) {
            this.activeProjects = defaultActiveProjects();
            this.archivedProjects = defaultArchivedProjects();
            // Salvar defaults no DB (assincronamente)
            this.activeProjects.forEach(p => db.upsertProject(p));
            this.archivedProjects.forEach(p => db.upsertProject(p));
        }
    },

    async saveProject(project) {
        await db.upsertProject(project);
    },

    findById(id) {
        return this.activeProjects.find(p => p.id === id)
            || this.archivedProjects.find(p => p.id === id);
    }
};

/* ==========================================================================
   2. DADOS PADRÃO
   ========================================================================== */
function mkWeekLogs(pattern = [false, false, false, false, false]) {
    const days = ['SEG', 'TER', 'QUA', 'QUI', 'SEX'];
    return days.map((d, i) => ({ day: d, done: pattern[i] || false, confirmed: false }));
}

function defaultActiveProjects() {
    return [
        {
            id: 'p1', name: 'Sistema de Monitoramento',
            priority: 'Alta', type: 'Normal', sector: 'Interno',
            responsibleName: 'Ana Silva', responsibleRole: 'Engenheira de Software', responsibleInitials: 'AS',
            start: '01/05/2026', end: '15/05/2026',
            percent: 75, status: 'Em Andamento', stage: 'Desenvolvimento',
            impediments: 'Aguardando aprovação da infraestrutura',
            sharepointLink: '', previousWeekInteractions: '3/5',
            weekdayLogs: mkWeekLogs([true, false, true, true, false]),
            isArchived: false
        },
        {
            id: 'p2', name: 'Automação de Processos',
            priority: 'Média', type: 'Rápido', sector: 'Interno',
            responsibleName: 'Bruno Costa', responsibleRole: 'Analista QA', responsibleInitials: 'BC',
            start: '28/04/2026', end: '20/05/2026',
            percent: 45, status: 'Em Andamento', stage: 'Testes Integrados',
            impediments: 'Bloqueios do projeto',
            sharepointLink: '', previousWeekInteractions: '2/5',
            weekdayLogs: mkWeekLogs([true, false, true, false, true]),
            isArchived: false
        }
    ];
}

function defaultArchivedProjects() {
    return [
        {
            id: 'pa1', name: 'Migração de Dados Legacy',
            priority: 'Baixa', type: 'Normal', sector: 'Interno',
            responsibleName: 'Fernanda Lima', responsibleRole: 'Analista de BD', responsibleInitials: 'FL',
            start: '15/03/2026', end: '01/04/2026',
            percent: 100, status: 'Concluído', stage: 'Concluído',
            impediments: '', sharepointLink: '', previousWeekInteractions: '0/5',
            weekdayLogs: mkWeekLogs(), isArchived: true
        }
    ];
}

function initials(name) {
    const parts = name.trim().split(' ').filter(Boolean);
    if (parts.length === 0) return 'XX';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function parseDate(str) {
    if (!str) return null;
    const parts = str.split('/');
    if (parts.length === 2) return new Date(new Date().getFullYear(), parseInt(parts[1]) - 1, parseInt(parts[0]));
    if (parts.length === 3) return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    return null;
}

/* ==========================================================================
   3. INSTÂNCIAS DOS GRÁFICOS
   ========================================================================== */
const Charts = {};
const CHART_FONT = "'Inter', sans-serif";
const THEME = {
    primary:  '#1e5adb',
    success:  '#16a34a',
    danger:   '#ef4444',
    gray:     '#64748b',
    warning:  '#f97316',
    grid:     '#f1f5f9',
    text:     '#64748b'
};

function tooltipDefaults() {
    return { backgroundColor: '#1e293b', titleFont: { family: CHART_FONT, size: 12 }, bodyFont: { family: CHART_FONT, size: 12 }, padding: 10, cornerRadius: 6 };
}

function barOpts(extraScales = {}) {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: tooltipDefaults() },
        scales: {
            x: { grid: { color: THEME.grid, drawBorder: false }, ticks: { color: THEME.text, font: { family: CHART_FONT, size: 11 } }, ...extraScales.x },
            y: { grid: { color: THEME.grid, drawBorder: false }, ticks: { color: THEME.text, font: { family: CHART_FONT, size: 11 } }, ...extraScales.y }
        }
    };
}

function destroyChart(key) {
    if (Charts[key]) { Charts[key].destroy(); delete Charts[key]; }
}

function getProjectColor(p) {
    if (p.status === 'Parado' || p.status === 'Inativo') return THEME.gray;
    const sDate = parseDate(p.start);
    if (!sDate) return THEME.success;
    const days = (new Date() - sDate) / (1000 * 60 * 60 * 24);
    if (p.type === 'Normal') {
        if (days > 60 && p.percent < 50) return THEME.danger;
    } else {
        if (days > 30 && p.percent < 50) return THEME.danger;
    }
    return THEME.success;
}

/* ==========================================================================
   4. MÓDULO PRINCIPAL — App
   ========================================================================== */
window.App = {
    _drawerProjectId: null,
    _activeFilters: { priority: '', type: '', status: '', sector: '', search: '' },
    _archFilters:   { priority: '', sector: '', search: '' },
    _currentTab: 'dashboard',

    async init() {
        await State.load();
        
        // Supabase Realtime setup
        db.subscribeToChanges(async (payload) => {
            await State.load();
            this.render();
            // Re-render drawer if open and affected
            if (this._drawerProjectId) {
                const p = State.findById(this._drawerProjectId);
                if (p) this._fillDrawer(p);
            }
        });

        this._bindTabs();
        this._bindFilters();
        this._bindQuickAdd();
        this._bindModal();
        this._bindDrawer();
        this._bindCollapsibles();
        this._bindResetWeek();
        lucide.createIcons();
        this.render();
    },

    render() {
        this._renderKPIs();
        this._renderAlerts();
        this._renderTables();
        this._renderCharts();
        this._renderDashboardImpediments();
        lucide.createIcons();
    },

    _renderKPIs() {
        const active = State.activeProjects;
        const archived = State.archivedProjects;

        let totalInteractions = 0;
        let totalConfirmed = 0;
        active.forEach(p => {
            p.weekdayLogs.forEach(l => {
                if (l.done) totalInteractions++;
                if (l.confirmed) totalConfirmed++;
            });
        });

        // TAXA DE INTERAÇÃO (Respostas / Interações Feitas)
        const rate = totalInteractions > 0
            ? Math.round((totalConfirmed / totalInteractions) * 100)
            : 0;

        document.getElementById('kpi-active-projects').textContent = active.length;
        document.getElementById('kpi-archived-projects').textContent = archived.length;
        document.getElementById('kpi-interactions').textContent = totalInteractions;
        document.getElementById('kpi-replies').textContent = totalConfirmed;
        document.getElementById('kpi-rate').textContent = rate + '%';
    },

    _renderAlerts() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const overdueList = [];
        const noIntList = [];

        State.activeProjects.forEach(p => {
            const endDate = parseDate(p.end);
            if (endDate && endDate < today && p.status !== 'Concluído') {
                overdueList.push(p);
            }
            const hasInteraction = p.weekdayLogs.some(l => l.done);
            if (!hasInteraction) {
                noIntList.push(p);
            }
        });

        this._setAlertDOM('alert-overdue-count', 'alert-overdue-list', overdueList);
        this._setAlertDOM('alert-noint-count', 'alert-noint-list', noIntList);
        
        const el1 = document.getElementById('alert-overdue-count2');
        const el2 = document.getElementById('alert-noint-count2');
        if (el1) el1.textContent = overdueList.length;
        if (el2) el2.textContent = noIntList.length;
    },

    _setAlertDOM(countId, listId, projects) {
        const countEl = document.getElementById(countId);
        const listEl = document.getElementById(listId);
        if (countEl) countEl.textContent = projects.length;
        if (listEl) {
            listEl.innerHTML = projects.map(p =>
                `<a onclick="App.openDrawer('${p.id}')">• ${p.name}</a>`
            ).join('');
        }
    },

    _renderTables() {
        // ---- ATIVOS ----
        const f = this._activeFilters;
        const filteredActive = State.activeProjects.filter(p => {
            if (f.priority && p.priority !== f.priority) return false;
            if (f.type && p.type !== f.type) return false;
            if (f.status && p.status !== f.status) return false;
            if (f.sector && p.sector !== f.sector) return false;
            if (f.search) {
                const q = f.search.toLowerCase();
                if (!p.name.toLowerCase().includes(q) && !p.responsibleName.toLowerCase().includes(q)) return false;
            }
            return true;
        });

        const aInt = filteredActive.filter(p => p.sector === 'Interno');
        const aExt = filteredActive.filter(p => p.sector === 'Externo');

        document.getElementById('count-internos-active').textContent = aInt.length;
        document.getElementById('count-externos-active').textContent = aExt.length;
        this._renderRows(aInt, 'active-internos-body', false);
        this._renderRows(aExt, 'active-externos-body', false);

        const tag = document.getElementById('active-filters-tag');
        if (tag) tag.style.display = Object.values(f).some(v => v !== '') ? 'inline-flex' : 'none';

        // ---- ARQUIVADOS ----
        const af = this._archFilters;
        const filteredArch = State.archivedProjects.filter(p => {
            if (af.priority && p.priority !== af.priority) return false;
            if (af.sector && p.sector !== af.sector) return false;
            if (af.search) {
                const q = af.search.toLowerCase();
                if (!p.name.toLowerCase().includes(q) && !p.responsibleName.toLowerCase().includes(q)) return false;
            }
            return true;
        });

        const archInt = filteredArch.filter(p => p.sector === 'Interno');
        const archExt = filteredArch.filter(p => p.sector === 'Externo');

        document.getElementById('count-internos-archived').textContent = archInt.length;
        document.getElementById('count-externos-archived').textContent = archExt.length;
        this._renderRows(archInt, 'archived-internos-body', true);
        this._renderRows(archExt, 'archived-externos-body', true);
    },

    _renderRows(list, tbodyId, isArchived) {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        tbody.innerHTML = '';

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:22px;color:var(--color-text-muted);">Nenhum projeto encontrado.</td></tr>`;
            return;
        }

        list.forEach(p => {
            const tr = document.createElement('tr');
            const checkedCount = p.weekdayLogs.filter(l => l.done).length;

            const tClass = p.type === 'Rápido' ? 'type-rapido' : p.type === 'Super Rápido' ? 'type-super' : '';
            const typeHTML = p.type !== 'Normal' ? `<span class="project-type-badge ${tClass}">${p.type}</span>` : '';

            const hasImpediment = p.impediments && p.impediments.trim() !== '' && p.impediments.toLowerCase() !== 'nenhum impedimento';
            const impHTML = hasImpediment
                ? `<span class="td-impediments has-block" title="${p.impediments}">${p.impediments}</span>`
                : `<span class="td-impediments no-block">Nenhum Impedimento</span>`;

            const statusOpts = ['Em Andamento', 'Parado', 'Concluído']
                .map(s => `<option value="${s}"${p.status === s ? ' selected' : ''}>${s}</option>`).join('');
                
            const prioOpts = ['Alta', 'Média', 'Baixa']
                .map(s => `<option value="${s}"${p.priority === s ? ' selected' : ''}>${s}</option>`).join('');

            const spIcon = p.sharepointLink
                ? `<button class="btn-row-action action-link" title="Abrir SharePoint" onclick="event.stopPropagation();window.open('${p.sharepointLink}','_blank')"><i data-lucide="external-link"></i></button>`
                : '';

            tr.innerHTML = `
                <td>
                    <div style="font-weight:600;font-size:.8125rem;">${p.name}</div>
                </td>
                <td>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <select class="inline-select" style="width:auto;padding:2px 4px;font-size:0.7rem;" onchange="App.updateField('${p.id}','priority',this.value)" onclick="event.stopPropagation()">
                            ${prioOpts}
                        </select>
                        ${typeHTML}
                    </div>
                </td>
                <td>
                    <div class="td-responsible">
                        <span class="responsible-badge">${p.responsibleInitials}</span>
                        <span style="font-size:.78rem;">${p.responsibleName}</span>
                    </div>
                </td>
                <td class="td-dates">
                    <div>Início: ${p.start}</div>
                    <div style="margin-top:3px;">Fim: ${p.end}</div>
                </td>
                <td>
                    <div class="progress-bar-container">
                        <div class="progress-bar-track">
                            <div class="progress-bar-fill" style="width:${p.percent}%; background:${getProjectColor(p)};"></div>
                        </div>
                        <span style="font-size:.75rem;font-weight:700;min-width:30px;">${p.percent}%</span>
                    </div>
                </td>
                <td>
                    <select class="inline-select" onchange="App.updateField('${p.id}','status',this.value)" onclick="event.stopPropagation()">
                        ${statusOpts}
                    </select>
                </td>
                <td>${impHTML}</td>
                ${p.weekdayLogs.map((log, i) => `
                    <td class="checkbox-cell">
                        <div class="week-checkbox-wrapper">
                            <div class="custom-checkbox ${log.done ? 'checked' : ''}"
                                 onclick="event.stopPropagation();App.toggleCheck('${p.id}',${i})"></div>
                            <span class="response-badge-mini ${log.confirmed ? 'active' : ''}"
                                  onclick="event.stopPropagation();App.toggleConfirm('${p.id}',${i})">R</span>
                        </div>
                    </td>
                `).join('')}
                <td style="font-weight:600;text-align:center;font-size:.78rem;">${checkedCount}/5</td>
                <td>
                    <div class="action-buttons-group">
                        <button class="btn-row-action action-details" title="Detalhes" onclick="event.stopPropagation();App.openDrawer('${p.id}')">
                            <i data-lucide="file-text"></i>
                        </button>
                        ${spIcon}
                        <button class="btn-row-action action-delete" title="Excluir" onclick="event.stopPropagation();App.deleteProject('${p.id}',${isArchived})">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </td>`;

            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => App.openDrawer(p.id));
            tbody.appendChild(tr);
        });
    },

    _renderDashboardImpediments() {
        const tbody = document.getElementById('dashboard-impediments-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const critical = State.activeProjects.filter(p =>
            p.impediments && p.impediments.trim() !== '' &&
            p.impediments.toLowerCase() !== 'nenhum impedimento'
        );

        if (critical.length === 0) {
            tbody.innerHTML = `<tr><td style="padding:18px;text-align:center;color:var(--color-text-muted);">Nenhum impedimento crítico registrado.</td></tr>`;
            return;
        }

        critical.forEach(p => {
            const pClass = p.priority === 'Alta' ? 'badge-alta' : p.priority === 'Baixa' ? 'badge-baixa' : 'badge-media';
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.innerHTML = `
                <td style="width:40%;">
                    <div class="imp-project-name">${p.name}</div>
                    <div class="imp-text">${p.impediments}</div>
                </td>
                <td style="text-align:right;">
                    <span class="project-priority-badge ${pClass} imp-badge">${p.priority}</span>
                </td>`;
            tr.addEventListener('click', () => App.openDrawer(p.id));
            tbody.appendChild(tr);
        });
    },

    _renderCharts() {
        if (this._currentTab === 'dashboard') {
            this._drawDashboardCharts();
        } else if (this._currentTab === 'graficos') {
            this._drawGraficosCharts();
        }
    },

    _drawDashboardCharts() {
        const active = State.activeProjects;

        const inProgress = active.filter(p => p.status === 'Em Andamento').length;
        const paused = active.filter(p => p.status === 'Parado').length;
        const completed = active.filter(p => p.status === 'Concluído').length;

        destroyChart('statusDist');
        const ctxS = document.getElementById('chart-status-distribution');
        if (ctxS) {
            Charts['statusDist'] = new Chart(ctxS, {
                type: 'doughnut',
                data: {
                    labels: ['Em Andamento', 'Parado', 'Concluído'],
                    datasets: [{ data: [inProgress, paused, completed], backgroundColor: [THEME.primary, THEME.gray, THEME.success], borderWidth: 0, hoverOffset: 4 }]
                },
                options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false }, tooltip: tooltipDefaults() } }
            });
            document.getElementById('legend-status').innerHTML = `
                <span class="legend-item"><span class="legend-color color-blue"></span> Em Andamento: ${inProgress}</span>
                <span class="legend-item"><span class="legend-color color-gray"></span> Parado: ${paused}</span>
                <span class="legend-item"><span class="legend-color color-green"></span> Concluído: ${completed}</span>`;
        }

        const internais = active.filter(p => p.sector === 'Interno');
        const externos = active.filter(p => p.sector === 'Externo');
        destroyChart('perfIO');
        const ctxP = document.getElementById('chart-performance-io');
        if (ctxP) {
            Charts['perfIO'] = new Chart(ctxP, {
                type: 'bar',
                data: {
                    labels: ['Projetos Internos', 'Projetos Externos'],
                    datasets: [
                        { label: 'Total', data: [internais.length, externos.length], backgroundColor: THEME.gray, barThickness: 16, borderRadius: 3 },
                        { label: 'Em Andamento', data: [internais.filter(p => p.status==='Em Andamento').length, externos.filter(p => p.status==='Em Andamento').length], backgroundColor: THEME.primary, barThickness: 16, borderRadius: 3 },
                        { label: 'Concluídos', data: [internais.filter(p => p.status==='Concluído').length, externos.filter(p => p.status==='Concluído').length], backgroundColor: THEME.success, barThickness: 16, borderRadius: 3 }
                    ]
                },
                options: { ...barOpts({ x: { max: Math.max(10, active.length) } }), indexAxis: 'y', plugins: { legend: { display: true, position: 'bottom' }, tooltip: tooltipDefaults() } }
            });
        }

        let currentW = 0; active.forEach(p => { currentW += p.weekdayLogs.filter(l => l.done).length; });
        let prevW = 0; active.forEach(p => { prevW += parseInt((p.previousWeekInteractions || '0').split('/')[0]) || 0; });
        destroyChart('interactions');
        const ctxI = document.getElementById('chart-interactions-comparison');
        if (ctxI) {
            Charts['interactions'] = new Chart(ctxI, {
                type: 'bar',
                data: {
                    labels: ['Semana Atual', 'Semana Anterior'],
                    datasets: [{ label: 'Total de Interações', data: [currentW, prevW], backgroundColor: THEME.primary, borderRadius: 4, barThickness: 50 }]
                },
                options: { ...barOpts({ y: { max: Math.max(30, currentW + 5, prevW + 5) } }), plugins: { legend: { display: true, position: 'bottom' }, tooltip: tooltipDefaults() } }
            });
        }

        const avgIntPerc = internais.length ? Math.round(internais.reduce((s, p) => s + p.percent, 0) / internais.length) : 0;
        const avgExtPerc = externos.length ? Math.round(externos.reduce((s, p) => s + p.percent, 0) / externos.length) : 0;
        destroyChart('avgComp');
        const ctxA = document.getElementById('chart-avg-completion');
        if (ctxA) {
            Charts['avgComp'] = new Chart(ctxA, {
                type: 'bar',
                data: {
                    labels: ['Interno', 'Externo'],
                    datasets: [{ label: 'Conclusão %', data: [avgIntPerc, avgExtPerc], backgroundColor: '#10b981', borderRadius: 4, barThickness: 60 }]
                },
                options: { ...barOpts({ y: { max: 100, ticks: { stepSize: 25 } } }), plugins: { legend: { display: true, position: 'bottom' }, tooltip: tooltipDefaults() } }
            });
        }

        const days = ['SEG', 'TER', 'QUA', 'QUI', 'SEX'];
        const interByDay = days.map((_, i) => active.reduce((sum, p) => sum + (p.weekdayLogs[i]?.done ? 1 : 0), 0));
        const confByDay = days.map((_, i) => active.reduce((sum, p) => sum + (p.weekdayLogs[i]?.confirmed ? 1 : 0), 0));
        destroyChart('dailyVol');
        const ctxD = document.getElementById('chart-daily-volume');
        if (ctxD) {
            Charts['dailyVol'] = new Chart(ctxD, {
                type: 'bar',
                data: {
                    labels: days,
                    datasets: [
                        { label: 'Interações', data: interByDay, backgroundColor: THEME.primary, borderRadius: 3, barThickness: 18 },
                        { label: 'Respostas', data: confByDay, backgroundColor: THEME.success, borderRadius: 3, barThickness: 18 }
                    ]
                },
                options: { ...barOpts({ y: { max: Math.max(10, ...interByDay) + 1 } }), plugins: { legend: { display: true, position: 'bottom' }, tooltip: tooltipDefaults() } }
            });
        }
    },

    _drawGraficosCharts() {
        const active = State.activeProjects;

        const labels = active.map(p => p.name.toUpperCase());
        const values = active.map(p => p.percent);
        const colors = active.map(p => getProjectColor(p));

        destroyChart('percentAll');
        const ctxPC = document.getElementById('chart-percent-completed');
        if (ctxPC) {
            Charts['percentAll'] = new Chart(ctxPC, {
                type: 'bar',
                data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 3, barThickness: 16 }] },
                options: barOpts({ x: { ticks: { font: { family: CHART_FONT, size: 8, weight: '600' }, maxRotation: 45, minRotation: 45 } }, y: { max: 100, ticks: { stepSize: 20 } } })
            });
        }

        const stmgo = active.filter(p => p.sector === 'Interno');
        destroyChart('stmgo');
        const ctxST = document.getElementById('chart-stmgo-progress');
        if (ctxST) {
            Charts['stmgo'] = new Chart(ctxST, {
                type: 'bar',
                data: {
                    labels: stmgo.map(p => p.name.substring(0, 15).toUpperCase()),
                    datasets: [{ data: stmgo.map(p => p.percent), backgroundColor: stmgo.map(p => getProjectColor(p)), borderRadius: 3, barThickness: 14 }]
                },
                options: { ...barOpts({ x: { ticks: { font: { family: CHART_FONT, size: 8, weight: '600' }, maxRotation: 45, minRotation: 45 } }, y: { max: 100, ticks: { stepSize: 20 } } }), plugins: { legend: { display: false }, tooltip: { ...tooltipDefaults(), callbacks: { title: (items) => stmgo[items[0].dataIndex]?.name || '', label: (item) => `${item.raw}%` } } } }
            });
        }

        // Renomeado para PROJETOS RÁPIDOS, filtrando por tipo = Rápido ou Super Rápido
        const rapidos = active.filter(p => p.type === 'Rápido' || p.type === 'Super Rápido');
        const rapidosColors = rapidos.map(p => getProjectColor(p));

        destroyChart('lightning');
        const ctxL = document.getElementById('chart-lightning-semaphore');
        if (ctxL) {
            // Update Title if possible, or assume HTML is updated (I will update HTML too)
            Charts['lightning'] = new Chart(ctxL, {
                type: 'bar',
                data: {
                    labels: rapidos.map(p => p.name.substring(0, 15).toUpperCase()),
                    datasets: [{ data: rapidos.map(p => p.percent), backgroundColor: rapidosColors, borderRadius: 3, barThickness: 14 }]
                },
                options: barOpts({ x: { ticks: { font: { family: CHART_FONT, size: 8, weight: '600' }, maxRotation: 45, minRotation: 45 } }, y: { max: 100, ticks: { stepSize: 20 } } })
            });
        }
    },

    toggleCheck(id, dayIndex) {
        const p = State.findById(id);
        if (!p) return;
        p.weekdayLogs[dayIndex].done = !p.weekdayLogs[dayIndex].done;
        if (!p.weekdayLogs[dayIndex].done) p.weekdayLogs[dayIndex].confirmed = false;
        State.saveProject(p);
        this.render();
        if (this._drawerProjectId === id) this._fillDrawer(p);
    },

    toggleConfirm(id, dayIndex) {
        const p = State.findById(id);
        if (!p) return;
        if (!p.weekdayLogs[dayIndex].done) {
            this._toast('Marque a interação antes de confirmar a resposta!');
            return;
        }
        p.weekdayLogs[dayIndex].confirmed = !p.weekdayLogs[dayIndex].confirmed;
        State.saveProject(p);
        this.render();
        if (this._drawerProjectId === id) this._fillDrawer(p);
        if (p.weekdayLogs[dayIndex].confirmed) this._toast(`Resposta confirmada para "${p.name}" na ${p.weekdayLogs[dayIndex].day}!`);
    },

    updateField(id, field, value) {
        const p = State.findById(id);
        if (!p) return;
        if (field === 'percent') {
            p.percent = parseInt(value);
            if (p.percent === 100) p.status = 'Concluído';
        } else {
            p[field] = value;
        }
        State.saveProject(p);
        this.render();
        if (this._drawerProjectId === id) this._fillDrawer(p);
    },

    async deleteProject(id, isArchived) {
        if (!confirm(`Deseja realmente excluir este projeto?`)) return;
        await db.deleteProject(id);
        await State.load();
        this.render();
        this._toast(`Projeto excluído com sucesso.`);
    },

    resetWeek() {
        if (!confirm('Isto arquivará a contagem da semana atual no histórico. Confirmar?')) return;
        State.activeProjects.forEach(p => {
            const done = p.weekdayLogs.filter(l => l.done).length;
            p.previousWeekInteractions = `${done}/5`;
            p.weekdayLogs.forEach(l => { l.done = false; l.confirmed = false; });
            State.saveProject(p);
        });
        this.render();
        this._toast('Semana resetada e arquivada com sucesso!');
    },

    exportPrint() { window.print(); },

    openDrawer(id) {
        const p = State.findById(id);
        if (!p) return;
        this._drawerProjectId = id;
        this._fillDrawer(p);
        document.getElementById('project-drawer-overlay').classList.add('open');
        document.getElementById('project-drawer').classList.add('open');
        document.getElementById('project-drawer').setAttribute('aria-hidden', 'false');
    },

    _fillDrawer(p) {
        document.getElementById('drawer-project-title').textContent = p.name;
        document.getElementById('drawer-start-date').value = p.start || '';
        document.getElementById('drawer-end-date').value = p.end || '';
        document.getElementById('drawer-responsible-name').value = p.responsibleName || '';
        document.getElementById('drawer-responsible-role').value = p.responsibleRole || '';
        document.getElementById('drawer-responsible-avatar').textContent = p.responsibleInitials || '--';
        document.getElementById('drawer-current-stage').value = p.stage || '';
        document.getElementById('drawer-impediments').value = p.impediments || '';
        document.getElementById('drawer-status').value = p.status || 'Em Andamento';
        document.getElementById('drawer-sharepoint-link').value = p.sharepointLink || '';

        // Auto-expand textarea based on content
        const impEl = document.getElementById('drawer-impediments');
        impEl.style.height = 'auto';
        if (impEl.scrollHeight > 50) impEl.style.height = impEl.scrollHeight + 'px';

        const pct = p.percent || 0;
        document.getElementById('drawer-completion-percent').textContent = `${pct}%`;
        document.getElementById('drawer-progress-slider').value = pct;
        document.getElementById('drawer-progress-value').textContent = `${pct}%`;
        const circumference = 2 * Math.PI * 55;
        const ring = document.getElementById('drawer-donut-ring');
        ring.style.strokeDasharray = `${circumference} ${circumference}`;
        ring.style.strokeDashoffset = circumference - (pct / 100) * circumference;
        ring.style.stroke = getProjectColor(p); // Atualiza cor no drawer tbm

        const cnt = p.weekdayLogs.filter(l => l.done).length;
        document.getElementById('drawer-current-week-value').textContent = `Realizadas: ${cnt} de 5`;
        document.getElementById('drawer-previous-week-value').textContent = `Realizadas: ${p.previousWeekInteractions || '0/5'}`;

        const ul = document.getElementById('drawer-weekday-list');
        ul.innerHTML = '';
        p.weekdayLogs.forEach((log, i) => {
            const li = document.createElement('li');
            li.className = 'weekday-item';
            li.innerHTML = `<span class="day-label">${log.day}</span><span class="day-status${log.done ? ' interacted' : ''}">${log.done ? 'Interação realizada' : 'Sem interação'}</span>`;
            li.addEventListener('click', () => App.toggleCheck(p.id, i));
            ul.appendChild(li);
        });

        const badgesEl = document.getElementById('drawer-status-badges');
        let badgeHTML = '';
        if (p.status === 'Concluído') badgeHTML += `<span class="badge badge-success">Concluído</span>`;
        else if (p.status === 'Parado') badgeHTML += `<span class="badge badge-danger">Parado</span>`;
        else badgeHTML += `<span class="badge badge-warning">Em Andamento</span>`;
        badgeHTML += p.sector === 'Externo' ? `<span class="badge badge-purple">Externo</span>` : `<span class="badge badge-gray">Interno</span>`;
        badgeHTML += p.type !== 'Normal' ? `<span class="badge badge-gray">${p.type}</span>` : '';
        badgesEl.innerHTML = badgeHTML;
    },

    _closeDrawer() {
        const id = this._drawerProjectId;
        if (!id) return;
        const p = State.findById(id);
        if (p) {
            p.responsibleName = document.getElementById('drawer-responsible-name').value;
            p.responsibleRole = document.getElementById('drawer-responsible-role').value;
            p.responsibleInitials = initials(p.responsibleName);
            p.start = document.getElementById('drawer-start-date').value;
            p.end = document.getElementById('drawer-end-date').value;
            p.stage = document.getElementById('drawer-current-stage').value;
            p.impediments = document.getElementById('drawer-impediments').value;
            p.status = document.getElementById('drawer-status').value;
            p.sharepointLink = document.getElementById('drawer-sharepoint-link').value;
            p.percent = parseInt(document.getElementById('drawer-progress-slider').value) || 0;
            if (p.percent === 100) p.status = 'Concluído';
            State.saveProject(p);
        }
        this._drawerProjectId = null;
        document.getElementById('project-drawer-overlay').classList.remove('open');
        document.getElementById('project-drawer').classList.remove('open');
        document.getElementById('project-drawer').setAttribute('aria-hidden', 'true');
        this.render();
    },

    _bindDrawer() {
        document.getElementById('btn-close-drawer').addEventListener('click', () => this._closeDrawer());
        document.getElementById('project-drawer-overlay').addEventListener('click', () => this._closeDrawer());
        document.addEventListener('keydown', e => { if (e.key === 'Escape') this._closeDrawer(); });

        const slider = document.getElementById('drawer-progress-slider');
        slider.addEventListener('input', () => {
            const val = parseInt(slider.value);
            document.getElementById('drawer-progress-value').textContent = `${val}%`;
            document.getElementById('drawer-completion-percent').textContent = `${val}%`;
            const circumference = 2 * Math.PI * 55;
            const ring = document.getElementById('drawer-donut-ring');
            ring.style.strokeDashoffset = circumference - (val / 100) * circumference;
        });

        // Auto-expand behavior for textarea
        const impEl = document.getElementById('drawer-impediments');
        impEl.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });

        document.getElementById('btn-sharepoint').addEventListener('click', () => {
            const link = document.getElementById('drawer-sharepoint-link').value.trim();
            if (link) window.open(link, '_blank');
            else this._toast('Nenhum link do SharePoint cadastrado para este projeto.');
        });
        document.getElementById('btn-export-pdf').addEventListener('click', () => {
            this._toast('Exportar PDF: funcionalidade vinculada ao botão Imprimir.');
            window.print();
        });
    },

    _bindModal() {
        const overlay = document.getElementById('new-project-modal-overlay');
        const modal = document.getElementById('new-project-modal');
        const closeBtn = document.getElementById('btn-close-modal');
        const cancelBtn = document.getElementById('btn-cancel-modal');
        const form = document.getElementById('form-new-project');
        const sectorHidden = document.getElementById('form-project-sector');
        const toggleBtns = modal.querySelectorAll('.btn-toggle');

        function open() {
            form.reset();
            document.getElementById('form-initial-stage').value = 'Planejamento';
            sectorHidden.value = 'Interno';
            toggleBtns.forEach(b => b.classList.toggle('active', b.dataset.sector === 'Interno'));
            overlay.classList.add('open');
            modal.classList.add('open');
            modal.setAttribute('aria-hidden', 'false');
        }

        function close() {
            overlay.classList.remove('open');
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
        }

        toggleBtns.forEach(btn => btn.addEventListener('click', () => {
            toggleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            sectorHidden.value = btn.dataset.sector;
        }));

        closeBtn.addEventListener('click', close);
        cancelBtn.addEventListener('click', close);
        overlay.addEventListener('click', close);

        ['btn-open-modal-active', 'btn-open-modal-archived'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', open);
        });

        form.addEventListener('submit', e => {
            e.preventDefault();
            const name = document.getElementById('form-project-name').value.trim();
            const start = document.getElementById('form-start-date').value.trim();
            const end = document.getElementById('form-end-date').value.trim();
            const respName = document.getElementById('form-responsible-name').value.trim();
            const respRole = document.getElementById('form-responsible-role').value.trim();

            if (!name || !start || !end || !respName || !respRole) {
                this._toast('Preencha todos os campos obrigatórios (*).');
                return;
            }

            const rawPriority = document.getElementById('form-priority').value;
            const priority = rawPriority.replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim();

            const newP = {
                id: 'p_' + Date.now(), name, priority: priority || 'Média',
                type: document.getElementById('form-project-type').value,
                sector: sectorHidden.value, responsibleName: respName,
                responsibleRole: respRole, responsibleInitials: initials(respName),
                start, end, percent: 0, status: 'Em Andamento',
                stage: document.getElementById('form-initial-stage').value || 'Planejamento',
                impediments: '', sharepointLink: document.getElementById('form-sharepoint-link').value.trim(),
                previousWeekInteractions: '0/5', weekdayLogs: mkWeekLogs(), isArchived: false
            };

            State.activeProjects.push(newP);
            State.saveProject(newP);
            close();
            this.render();
            this._toast(`Projeto "${name}" criado com sucesso!`);
        });
    },

    _bindQuickAdd() {
        const setupQA = (inputId, btnId) => {
            const input = document.getElementById(inputId);
            const btn = document.getElementById(btnId);
            if (!input || !btn) return;
            const doAdd = () => {
                const name = input.value.trim();
                if (!name) { this._toast('Digite um nome para o projeto!'); return; }
                const newP = {
                    id: 'p_' + Date.now(), name, priority: 'Média', type: 'Normal', sector: 'Interno',
                    responsibleName: 'Sem Responsável', responsibleRole: 'Indefinido', responsibleInitials: 'SR',
                    start: new Date().toLocaleDateString('pt-BR'), end: '--', percent: 0, status: 'Em Andamento', stage: 'Planejamento',
                    impediments: '', sharepointLink: '', previousWeekInteractions: '0/5', weekdayLogs: mkWeekLogs(), isArchived: false
                };
                State.activeProjects.push(newP);
                input.value = '';
                State.saveProject(newP);
                this.render();
                this._toast(`Projeto "${name}" adicionado!`);
            };
            btn.addEventListener('click', doAdd);
            input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
        };
        setupQA('input-quick-add-active', 'btn-quick-add-active');
        setupQA('input-quick-add-archived', 'btn-quick-add-archived');
    },

    _bindFilters() {
        const bind = (id, key, isArch) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => {
                if (isArch) this._archFilters[key] = el.value;
                else this._activeFilters[key] = el.value;
                this._renderTables();
            });
        };

        const bindSearch = (id, key, isArch) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', () => {
                if (isArch) this._archFilters[key] = el.value;
                else this._activeFilters[key] = el.value;
                this._renderTables();
            });
        };

        // Filtros da aba de Projetos Ativos
        bind('filter-priority-active', 'priority', false);
        bind('filter-type-active', 'type', false);
        bind('filter-status-active', 'status', false);
        bind('filter-sector-active', 'sector', false);
        bindSearch('input-search-active', 'search', false);

        // Filtros da aba de Arquivados
        bind('filter-priority-archived', 'priority', true);
        bind('filter-sector-archived', 'sector', true);
        bindSearch('input-search-archived', 'search', true);
    },

    _bindTabs() {
        const tabs = document.querySelectorAll('.tab-btn');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                document.querySelectorAll('.tab-content').forEach(content => {
                    content.classList.remove('active');
                });

                const contentEl = document.getElementById(`tab-${target}`);
                if (contentEl) contentEl.classList.add('active');

                this._currentTab = target;
                this._renderCharts();
            });
        });
    },

    _bindCollapsibles() {
        const headers = document.querySelectorAll('.collapsible-header');
        headers.forEach(header => {
            header.addEventListener('click', () => {
                const isExpanded = header.getAttribute('aria-expanded') === 'true';
                header.setAttribute('aria-expanded', !isExpanded);
            });
        });
    },

    _bindResetWeek() {
        const btn = document.getElementById('btn-reset-week-active');
        if (btn) {
            btn.addEventListener('click', () => this.resetWeek());
        }
    },

    _toast(msg) {
        let toast = document.getElementById('app-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'app-toast';
            toast.style.cssText = `
                position: fixed; bottom: 20px; right: 20px;
                background: #1e293b; color: #fff; padding: 12px 20px;
                border-radius: 8px; font-size: 0.875rem; font-weight: 500;
                box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); z-index: 2000;
                transition: opacity 0.3s ease; opacity: 0; pointer-events: none;
            `;
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.opacity = '1';
        setTimeout(() => { toast.style.opacity = '0'; }, 3000);
    }
};

// ===== INICIALIZAÇÃO DA APLICAÇÃO =====
document.addEventListener('DOMContentLoaded', () => {
    // Analytics Vercel (opcional, pode manter ou remover caso não utilize)
    try { inject(); injectSpeedInsights(); } catch (e) {}

    window.App.init();
});