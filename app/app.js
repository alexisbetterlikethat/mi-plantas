(function () {
    'use strict';

    // State
    const STATE_KEY = 'plantTracker_completedIds';
    const DATA_KEY = 'plantTracker_customData';
    let completedIds = new Set(JSON.parse(localStorage.getItem(STATE_KEY) || '[]'));

    // Load custom data if it exists, otherwise use the global PLANT_DATA from data.js
    let activePlants = [];
    if (typeof PLANT_DATA !== 'undefined') {
        activePlants = [...PLANT_DATA];
    }
    try {
        const stored = localStorage.getItem(DATA_KEY);
        if (stored) {
            activePlants = JSON.parse(stored);
        }
    } catch (e) { console.error("Error loading custom data", e); }

    let currentView = 'list'; // 'list' or 'calendar'
    let currentTab = 'pending'; // 'pending' or 'completed'

    // Export to Excel
    document.getElementById('btnExport').addEventListener('click', () => {
        exportToExcel();
    });

    // Import Excel
    document.getElementById('fileImport').addEventListener('change', (e) => {
        importFromExcel(e);
    });

    let currentSort = 'date-asc';

    // Filters
    let searchQuery = '';
    let filterStatus = '';
    let filterBin = '';
    let filterDateFrom = '';
    let filterDateTo = '';
    let filterQtyMin = '';
    let filterQtyMax = '';

    // Calendar State
    let currentDate = new Date(); // tracks month being viewed

    // Elements
    const els = {
        viewList: document.getElementById('viewList'),
        viewCalendar: document.getElementById('viewCalendar'),
        listView: document.getElementById('listView'),
        calendarView: document.getElementById('calendarView'),
        tabPending: document.getElementById('tabPending'),
        tabCompleted: document.getElementById('tabCompleted'),
        pendingCount: document.getElementById('pendingCount'),
        completedCount: document.getElementById('completedCount'),
        statsDone: document.getElementById('statsDone'),
        statsTotal: document.getElementById('statsTotal'),
        plantList: document.getElementById('plantList'),
        searchInput: document.getElementById('searchInput'),
        clearSearch: document.getElementById('clearSearch'),
        sortSelect: document.getElementById('sortSelect'),
        filterToggle: document.getElementById('filterToggle'),
        filterPanel: document.getElementById('filterPanel'),
        filterBadge: document.getElementById('filterBadge'),
        filterStatus: document.getElementById('filterStatus'),
        filterBin: document.getElementById('filterBin'),
        filterDateFrom: document.getElementById('filterDateFrom'),
        filterDateTo: document.getElementById('filterDateTo'),
        filterQtyMin: document.getElementById('filterQtyMin'),
        filterQtyMax: document.getElementById('filterQtyMax'),
        filterApply: document.getElementById('filterApply'),
        filterClearAll: document.getElementById('filterClearAll'),
        emptyState: document.getElementById('emptyState'),
        emptyText: document.getElementById('emptyText'),
        calMonth: document.getElementById('calMonth'),
        calDays: document.getElementById('calDays'),
        calPrev: document.getElementById('calPrev'),
        calNext: document.getElementById('calNext'),
        calDetail: document.getElementById('calDetail'),
        calDetailTitle: document.getElementById('calDetailTitle'),
        calDetailList: document.getElementById('calDetailList'),
        toast: document.getElementById('toast'),
        toastMsg: document.getElementById('toastMsg'),
        toastUndo: document.getElementById('toastUndo')
    };

    let toastTimeout;
    let lastAction = null; // { id, type: 'complete'|'restore' }

    // Init
    function init() {
        populateFilterOptions();
        bindEvents();
        render();
    }

    // Populate dynamic filters (e.g. Bin Codes)
    function populateFilterOptions() {
        const bins = new Set();
        activePlants.forEach(p => {
            if (p.binCode) bins.add(p.binCode);
        });
        const sortedBins = Array.from(bins).sort();
        sortedBins.forEach(bin => {
            const opt = document.createElement('option');
            opt.value = bin;
            opt.textContent = bin;
            els.filterBin.appendChild(opt);
        });
    }

    // Helpers
    function saveState() {
        localStorage.setItem(STATE_KEY, JSON.stringify([...completedIds]));
    }

    function getStatus(plant) {
        const todayStr = new Date().toISOString().split('T')[0];
        if (plant.endDate && plant.endDate < todayStr) return 'overdue';
        if (plant.startDate && plant.startDate <= todayStr && plant.endDate && plant.endDate >= todayStr) return 'active';
        return 'upcoming';
    }

    function formatDate(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr + 'T00:00:00'); // avoid timezone offset issues
        if (isNaN(d.getTime())) return isoStr;
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    // --- EXCEL LOGIC ---
    function exportToExcel() {
        if (typeof XLSX === 'undefined') {
            showToast("Error: Librería de Excel no cargada todavía.");
            return;
        }

        // Use currently filtered/visible data (respects 'Completed' tab and search queries)
        const currentData = getFilteredData();

        const exportData = currentData.map(item => ({
            "Plant Description": item.description || '',
            "Quantity": item.quantity || '',
            "Bin Code": item.binCode || '',
            "Prod Order No": item.prodOrderNo || '',
            "Item No": item.itemNo || '',
            "Start Date": item.startDate || '',
            "End Date": item.endDate || ''
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);

        // Auto-sizing columns for visibility
        ws['!cols'] = [
            { wch: 40 }, // Plant Description
            { wch: 10 }, // Quantity
            { wch: 12 }, // Bin Code
            { wch: 15 }, // Prod Order No
            { wch: 12 }, // Item No
            { wch: 15 }, // Start Date
            { wch: 15 }  // End Date
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Export");
        XLSX.writeFile(wb, "PlantTracker_Export.xlsx");

        showToast(`Exportado ${exportData.length} plantas a Excel.`);
    }

    function importFromExcel(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (typeof XLSX === 'undefined') {
            showToast("Error: Librería de Excel no cargada todavía.");
            return;
        }

        const reader = new FileReader();
        reader.onload = function (evt) {
            try {
                const data = evt.target.result;
                const wb = XLSX.read(data, { type: 'binary' });
                const sheetName = wb.SheetNames[0];
                const ws = wb.Sheets[sheetName];
                const rawJson = XLSX.utils.sheet_to_json(ws);

                let addedCount = 0;

                rawJson.forEach(row => {
                    // Try to map properties roughly
                    const description = row['Planta'] || row['Description'] || row['Name'];
                    if (!description) return; // skip if no name

                    const newItem = {
                        id: 'import_' + Date.now() + Math.random().toString(36).substr(2, 5),
                        description: String(description),
                        quantity: row['Cantidad'] || row['Quantity'] || 0,
                        binCode: row['Bin'] || row['Bin Code'] || '',
                        prodOrderNo: row['Orden'] || row['Prod. Order No.'] || '',
                        itemNo: row['Item No'] || row['Item No.'] || '',
                        startDate: row['Fecha Inicio'] || row['Starting Date'] || '',
                        endDate: row['Fecha Fin'] || row['Ending Date'] || '',
                    };

                    activePlants.unshift(newItem); // add to top
                    addedCount++;
                });

                if (addedCount > 0) {
                    try {
                        localStorage.setItem(DATA_KEY, JSON.stringify(activePlants));
                    } catch (e) {
                        console.error('Failed to save to localStorage', e);
                    }
                    render();
                    showToast(`Se importaron ${addedCount} plantas con éxito.`);
                } else {
                    showToast("No se encontraron plantas válidas en el archivo.");
                }
            } catch (error) {
                console.error(error);
                showToast("Error al leer el archivo Excel.");
            }
        };
        reader.readAsBinaryString(file);
        e.target.value = ""; // clear input
    }

    function getStatusLabel(item) {
        const isCompleted = completedIds.has(item.id);
        if (isCompleted) return 'Completada';

        const today = new Date().toISOString().split('T')[0];
        if (item.endDate && item.endDate < today) return 'Vencido';
        if (item.startDate && item.startDate <= today && item.endDate && item.endDate >= today) return 'En progreso';
        return 'Próximo';
    }

    // Data Filtering & Sorting
    function getFilteredData() {
        return activePlants.filter(p => {
            // Tab
            const isCompleted = completedIds.has(p.id);
            if (currentTab === 'pending' && isCompleted) return false;
            if (currentTab === 'completed' && !isCompleted) return false;

            // Search
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const text = `${p.description || ''} ${p.binCode || ''} ${p.prodOrderNo || ''} ${p.itemNo || ''}`.toLowerCase();
                if (!text.includes(q)) return false;
            }

            // Advanced Filters
            if (filterStatus && getStatus(p) !== filterStatus) return false;
            if (filterBin && p.binCode !== filterBin) return false;
            if (filterDateFrom && p.startDate < filterDateFrom) return false;
            if (filterDateTo && p.startDate > filterDateTo) return false;
            if (filterQtyMin && Number(p.quantity) < Number(filterQtyMin)) return false;
            if (filterQtyMax && Number(p.quantity) > Number(filterQtyMax)) return false;

            return true;
        }).sort((a, b) => {
            const dir = currentSort.endsWith('desc') ? -1 : 1;
            if (currentSort.startsWith('date')) {
                return ((a.startDate || '') > (b.startDate || '') ? 1 : -1) * dir;
            }
            if (currentSort.startsWith('name')) {
                return ((a.description || '').localeCompare(b.description || '')) * dir;
            }
            if (currentSort.startsWith('quantity')) {
                return ((Number(a.quantity) || 0) - (Number(b.quantity) || 0)) * dir;
            }
            return 0;
        });
    }

    // Rendering
    function render() {
        const filtered = getFilteredData();
        updateHeaderStats();

        if (currentView === 'list') {
            els.listView.style.display = 'block';
            els.calendarView.style.display = 'none';
            renderList(filtered);
        } else {
            els.listView.style.display = 'none';
            els.calendarView.style.display = 'block';
            renderCalendar(filtered);
        }
    }

    function updateHeaderStats() {
        els.statsDone.textContent = completedIds.size;

        // Calculate tab counts (ignoring filters)
        els.pendingCount.textContent = activePlants.length - completedIds.size;
        els.completedCount.textContent = completedIds.size;
        els.statsTotal.textContent = activePlants.length; // also update the total in the header

        // Update filter badge
        let activeFilters = 0;
        if (filterStatus) activeFilters++;
        if (filterBin) activeFilters++;
        if (filterDateFrom) activeFilters++;
        if (filterDateTo) activeFilters++;
        if (filterQtyMin) activeFilters++;
        if (filterQtyMax) activeFilters++;

        if (activeFilters > 0) {
            els.filterBadge.style.display = 'inline-block';
            els.filterBadge.textContent = activeFilters;
        } else {
            els.filterBadge.style.display = 'none';
        }
    }

    // --- List View ---
    function renderList(plants) {
        els.plantList.innerHTML = '';

        if (plants.length === 0) {
            els.emptyState.style.display = 'block';
            return;
        }
        els.emptyState.style.display = 'none';

        const frag = document.createDocumentFragment();
        plants.forEach(p => {
            const row = document.createElement('div');
            const isCompleted = completedIds.has(p.id);
            row.className = `plant-row ${isCompleted ? 'completed-row' : ''}`;

            const status = getStatus(p);
            let statusHtml = '';
            if (!isCompleted) {
                if (status === 'active') statusHtml = '<span class="status-badge status-active">En progreso</span>';
                if (status === 'upcoming') statusHtml = '<span class="status-badge status-upcoming">Próximo</span>';
                if (status === 'overdue') statusHtml = '<span class="status-badge status-overdue">Vencido</span>';
            }

            // Action button svg
            const icon = isCompleted
                ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>'
                : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';

            // Desktop layout cells + Mobile explicit hidden
            const qtyFormatted = p.quantity ? Number(p.quantity).toLocaleString() : '-';

            // Compute progress bar
            let progressPercent = 0;
            let isOverdue = false;
            if (p.startDate && p.endDate && !isCompleted) {
                const start = new Date(p.startDate).getTime();
                const end = new Date(p.endDate).getTime();
                const now = new Date().getTime();

                if (now >= end) {
                    progressPercent = 100;
                    if (status === 'overdue') isOverdue = true;
                } else if (now > start) {
                    progressPercent = ((now - start) / (end - start)) * 100;
                }
            } else if (isCompleted) {
                progressPercent = 100;
            }
            const barClass = isOverdue ? 'progress-bar overdue' : 'progress-bar';

            row.innerHTML = `
        <div class="cell-name">${p.description || '-'}</div>
        <div class="cell-qty">${qtyFormatted}</div>
        <div class="cell-bin">${p.binCode || '-'}</div>
        <div class="cell-order">${p.prodOrderNo || '-'}</div>
        <div class="cell-item">${p.itemNo || '-'}</div>
        <div class="cell-dates">
          <div class="date-rng">
            <span>Inicio: ${formatDate(p.startDate)}</span>
            <span>Fin: ${formatDate(p.endDate)}</span>
          </div>
        </div>
        <div class="cell-status">${statusHtml}</div>
        <div class="cell-action">
          <button class="action-btn" data-id="${p.id}" title="${isCompleted ? 'Restaurar' : 'Completar'}">
            ${icon}
          </button>
        </div>
        
        <!-- Mobile meta (hidden on desktop via css media query, visible on mobile) -->
        <div class="mobile-meta" style="${window.innerWidth > 900 ? 'display:none;' : ''}">
          <span>📦 ${qtyFormatted}</span>
          <span>📍 ${p.binCode || '-'}</span>
          <span>📅 ${formatDate(p.startDate)}</span>
          <span>🏷️ ${p.prodOrderNo || '-'}</span>
        </div>
        
        <div class="progress-container">
            <div class="${barClass}" style="width: ${progressPercent}%"></div>
        </div>
      `;
            frag.appendChild(row);
        });
        els.plantList.appendChild(frag);
    }

    // --- Calendar View ---
    function renderCalendar(plants) {
        els.calDays.innerHTML = '';
        els.calDetail.style.display = 'none';

        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        els.calMonth.textContent = `${monthNames[month]} ${year}`;

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // adjust for monday start
        const startOffset = firstDay === 0 ? 6 : firstDay - 1;

        // pad empty days
        for (let i = 0; i < startOffset; i++) {
            const empty = document.createElement('div');
            empty.className = 'cal-day empty';
            els.calDays.appendChild(empty);
        }

        // pre-calculate events per day
        const dayEvents = {};
        for (let i = 1; i <= daysInMonth; i++) dayEvents[i] = [];

        const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

        plants.forEach(p => {
            // check start dates
            if (p.startDate && p.startDate.startsWith(monthPrefix)) {
                const day = parseInt(p.startDate.split('-')[2], 10);
                dayEvents[day].push({ ...p, type: 'start' });
            }
            // check end dates
            if (p.endDate && p.endDate.startsWith(monthPrefix)) {
                const day = parseInt(p.endDate.split('-')[2], 10);
                dayEvents[day].push({ ...p, type: 'end' });
            }
        });

        const todayStr = new Date().toISOString().split('T')[0];

        for (let i = 1; i <= daysInMonth; i++) {
            const dayEl = document.createElement('div');
            dayEl.className = 'cal-day';

            const dayStr = `${monthPrefix}-${String(i).padStart(2, '0')}`;
            if (dayStr === todayStr) dayEl.classList.add('today');

            dayEl.dataset.date = dayStr;

            let html = `<div class="cal-day-num">${i}</div><div class="cal-events">`;

            const events = dayEvents[i].slice(0, 3); // show max 3
            events.forEach(e => {
                const cls = e.type === 'end' ? 'end-event' : 'start-event';
                const prefix = e.type === 'end' ? '🏁' : '🌱';
                html += `<div class="cal-event ${cls}" title="${e.description}">${prefix} ${e.description}</div>`;
            });

            if (dayEvents[i].length > 3) {
                html += `<div class="cal-event" style="background:transparent; color:var(--text-muted); border:none;">+${dayEvents[i].length - 3} más</div>`;
            }

            html += `</div>`;
            dayEl.innerHTML = html;

            // Click for detail view
            dayEl.addEventListener('click', () => {
                showCalendarDetail(dayStr, dayEvents[i]);
            });

            els.calDays.appendChild(dayEl);
        }
    }

    function showCalendarDetail(dateStr, events) {
        if (events.length === 0) return;
        els.calDetailTitle.textContent = `Eventos para ${formatDate(dateStr)}`;
        els.calDetailList.innerHTML = '';

        events.forEach(e => {
            const div = document.createElement('div');
            div.style.padding = '12px';
            div.style.background = 'var(--bg-main)';
            div.style.borderRadius = 'var(--radius)';
            div.style.borderLeft = `4px solid ${e.type === 'end' ? 'var(--status-overdue-text)' : 'var(--primary)'}`;

            div.innerHTML = `
        <div style="font-weight:600; font-size:14px;">${e.type === 'end' ? '🏁 Finalización:' : '🌱 Inicio:'} ${e.description || '-'}</div>
        <div style="font-size:13px; color:var(--text-muted); margin-top:4px;">
          Cant: ${e.quantity || '-'} | Bin: ${e.binCode || '-'} | Orden: ${e.prodOrderNo || '-'}
        </div>
      `;
            els.calDetailList.appendChild(div);
        });

        els.calDetail.style.display = 'block';
        els.calDetail.scrollIntoView({ behavior: 'smooth' });
    }

    // --- Actions ---
    function toggleComplete(id) {
        let plantId = id;
        if (!isNaN(id) && !id.startsWith('import_')) {
            plantId = Number(id);
        }

        const plant = activePlants.find(p => p.id === plantId || String(p.id) === String(plantId));
        if (!plant) return;

        if (completedIds.has(plantId)) {
            completedIds.delete(plantId);
            lastAction = { id: plantId, type: 'restore' };
            showToast(`Restaurado: ${plant.description}`);
        } else {
            completedIds.add(plantId);
            lastAction = { id: plantId, type: 'complete' };
            showToast(`Completado: ${plant.description}`);
        }
        saveState();
        render();
    }

    function showToast(msg) {
        clearTimeout(toastTimeout);
        els.toastMsg.textContent = msg;
        els.toast.style.display = 'flex';
        toastTimeout = setTimeout(() => {
            els.toast.style.display = 'none';
            lastAction = null;
        }, 5000);
    }

    // --- Events ---
    function bindEvents() {
        // View switching
        els.viewList.addEventListener('click', () => {
            currentView = 'list';
            els.viewList.classList.add('active');
            els.viewCalendar.classList.remove('active');
            render();
        });

        els.viewCalendar.addEventListener('click', () => {
            currentView = 'calendar';
            els.viewCalendar.classList.add('active');
            els.viewList.classList.remove('active');
            // Reset calendar to today's month if it's the first time
            render();
        });

        // Tab switching
        els.tabPending.addEventListener('click', () => {
            currentTab = 'pending';
            els.tabPending.classList.add('active');
            els.tabCompleted.classList.remove('active');
            render();
        });

        els.tabCompleted.addEventListener('click', () => {
            currentTab = 'completed';
            els.tabCompleted.classList.add('active');
            els.tabPending.classList.remove('active');
            render();
        });

        // Search
        let searchTimer;
        els.searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimer);
            const val = e.target.value.trim();
            els.clearSearch.style.display = val ? 'block' : 'none';
            searchTimer = setTimeout(() => {
                searchQuery = val;
                render();
            }, 300);
        });

        els.clearSearch.addEventListener('click', () => {
            els.searchInput.value = '';
            els.clearSearch.style.display = 'none';
            searchQuery = '';
            render();
            els.searchInput.focus();
        });

        // Sorting
        els.sortSelect.addEventListener('change', (e) => {
            currentSort = e.target.value;
            render();
        });

        // Filter Panel Toggle
        els.filterToggle.addEventListener('click', () => {
            const isHidden = els.filterPanel.style.display === 'none';
            els.filterPanel.style.display = isHidden ? 'block' : 'none';
        });

        // Apply Filters
        els.filterApply.addEventListener('click', () => {
            filterStatus = els.filterStatus.value;
            filterBin = els.filterBin.value;
            filterDateFrom = els.filterDateFrom.value;
            filterDateTo = els.filterDateTo.value;
            filterQtyMin = els.filterQtyMin.value;
            filterQtyMax = els.filterQtyMax.value;
            render();
            els.filterPanel.style.display = 'none';
        });

        // Clear Filters
        els.filterClearAll.addEventListener('click', () => {
            els.filterStatus.value = '';
            els.filterBin.value = '';
            els.filterDateFrom.value = '';
            els.filterDateTo.value = '';
            els.filterQtyMin.value = '';
            els.filterQtyMax.value = '';

            filterStatus = '';
            filterBin = '';
            filterDateFrom = '';
            filterDateTo = '';
            filterQtyMin = '';
            filterQtyMax = '';

            render();
        });

        // Action button clicks (delegated)
        els.listView.addEventListener('click', (e) => {
            const btn = e.target.closest('.action-btn');
            if (btn) {
                toggleComplete(btn.dataset.id);
            }
        });

        // Calendar navigation
        els.calPrev.addEventListener('click', () => {
            currentDate.setMonth(currentDate.getMonth() - 1);
            renderCalendar(getFilteredData());
        });

        els.calNext.addEventListener('click', () => {
            currentDate.setMonth(currentDate.getMonth() + 1);
            renderCalendar(getFilteredData());
        });

        // Undo toast
        els.toastUndo.addEventListener('click', () => {
            if (lastAction) {
                if (lastAction.type === 'complete') {
                    completedIds.delete(lastAction.id);
                } else {
                    completedIds.add(lastAction.id);
                }
                saveState();
                els.toast.style.display = 'none';
                lastAction = null;
                render();
            }
        });

        // Resize listener for mobile meta toggle
        window.addEventListener('resize', () => {
            if (currentView === 'list') {
                const metas = document.querySelectorAll('.mobile-meta');
                const showMeta = window.innerWidth <= 900;
                metas.forEach(m => {
                    m.style.display = showMeta ? 'flex' : 'none';
                });
            }
        });
    }

    // Start app
    init();

})();
