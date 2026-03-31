console.log('%c JournAI v1.2 ', 'background: #3b82f6; color: #fff; border-radius: 4px; padding: 2px 6px;');
window.monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];
const monthNames = window.monthNames;

let currentDate = new Date();
let selectedDate = null;
let activeFilter = 'average';
let activeView = 'days';
let metricsSkipped = false;

// Tracker Management
let trackersConfig = JSON.parse(localStorage.getItem('journAI_trackers_config')) || [];
let activeTrackersState = {}; // Temp store for modal session

function getEntries() {
    return JSON.parse(localStorage.getItem('journAI_entries') || '{}');
}

function saveEntry(dateKey, text, mood, activity, health) {
    try {
        const entries = getEntries();
        entries[dateKey] = { text, mood, activity, health };
        localStorage.setItem('journAI_entries', JSON.stringify(entries));
        render();
        checkTodayEntry();
        
        // Trigger cloud sync and backup - non-blocking
        if (window.DriveService) {
            showSyncIndicator();
            window.DriveService.syncData(entries)
                .catch(err => console.error('[Sync] Failed:', err))
                .finally(() => hideSyncIndicator());
        }
        
        checkAndPerformBackup();
        triggerAutomatedDocExport();
    } catch (err) {
        console.error('[Save] Local failed:', err);
    }
}

function deleteEntry(dateKey) {
    try {
        const entries = getEntries();
        if (confirm('¿Estás seguro de que deseas eliminar esta entrada?')) {
            delete entries[dateKey];
            localStorage.setItem('journAI_entries', JSON.stringify(entries));
            render();
            checkTodayEntry();
            
            if (window.DriveService) {
                showSyncIndicator();
                window.DriveService.syncData(entries)
                    .catch(err => console.error('[Sync] Failed:', err))
                    .finally(() => hideSyncIndicator());
            }
            
            checkAndPerformBackup();
            triggerAutomatedDocExport();
            return true;
        }
    } catch (err) {
        console.error('[Delete] failed:', err);
    }
    return false;
}

function getDateKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// --- GOOGLE DRIVE SYNC LOGIC ---
const syncStatus = document.getElementById('syncStatus');
const syncNowBtn = document.getElementById('syncNowBtn');

function updateSyncStatus(message, type = '') {
    if (!syncStatus) return;
    syncStatus.textContent = message;
    
    // Update status orb if it exists
    const orb = document.getElementById('statusOrb');
    if (orb) {
        orb.className = 'status-orb ' + type;
    }
}

async function handleSyncNow() {
    if (syncNowBtn) {
        syncNowBtn.disabled = true;
        syncNowBtn.textContent = 'Sincronizando...';
    }
    updateSyncStatus('Sincronizando con Google Drive...', 'syncing');
    
    const entries = getEntries();
    const success = await window.DriveService.performBackup(entries);
    
    if (success) {
        const now = new Date();
        localStorage.setItem('last_drive_backup', now.toISOString());
        updateSyncStatus(`Sincronizado hoy a las ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`, 'success');
        
        // Also trigger Doc export on manual sync
        triggerAutomatedDocExport();
    } else {
        updateSyncStatus('Error en la sincronización', 'error');
    }
    
    if (syncNowBtn) {
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sincronizar Ahora';
    }
}

async function checkAndPerformBackup() {
    const lastBackupStr = localStorage.getItem('last_drive_backup');
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    if (lastBackupStr) {
        const lastBackupDate = lastBackupStr.split('T')[0];
        if (lastBackupDate === today) {
            const lastBackup = new Date(lastBackupStr);
            updateSyncStatus(`Sincronizado hoy a las ${lastBackup.getHours()}:${lastBackup.getMinutes().toString().padStart(2, '0')}`, 'success');
            return; // Already backed up today
        }
    }
    
    // Perform backup if not done today
    console.log('[JournAI] Automated daily backup triggered');
    const entries = getEntries();
    const success = await window.DriveService.performBackup(entries);
    
    if (success) {
        localStorage.setItem('last_drive_backup', now.toISOString());
        updateSyncStatus(`Sincronizado hoy a las ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`, 'success');
    } else {
        updateSyncStatus('Pendiente de sincronizar', 'error');
    }
}

function showSyncIndicator() {
    const indicator = document.getElementById('syncIndicator');
    if (indicator) indicator.classList.remove('hidden');
}

function hideSyncIndicator() {
    const indicator = document.getElementById('syncIndicator');
    if (indicator) indicator.classList.add('hidden');
}

async function triggerAutomatedDocExport() {
    const dataByYear = generateExportDocData();
    await window.DriveService.performGoogleDocExport(dataByYear);
}

async function handleForceUpload() {
    if (!confirm('¿Estás seguro de que quieres SOBRESCRIBIR la copia de la nube con tus datos locales actuales?')) return;
    
    showSyncIndicator();
    updateSyncStatus('Subiendo datos locales a la nube...', 'syncing');
    try {
        const fullData = getFullDataForExport();
        const success = await window.DriveService.syncData(fullData);
        if (success) {
            alert('¡Subida forzada completada con éxito!');
            updateSyncStatus('Sincronización manual completada', 'success');
        } else {
            alert('Error al subir los datos.');
            updateSyncStatus('Error en subida forzada', 'error');
        }
    } catch (err) {
        console.error('[Sync] Force upload failed:', err);
    } finally {
        hideSyncIndicator();
    }
}

async function handleForceDownload() {
    if (!confirm('¿Estás seguro? Los datos locales serán REEMPLAZADOS por la versión de la nube.')) return;
    
    showSyncIndicator();
    updateSyncStatus('Descargando datos de la nube...', 'syncing');
    try {
        const cloudData = await window.DriveService.getSyncData();
        if (cloudData) {
            if (cloudData.entries) {
                localStorage.setItem('journAI_entries', JSON.stringify(cloudData.entries));
                if (cloudData.gemini_api_key) {
                    localStorage.setItem('gemini_api_key', cloudData.gemini_api_key);
                }
            } else {
                localStorage.setItem('journAI_entries', JSON.stringify(cloudData));
            }
            render();
            checkTodayEntry();
            alert('¡Descarga forzada completada! Datos locales reemplazados.');
            updateSyncStatus('Datos descargados de la nube', 'success');
        } else {
            alert('No se encontraron datos en la nube o el archivo está vacío.');
        }
    } catch (err) {
        console.error('[Sync] Force download failed:', err);
        alert('Error al descargar los datos de la nube.');
    } finally {
        hideSyncIndicator();
    }
}

async function performStartupSync() {
    showSyncIndicator();
    console.log('[JournAI] performStartupSync started (Replacement Mode)');
    updateSyncStatus('Sincronizando datos de otros dispositivos...', 'syncing');
    try {
        const cloudData = await window.DriveService.getSyncData();
        if (cloudData) {
            if (cloudData.entries && Object.keys(cloudData.entries).length > 0) {
                console.log(`[JournAI] Replacing local data with remote data (${Object.keys(cloudData.entries).length} entries)`);
                localStorage.setItem('journAI_entries', JSON.stringify(cloudData.entries));
                if (cloudData.gemini_api_key) {
                    localStorage.setItem('gemini_api_key', cloudData.gemini_api_key);
                }
            } else if (!cloudData.entries && Object.keys(cloudData).length > 0) {
                // Old format
                localStorage.setItem('journAI_entries', JSON.stringify(cloudData));
            }
            console.log('[JournAI] Startup sync completed');
            render();
            checkTodayEntry();
        } else {
            console.log('[JournAI] No remote data to import');
        }
    } catch (err) {
        console.error('[JournAI] Startup sync failed:', err);
    } finally {
        hideSyncIndicator();
    }
}

function generateExportDocData() {
    const entries = getEntries();
    const dataByYear = {};
    
    Object.keys(entries).sort().forEach(dateKey => {
        const parts = dateKey.split('-').map(Number);
        if (parts.length !== 3) return;
        const [year, month, day] = parts;
        if (!dataByYear[year]) dataByYear[year] = {};
        if (!dataByYear[year][month]) dataByYear[year][month] = {};
        dataByYear[year][month][day] = entries[dateKey];
    });
    return dataByYear;
}

function generateExportHTML() {
    const entries = getEntries();
    const dataByYear = {};
    
    // Group entries by year and month
    Object.keys(entries).sort().forEach(dateKey => {
        const parts = dateKey.split('-').map(Number);
        if (parts.length !== 3) return;
        const [year, month, day] = parts;
        if (!dataByYear[year]) dataByYear[year] = {};
        if (!dataByYear[year][month]) dataByYear[year][month] = {};
        dataByYear[year][month][day] = entries[dateKey];
    });

    const years = Object.keys(dataByYear).sort((a,b) => b - a); // Inverse chronological for years
    
    let html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JournAI - Diario Estelar Export</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #000000;
            --surface: #0a0a0a;
            --surface-2: #141414;
            --accent: #3b82f6;
            --text-primary: #ffffff;
            --text-secondary: rgba(255, 255, 255, 0.6);
            --border: rgba(255, 255, 255, 0.1);
            --radius-md: 12px;
            --radius-sm: 8px;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: var(--bg);
            color: var(--text-primary);
            margin: 0;
            padding: 0;
            line-height: 1.6;
            scrollbar-width: thin;
            scrollbar-color: var(--accent) var(--bg);
        }

        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 4rem 2rem;
        }

        header {
            margin-bottom: 4rem;
            text-align: center;
        }

        h1 {
            font-family: 'Outfit', sans-serif;
            font-size: 3.5rem;
            margin: 0;
            letter-spacing: -0.04em;
            background: linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.4) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .tagline {
            color: var(--text-secondary);
            font-size: 1.1rem;
            margin-top: 0.5rem;
        }

        /* Tabs UI */
        .tabs-section {
            margin-bottom: 3rem;
            position: sticky;
            top: 0;
            background: var(--bg);
            padding: 1rem 0;
            z-index: 100;
            border-bottom: 1px solid var(--border);
        }

        .year-tabs {
            display: flex;
            gap: 1.5rem;
            margin-bottom: 1rem;
            overflow-x: auto;
            padding: 0.5rem 0;
        }

        .tab {
            font-family: 'Outfit', sans-serif;
            font-size: 1.2rem;
            font-weight: 600;
            color: var(--text-secondary);
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            padding: 0.5rem 0;
            white-space: nowrap;
            position: relative;
        }

        .tab:hover, .tab.active {
            color: var(--text-primary);
        }

        .tab.active::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: var(--accent);
            box-shadow: 0 0 10px var(--accent);
        }

        .month-tabs {
            display: flex;
            gap: 0.8rem;
            flex-wrap: wrap;
            padding-top: 0.5rem;
        }

        .month-tab {
            font-size: 0.85rem;
            padding: 0.4rem 1.2rem;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 20px;
            cursor: pointer;
            color: var(--text-secondary);
            transition: all 0.2s ease;
        }

        .month-tab:hover {
            border-color: var(--accent);
            color: var(--text-primary);
        }

        .month-tab.active {
            background: var(--accent);
            color: #fff;
            border-color: var(--accent);
            box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
        }

        /* Content Sections */
        .year-content { display: none; }
        .month-content { display: none; }
        .year-content.active, .month-content.active { display: block; }

        .entry {
            background: linear-gradient(180deg, var(--surface) 0%, rgba(10,10,10,0.5) 100%);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 2.5rem;
            margin-bottom: 3rem;
            transition: transform 0.3s ease;
        }

        .entry:hover {
            border-color: rgba(255,255,255,0.2);
        }

        .entry-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 2rem;
            border-bottom: 1px solid var(--border);
            padding-bottom: 1.5rem;
        }

        .entry-title {
            font-family: 'Outfit', sans-serif;
        }

        .entry-day {
            font-size: 2.5rem;
            font-weight: 600;
            line-height: 1;
            margin-bottom: 0.2rem;
        }

        .entry-month-year {
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.1rem;
            font-size: 0.8rem;
        }

        .entry-metrics {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 2rem;
            text-align: right;
        }

        .metric-item {
            display: flex;
            flex-direction: column;
        }

        .metric-label {
            font-size: 0.7rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            margin-bottom: 0.3rem;
        }

        .metric-value {
            font-family: 'Outfit', sans-serif;
            font-size: 1.2rem;
            font-weight: 600;
        }

        .entry-text {
            font-size: 1.15rem;
            color: rgba(255, 255, 255, 0.85);
            white-space: pre-wrap;
            line-height: 1.8;
        }

        .no-data {
            text-align: center;
            padding: 5rem;
            color: var(--text-secondary);
            font-style: italic;
        }

        @media (max-width: 600px) {
            .entry-header { flex-direction: column; gap: 1.5rem; }
            .entry-metrics { text-align: left; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>JournAI</h1>
            <p class="tagline">Diario Estelar &bull; Registro Completo de Vivencias</p>
        </header>

        <div class="tabs-section">
            <div class="year-tabs">
                ${years.map(y => `<div class="tab" id="tab-year-${y}" onclick="switchYear('${y}')">${y}</div>`).join('')}
            </div>
            
            ${years.map(y => `
                <div id="wrapper-months-${y}" class="year-content">
                    <div class="month-tabs">
                        ${Object.keys(dataByYear[y]).sort((a,b) => a - b).map(m => `
                            <div class="month-tab" id="tab-month-${y}-${m}" onclick="switchMonth('${y}', '${m}')">${monthNames[m]}</div>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>

        <div id="content-pool">
            ${years.map(y => 
                Object.keys(dataByYear[y]).map(m => `
                    <div id="container-${y}-${m}" class="month-content">
                        ${Object.keys(dataByYear[y][m]).sort((a,b) => a - b).map(d => {
                            const entry = dataByYear[y][m][d];
                            return `
                                <article class="entry">
                                    <div class="entry-header">
                                        <div class="entry-title">
                                            <div class="entry-day">${d}</div>
                                            <div class="entry-month-year">${monthNames[m]} ${y}</div>
                                        </div>
                                        <div class="entry-metrics">
                                            <div class="metric-item">
                                                <span class="metric-label">Mood</span>
                                                <span class="metric-value">${entry.mood || 5}/10</span>
                                            </div>
                                            <div class="metric-item">
                                                <span class="metric-label">Activity</span>
                                                <span class="metric-value">${entry.activity || 5}/10</span>
                                            </div>
                                            <div class="metric-item">
                                                <span class="metric-label">Health</span>
                                                <span class="metric-value">${entry.health || 5}/10</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="entry-text">${entry.text}</div>
                                </article>
                            `;
                        }).join('')}
                    </div>
                `).join('')
            ).join('')}
        </div>
    </div>

    <script>
        function switchYear(year) {
            // Update Year Tabs
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById('tab-year-' + year).classList.add('active');

            // Update Month Wrappers
            document.querySelectorAll('.year-content').forEach(w => w.classList.remove('active'));
            const wrapper = document.getElementById('wrapper-months-' + year);
            if (wrapper) {
                wrapper.classList.add('active');
                // Auto-select first available month in that year
                const firstMonthTab = wrapper.querySelector('.month-tab');
                if (firstMonthTab) firstMonthTab.click();
            }
        }

        function switchMonth(year, month) {
            // Update Month Tabs
            document.querySelectorAll('.month-tab').forEach(t => t.classList.remove('active'));
            document.getElementById('tab-month-' + year + '-' + month).classList.add('active');

            // Update Content
            document.querySelectorAll('.month-content').forEach(c => c.classList.remove('active'));
            const content = document.getElementById('container-' + year + '-' + month);
            if (content) {
                content.classList.add('active');
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }

        // Initialize with first year/month
        document.addEventListener('DOMContentLoaded', () => {
            const firstYear = document.querySelector('.tab');
            if (firstYear) firstYear.click();
        });
    </script>
</body>
</html>`;
    return html;
}

if (syncNowBtn) syncNowBtn.addEventListener('click', handleSyncNow);

// UI Elements
const calendarGrid = document.getElementById('calendarGrid');
const viewTitle = document.getElementById('currentViewTitle');
const entryModal = document.getElementById('entryModal');
const entryText = document.getElementById('entryText');
const modalDateTitle = document.getElementById('modalDateTitle');

const moodSlider = document.getElementById('moodSlider');
const activitySlider = document.getElementById('activitySlider');
const healthSlider = document.getElementById('healthSlider');
const moodValue = document.getElementById('moodValue');
const activityValue = document.getElementById('activityValue');
const healthValue = document.getElementById('healthValue');
const saveIcon = document.getElementById('saveIcon');
const saveText = document.getElementById('saveText');

function updateSliderLabels() {
    if (!moodSlider || !activitySlider || !healthSlider) return;
    moodValue.textContent = moodSlider.value;
    activityValue.textContent = activitySlider.value;
    healthValue.textContent = healthSlider.value;
    
    // Get colors for each specific metric
    const moodCols = getColorForValue(parseInt(moodSlider.value));
    const activityCols = getColorForValue(parseInt(activitySlider.value));
    const healthCols = getColorForValue(parseInt(healthSlider.value));
    
    // Apply colors to the value indicators
    if (moodValue) {
        moodValue.style.background = moodCols.bg;
        moodValue.style.borderColor = moodCols.border;
        moodValue.style.boxShadow = `0 0 15px ${moodCols.glow}`;
    }
    if (activityValue) {
        activityValue.style.background = activityCols.bg;
        activityValue.style.borderColor = activityCols.border;
        activityValue.style.boxShadow = `0 0 15px ${activityCols.glow}`;
    }
    if (healthValue) {
        healthValue.style.background = healthCols.bg;
        healthValue.style.borderColor = healthCols.border;
        healthValue.style.boxShadow = `0 0 15px ${healthCols.glow}`;
    }
    
    // Dynamic Slider Tracks
    moodSlider.style.setProperty('--accent', moodCols.border);
    activitySlider.style.setProperty('--accent', activityCols.border);
    healthSlider.style.setProperty('--accent', healthCols.border);
    
    // Reactive Glow for Modal (Average of all metrics)
    const avg = (parseInt(moodSlider.value) + parseInt(activitySlider.value) + parseInt(healthSlider.value)) / 3;
    const colors = getColorForValue(avg);
    const modalContent = document.querySelector('#entryModal .entry-modal-view');
    if (modalContent) {
        modalContent.style.setProperty('--glow-color', colors.glow);
    }
}

if (moodSlider) moodSlider.addEventListener('input', updateSliderLabels);
if (activitySlider) activitySlider.addEventListener('input', updateSliderLabels);
if (healthSlider) healthSlider.addEventListener('input', updateSliderLabels);

// Aggregation Logic
function getAverageMetric(year, month = null) {
    const entries = getEntries();
    let total = 0;
    let count = 0;
    
    Object.keys(entries).forEach(key => {
        const [eYear, eMonth] = key.split('-').map(Number);
        if (eYear === year && (month === null || eMonth === month)) {
            let val;
            if (activeFilter === 'average') {
                const entry = entries[key];
                const metrics = [];
                if (entry.mood !== undefined && entry.mood !== null) metrics.push(entry.mood);
                if (entry.activity !== undefined && entry.activity !== null) metrics.push(entry.activity);
                if (entry.health !== undefined && entry.health !== null) metrics.push(entry.health);
                
                if (metrics.length > 0) {
                    val = metrics.reduce((a, b) => a + b, 0) / metrics.length;
                } else {
                    val = null;
                }
            } else {
                val = entries[key][activeFilter];
            }
            
            if (val !== undefined && val !== null) {
                total += val;
                count++;
            }
        }
    });
    
    return count > 0 ? total / count : null;
}

function getColorForValue(value) {
    if (value === null) return null;
    const hue = (value - 1) * 13.33;
    return {
        bg: `hsla(${hue}, 70%, 25%, 0.4)`,
        border: `hsla(${hue}, 70%, 50%, 0.4)`,
        glow: `hsla(${hue}, 70%, 50%, 0.3)`
    };
}

function render() {
    if (!calendarGrid) return;
    calendarGrid.style.opacity = '0';
    setTimeout(() => {
        calendarGrid.innerHTML = '';
        calendarGrid.className = 'calendar-grid ' + 'view-' + activeView;
        
        if (activeView === 'days') renderDays();
        else if (activeView === 'months') renderMonths();
        else if (activeView === 'years') renderYears();
        
        calendarGrid.style.opacity = '1';
    }, 150);
}

function renderDays() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    if (viewTitle) viewTitle.textContent = `${monthNames[month]} ${year}`;
    
    const firstDay = new Date(year, month, 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const entries = getEntries();
    
    const weekdaysHeader = document.querySelector('.weekdays');
    if (weekdaysHeader) weekdaysHeader.style.display = 'grid';

    for (let i = offset; i > 0; i--) {
        calendarGrid.appendChild(createDayElement(daysInPrevMonth - i + 1, 'other-month'));
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(year, month, i);
        const dateKey = getDateKey(date);
        const entry = entries[dateKey];
        const dayDiv = createDayElement(i, new Date().toDateString() === date.toDateString() ? 'today' : '');
        
        if (entry) {
            let val;
            if (activeFilter === 'average') {
                const metrics = [];
                if (entry.mood !== undefined && entry.mood !== null) metrics.push(entry.mood);
                if (entry.activity !== undefined && entry.activity !== null) metrics.push(entry.activity);
                if (entry.health !== undefined && entry.health !== null) metrics.push(entry.health);
                
                if (metrics.length > 0) {
                    val = metrics.reduce((a, b) => a + b, 0) / metrics.length;
                } else {
                    val = null;
                }
            } else {
                val = entry[activeFilter];
            }
            
            const colors = getColorForValue(val);
            if (colors) {
                dayDiv.style.backgroundColor = colors.bg;
                dayDiv.style.borderColor = colors.border;
                dayDiv.style.setProperty('--glow-color', colors.glow);
            }
            dayDiv.classList.add('has-entry');
        }
        dayDiv.addEventListener('click', () => openModal(date));
        calendarGrid.appendChild(dayDiv);
    }
}

function renderMonths() {
    const year = currentDate.getFullYear();
    if (viewTitle) viewTitle.textContent = `${year}`;
    const weekdaysHeader = document.querySelector('.weekdays');
    if (weekdaysHeader) weekdaysHeader.style.display = 'none';

    monthNames.forEach((name, index) => {
        const avg = getAverageMetric(year, index);
        const div = createDayElement(name, 'month-item');
        div.style.animationDelay = `${index * 0.05}s`;
        if (avg !== null) {
            const colors = getColorForValue(avg);
            div.style.backgroundColor = colors.bg;
            div.style.borderColor = colors.border;
            div.style.setProperty('--glow-color', colors.glow);
        }
        div.addEventListener('click', () => {
            currentDate.setMonth(index);
            activeView = 'days';
            render();
        });
        calendarGrid.appendChild(div);
    });
}

function renderYears() {
    const baseYear = Math.floor(currentDate.getFullYear() / 12) * 12;
    if (viewTitle) viewTitle.textContent = `${baseYear} - ${baseYear + 11}`;
    const weekdaysHeader = document.querySelector('.weekdays');
    if (weekdaysHeader) weekdaysHeader.style.display = 'none';

    for (let i = 0; i < 12; i++) {
        const year = baseYear + i;
        const avg = getAverageMetric(year);
        const div = createDayElement(year, 'year-item');
        div.style.animationDelay = `${i * 0.05}s`;
        if (avg !== null) {
            const colors = getColorForValue(avg);
            div.style.backgroundColor = colors.bg;
            div.style.borderColor = colors.border;
            div.style.setProperty('--glow-color', colors.glow);
        }
        div.addEventListener('click', () => {
            currentDate.setFullYear(year);
            activeView = 'months';
            render();
        });
        calendarGrid.appendChild(div);
    }
}

function createDayElement(content, className) {
    const div = document.createElement('div');
    div.className = `day ${className}`;
    div.innerHTML = `<span class="number">${content}</span><div class="indicator"></div>`;
    return div;
}

// Navigation & Filters
if (viewTitle) viewTitle.addEventListener('click', () => {
    if (activeView === 'days') activeView = 'months';
    else if (activeView === 'months') activeView = 'years';
    render();
});

const prevBtn = document.getElementById('prevBtn');
if (prevBtn) prevBtn.addEventListener('click', () => {
    if (activeView === 'days') currentDate.setMonth(currentDate.getMonth() - 1);
    else if (activeView === 'months') currentDate.setFullYear(currentDate.getFullYear() - 1);
    else if (activeView === 'years') currentDate.setFullYear(currentDate.getFullYear() - 12);
    render();
});

const nextBtn = document.getElementById('nextBtn');
if (nextBtn) nextBtn.addEventListener('click', () => {
    if (activeView === 'days') currentDate.setMonth(currentDate.getMonth() + 1);
    else if (activeView === 'months') currentDate.setFullYear(currentDate.getFullYear() + 1);
    else if (activeView === 'years') currentDate.setFullYear(currentDate.getFullYear() + 12);
    render();
});

const filterBtns = document.querySelectorAll('.filter-btn');
filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        render();
    });
});

const writeTodayBtn = document.getElementById('writeTodayBtn');
if (writeTodayBtn) writeTodayBtn.addEventListener('click', () => {
    openModal(new Date());
});

function showStep(step) {
    const step1 = document.getElementById('step1');
    const step1b = document.getElementById('step1b');
    const step2 = document.getElementById('step2');
    if (!step1 || !step1b || !step2) return;
    
    step1.classList.remove('active');
    step1b.classList.remove('active');
    step2.classList.remove('active');

    if (step === 1) {
        step1.classList.add('active');
    } else if (step === '1b') {
        renderActiveTrackers();
        step1b.classList.add('active');
    } else if (step === 2) {
        step2.classList.add('active');
    }
}

function closeModal() {
    if (entryModal) entryModal.classList.add('hidden');
    showStep(1);
}

const nxtStepBtnFrom1b = document.getElementById('nextStepFrom1b');
const nxtStepBtn = document.getElementById('nextStep'); // From 1 to 1b
const prvStepBtn = document.getElementById('prevStep'); // Back from Text to 1b
const prvStepBtnFrom1b = document.getElementById('prevStepFrom1b'); // Back from Trackers to 1
const skipTrackersBtn = document.getElementById('skipTrackersBtn');
const skipMoodBtn = document.getElementById('skipMoodBtn'); // Skip 1 to 1b

if (prvStepBtnFrom1b) {
    prvStepBtnFrom1b.addEventListener('click', () => {
        saveTrackersState();
        showStep(1);
    });
}

if (nxtStepBtn) { // from step 1 to 1b
    nxtStepBtn.addEventListener('click', () => {
        metricsSkipped = false;
        showStep('1b');
    });
}

if (skipMoodBtn) { // skip step 1 to 1b
    skipMoodBtn.addEventListener('click', () => {
        metricsSkipped = true;
        showStep('1b');
    });
}

function saveTrackersState() {
    const container = document.getElementById('activeTrackersContainer');
    if (!container) return;
    const inputs = container.querySelectorAll('.tracker-val');
    inputs.forEach(input => {
        const id = input.dataset.id;
        // Readings depend on the type container attached to dataset.value
        activeTrackersState[id] = input.dataset.value || '';
    });
}

function injectTrackers() {
    saveTrackersState();
    if (!entryText) return;
    
    let hasValues = false;
    let trackerText = "\n\n--- Rastreadores ---\n";
    
    trackersConfig.forEach(t => {
        const val = activeTrackersState[t.id];
        if (val && val.trim() !== '') {
            trackerText += `- ${t.name}: ${val}\n`;
            hasValues = true;
        }
    });
    
    // Check if trackers block already exists, if so replace it, else append
    const currentText = entryText.value;
    const blockStart = currentText.indexOf('\n\n--- Rastreadores ---');
    
    if (!hasValues) {
        if (blockStart !== -1) {
            // Remove the block entirely if all trackers are unset
            entryText.value = currentText.substring(0, blockStart);
        }
        return;
    }

    if (blockStart !== -1) {
        // Replace existing block
        entryText.value = currentText.substring(0, blockStart) + trackerText;
    } else {
        // Append
        entryText.value = currentText + trackerText;
    }
}


if (nxtStepBtnFrom1b) {
    nxtStepBtnFrom1b.addEventListener('click', () => {
        injectTrackers();
        showStep(2);
        if (entryText) entryText.focus();
    });
}

if (skipTrackersBtn) {
    skipTrackersBtn.addEventListener('click', () => {
        showStep(2);
        if (entryText) entryText.focus();
    });
}

if (prvStepBtn) prvStepBtn.addEventListener('click', () => showStep('1b'));

function checkTodayEntry() {
    const entries = getEntries();
    const todayKey = getDateKey(new Date());
    const writeBtn = document.getElementById('writeTodayBtn');
    if (!writeBtn) return;
    
    if (!entries[todayKey]) {
        console.log("No entry for today, adding pulse");
        writeBtn.classList.add('pulse');
    } else {
        console.log("Entry found for today, removing pulse");
        writeBtn.classList.remove('pulse');
    }
}

function openModal(date) {
    selectedDate = date;
    metricsSkipped = false;
    activeTrackersState = {}; // Reset tracker state on open
    const entries = getEntries();
    const dateKey = getDateKey(date);
    const entry = entries[dateKey];
    
    const isToday = date.toDateString() === new Date().toDateString();
    const isNew = !entry;
    const data = entry || { text: "", mood: 5, activity: 5, health: 5 };
    
    if (modalDateTitle) {
        modalDateTitle.textContent = isToday ? "Mi Día" : `${date.getDate()} ${monthNames[date.getMonth()]}`;
    }
    
    if (entryText) entryText.value = data.text || "";
    if (moodSlider) moodSlider.value = data.mood || 5;
    if (activitySlider) activitySlider.value = data.activity || 5;
    if (healthSlider) healthSlider.value = data.health || 5;
    updateSliderLabels();
    
    if (saveIcon) saveIcon.textContent = isNew ? '✨' : '✏️';
    if (saveText) saveText.textContent = isNew ? 'Guardar' : 'Actualizar';
    
    const deleteBtn = document.getElementById('deleteEntry');
    if (deleteBtn) {
        if (isNew) deleteBtn.classList.add('hidden');
        else deleteBtn.classList.remove('hidden');
    }
    
    showStep(1);
    if (entryModal) entryModal.classList.remove('hidden');
}

const saveEntryBtn = document.getElementById('saveEntry');
if (saveEntryBtn) saveEntryBtn.addEventListener('click', () => {
    if (selectedDate) {
        const m = metricsSkipped ? null : parseInt(moodSlider.value);
        const a = metricsSkipped ? null : parseInt(activitySlider.value);
        const h = metricsSkipped ? null : parseInt(healthSlider.value);
        saveEntry(getDateKey(selectedDate), entryText.value, m, a, h);
        closeModal();
    }
});

const rawSkipMoodBtn = document.getElementById('skipMoodBtn');
if (rawSkipMoodBtn) rawSkipMoodBtn.addEventListener('click', () => {
    metricsSkipped = true;
    showStep('1b');
});

document.addEventListener('DOMContentLoaded', () => {
    const deleteEntryBtn = document.getElementById('deleteEntry');
    if (deleteEntryBtn) {
        console.log('[JournAI] Delete button found, attaching listener');
        deleteEntryBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const dateKey = selectedDate ? getDateKey(selectedDate) : null;
            console.log('[JournAI] Delete button clicked', { selectedDate, dateKey });
            
            if (dateKey && deleteEntry(dateKey)) {
                console.log('[JournAI] Entry deleted successfully');
                closeModal();
            } else if (!dateKey) {
                console.error('[JournAI] Delete failed: No selectedDate');
            }
        });
    }
});

function getEntriesGrouped() {
    const entries = getEntries();
    const grouped = {};
    Object.keys(entries).forEach(key => {
        const [year, month, day] = key.split('-').map(Number);
        if (!grouped[year]) grouped[year] = {};
        if (!grouped[year][month]) grouped[year][month] = {};
        grouped[year][month][day] = entries[key];
    });
    return grouped;
}

async function exportToGoogleDoc() {
    const btn = document.getElementById('exportDoc');
    const originalText = btn.innerHTML;
    try {
        btn.innerHTML = '<span class="loading-spinner"></span> Exportando...';
        btn.disabled = true;
        const data = getEntriesGrouped();
        const success = await DriveService.performGoogleDocExport(data);
        if (success) {
            alert('¡Exportación a Google Docs completada con éxito!');
        } else {
            alert('Error en la exportación. Revisa la consola.');
        }
    } catch (e) {
        console.error(e);
        alert('Error crítico: ' + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

const exportDocBtn = document.getElementById('exportDoc');
if (exportDocBtn) exportDocBtn.addEventListener('click', exportToGoogleDoc);

const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');

if (settingsBtn) settingsBtn.addEventListener('click', () => {
    if (settingsModal) {
        settingsModal.classList.remove('hidden');
        if (geminiApiKeyInput) {
            geminiApiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
        }
        renderTrackerConfigList();
        fetchGeminiModels(); // Fetch available models when opening settings
    }
});

if (geminiApiKeyInput) {
    geminiApiKeyInput.addEventListener('input', (e) => {
        localStorage.setItem('gemini_api_key', e.target.value.trim());
    });
}

// --- SETTINGS: TRACKERS ---
function saveTrackersConfig() {
    localStorage.setItem('journAI_trackers_config', JSON.stringify(trackersConfig));
}

function renderTrackerConfigList() {
    const list = document.getElementById('trackersList');
    if (!list) return;
    list.innerHTML = '';
    
    if (trackersConfig.length === 0) {
        list.innerHTML = '<p style="color:var(--text-secondary); font-size:0.85rem; padding-left:5px;">Aún no has configurado rastreadores.</p>';
        return;
    }
    
    trackersConfig.forEach(t => {
        const div = document.createElement('div');
        div.className = 'tracker-item-row';
        div.innerHTML = `
            <div class="tracker-item-info">
                <span class="tracker-item-name">${t.name}</span>
                <span class="tracker-item-type">${t.type === 'boolean' ? 'Blanco / Sí / No' : 'Blanco / Cifra'}</span>
            </div>
            <button class="delete-tracker-btn" data-id="${t.id}" title="Eliminar">×</button>
        `;
        list.appendChild(div);
    });
    
    document.querySelectorAll('.delete-tracker-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            trackersConfig = trackersConfig.filter(t => t.id !== id);
            saveTrackersConfig();
            renderTrackerConfigList();
        });
    });
}

const addTrackerBtn = document.getElementById('addTrackerBtn');
if (addTrackerBtn) {
    addTrackerBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('newTrackerName');
        const typeSelect = document.getElementById('newTrackerType');
        const name = nameInput.value.trim();
        if (!name) return alert('Ponle un nombre al rastreador.');
        
        trackersConfig.push({
            id: 't_' + Date.now(),
            name: name,
            type: typeSelect.value
        });
        
        saveTrackersConfig();
        renderTrackerConfigList();
        nameInput.value = '';
    });
}

function renderActiveTrackers() {
    const container = document.getElementById('activeTrackersContainer');
    if (!container) return;
    container.innerHTML = '';
    
    if (trackersConfig.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding: 2rem;">No tienes rastreadores configurados.<br>Puedes añadirlos desde Ajustes.</p>';
        return;
    }
    
    trackersConfig.forEach(t => {
        const div = document.createElement('div');
        div.className = 'tracker-input-row';
        const currentVal = activeTrackersState[t.id] || '';
        
        if (t.type === 'boolean') {
            div.innerHTML = `
                <label>${t.name}</label>
                <div class="segmented-control tracker-val" data-id="${t.id}" data-name="${t.name}" data-type="boolean" data-value="${currentVal}">
                    <button class="segment-btn ${currentVal === 'Sí' ? 'active' : ''}" data-val="Sí">Sí</button>
                    <button class="segment-btn ${currentVal === '' ? 'active' : ''}" data-val="">-</button>
                    <button class="segment-btn ${currentVal === 'No' ? 'active' : ''}" data-val="No">No</button>
                </div>
            `;
        } else {
            div.innerHTML = `
                <label>${t.name}</label>
                <div class="number-stepper tracker-val" data-id="${t.id}" data-name="${t.name}" data-type="number" data-value="${currentVal}">
                    <button class="stepper-btn dec">-</button>
                    <input type="number" class="stepper-input" placeholder="-" value="${currentVal}">
                    <button class="stepper-btn inc">+</button>
                </div>
            `;
        }
        
        container.appendChild(div);
    });

    // Attach Interactivity for Trackers
    container.querySelectorAll('.segmented-control').forEach(seg => {
        const btns = seg.querySelectorAll('.segment-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                seg.dataset.value = btn.dataset.val;
            });
        });
    });

    container.querySelectorAll('.number-stepper').forEach(step => {
        const input = step.querySelector('.stepper-input');
        const btnDec = step.querySelector('.dec');
        const btnInc = step.querySelector('.inc');

        const updateVal = (newVal) => {
            if (newVal === '' || isNaN(newVal)) newVal = '';
            input.value = newVal;
            step.dataset.value = newVal;
        };

        input.addEventListener('input', (e) => updateVal(e.target.value));

        btnDec.addEventListener('click', () => {
            let val = parseInt(input.value);
            if (isNaN(val)) val = 0;
            updateVal(val - 1);
        });

        btnInc.addEventListener('click', () => {
            let val = parseInt(input.value);
            if (isNaN(val)) val = 0;
            updateVal(val + 1);
        });
    });
}

const closeSettings = document.getElementById('closeSettings');
if (closeSettings) closeSettings.addEventListener('click', () => {
    if (settingsModal) settingsModal.classList.add('hidden');
});

function getFullDataForExport() {
    return {
        entries: getEntries(),
        gemini_api_key: localStorage.getItem('gemini_api_key') || ''
    };
}

const downloadBackupBtn = document.getElementById('downloadBackup');
if (downloadBackupBtn) downloadBackupBtn.addEventListener('click', () => {
    const backupData = getFullDataForExport();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `journai_backup.json`;
    a.click();
});

// Attach manual sync buttons
const forceUploadBtn = document.getElementById('forceUploadBtn');
if (forceUploadBtn) forceUploadBtn.addEventListener('click', handleForceUpload);

const forceDownloadBtn = document.getElementById('forceDownloadBtn');
if (forceDownloadBtn) forceDownloadBtn.addEventListener('click', handleForceDownload);

const uploadBackupBtn = document.getElementById('uploadBackupBtn');
const importFile = document.getElementById('importFile');
if (uploadBackupBtn && importFile) {
    uploadBackupBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (confirm('Deseas restaurar esta copia?')) {
                    if (importedData.entries) {
                        localStorage.setItem('journAI_entries', JSON.stringify(importedData.entries));
                        if (importedData.gemini_api_key) {
                            localStorage.setItem('gemini_api_key', importedData.gemini_api_key);
                        }
                    } else {
                        localStorage.setItem('journAI_entries', JSON.stringify(importedData));
                    }
                    render();
                    if (settingsModal) settingsModal.classList.add('hidden');
                }
            } catch (err) { alert('Error al leer el archivo.'); }
        };
        reader.readAsText(file);
    });
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
        if (settingsModal) settingsModal.classList.add('hidden');
    }
});

// --- PULL TO REFRESH & SWIPE NAVIGATION (MOBILE) ---
let touchStartX = 0;
let touchStartY = 0;
let touchStartPos = 0; // Legacy ref for Y alignment
let pullDistance = 0;
const PTR_THRESHOLD = 150;
const ptrIndicator = document.getElementById('ptrIndicator');
const ptrSpinner = document.querySelector('.ptr-spinner');
const mainContent = document.querySelector('.main-content');
const sidebar = document.querySelector('.sidebar');

window.addEventListener('touchstart', (e) => {
    // Disable PTR if any modal is open
    const isModalOpen = document.querySelector('.modal:not(.hidden), .modal-overlay:not(.hidden)');
    if (isModalOpen) return;

    if (window.scrollY === 0) {
        touchStartX = e.touches[0].pageX;
        touchStartY = e.touches[0].pageY;
        touchStartPos = e.touches[0].pageY;
        // Disable transitions during pull
        if (mainContent) mainContent.style.transition = 'none';
        if (sidebar) sidebar.style.transition = 'none';
    }
}, { passive: false });

window.addEventListener('touchmove', (e) => {
    if (touchStartPos > 0 && window.scrollY === 0) {
        const currentPos = e.touches[0].pageY;
        pullDistance = currentPos - touchStartPos;
        
        if (pullDistance > 10) {
            // CRITICAL: Block the browser's default bounce/rubber-banding to keep UI fixed
            if (e.cancelable) e.preventDefault();

            // Visual feedback - Indicator displacement only
            const dampedDistance = Math.min(pullDistance * 0.4, 120);
            
            if (ptrIndicator) {
                ptrIndicator.style.transition = 'none';
                ptrIndicator.style.opacity = Math.min(pullDistance / 80, 1);
                // Animate ONLY the spinner indicator
                const yPos = -100 + dampedDistance;
                ptrIndicator.style.transform = `translateX(-50%) translateY(${yPos}px)`;
            }
            
            if (ptrSpinner) {
                ptrSpinner.style.transform = `rotate(${pullDistance * 3}deg)`;
            }
        }
    }
}, { passive: false });

window.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].pageX;
    const touchEndY = e.changedTouches[0].pageY;
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const isModalOpen = document.querySelector('.modal:not(.hidden), .modal-overlay:not(.hidden)');

    // Vertical Pull to Refresh logic
    if (pullDistance > PTR_THRESHOLD && !isModalOpen) {
        // Refreshing state - hold indicator in place
        if (ptrIndicator) {
            ptrIndicator.style.transition = 'transform 0.3s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.3s ease';
            ptrIndicator.style.transform = 'translateX(-50%) translateY(20px)';
            ptrIndicator.style.opacity = '1';
        }
        if (ptrSpinner) {
            ptrSpinner.style.animationPlayState = 'running';
        }
        
        // Refresh after showing visual feedback
        setTimeout(() => {
            window.location.reload();
        }, 500);
    } 
    // Horizontal Swipe Navigation logic (Calendar View Changes)
    else if (Math.abs(deltaX) > 70 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5 && !isModalOpen) {
        if (deltaX < -70) {
            // Swipe Left (Moving Content to left) -> Next
            if (activeView === 'days') currentDate.setMonth(currentDate.getMonth() + 1);
            else if (activeView === 'months') currentDate.setFullYear(currentDate.getFullYear() + 1);
            else if (activeView === 'years') currentDate.setFullYear(currentDate.getFullYear() + 12);
            render();
        } else if (deltaX > 70) {
            // Swipe Right (Moving Content to right) -> Previous
            if (activeView === 'days') currentDate.setMonth(currentDate.getMonth() - 1);
            else if (activeView === 'months') currentDate.setFullYear(currentDate.getFullYear() - 1);
            else if (activeView === 'years') currentDate.setFullYear(currentDate.getFullYear() - 12);
            render();
        }
    }

    // Always reset visual indicator and state variables
    if (pullDistance <= PTR_THRESHOLD) {
        if (ptrIndicator) {
            ptrIndicator.style.transition = 'transform 0.4s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.3s ease';
            ptrIndicator.style.transform = 'translateX(-50%) translateY(-100px)';
            ptrIndicator.style.opacity = '0';
        }
    }
    touchStartX = 0;
    touchStartY = 0;
    touchStartPos = 0;
    pullDistance = 0;
}, { passive: false });

// --- HIGHLIGHTS (DESTACADOS) LOGIC ---
function calculateHighlights() {
    const entries = getEntries();
    const highlights = {
        best: { dateKey: null, val: -Infinity, label: 'Mejor Día', icon: '🏆', desc: 'Media más alta' },
        worst: { dateKey: null, val: Infinity, label: 'Día Difícil', icon: '🌑', desc: 'Media más baja' },
        maxMood: { dateKey: null, val: -Infinity, label: 'Día Más Feliz', icon: '😊', desc: 'Ánimo máximo' },
        minMood: { dateKey: null, val: Infinity, label: 'Día Más Triste', icon: '😢', desc: 'Ánimo mínimo' },
        maxHealth: { dateKey: null, val: -Infinity, label: 'Más Saludable', icon: '🍏', desc: 'Salud máxima' },
        minHealth: { dateKey: null, val: Infinity, label: 'Menos Saludable', icon: '🤒', desc: 'Salud mínima' },
        maxActivity: { dateKey: null, val: -Infinity, label: 'Máxima Actividad', icon: '⚡', desc: 'Actividad máxima' },
        minActivity: { dateKey: null, val: Infinity, label: 'Mínima Actividad', icon: '🧘', desc: 'Actividad mínima' }
    };

    let hasData = false;

    for (const [dateKey, entry] of Object.entries(entries)) {
        if (entry.mood === null || entry.activity === null || entry.health === null) continue;
        
        hasData = true;
        const avg = (entry.mood + entry.activity + entry.health) / 3;

        // Better/Worst Day
        if (avg > highlights.best.val) { highlights.best.val = avg; highlights.best.dateKey = dateKey; }
        if (avg < highlights.worst.val) { highlights.worst.val = avg; highlights.worst.dateKey = dateKey; }

        // Mood
        if (entry.mood > highlights.maxMood.val) { highlights.maxMood.val = entry.mood; highlights.maxMood.dateKey = dateKey; }
        if (entry.mood < highlights.minMood.val) { highlights.minMood.val = entry.mood; highlights.minMood.dateKey = dateKey; }

        // Health
        if (entry.health > highlights.maxHealth.val) { highlights.maxHealth.val = entry.health; highlights.maxHealth.dateKey = dateKey; }
        if (entry.health < highlights.minHealth.val) { highlights.minHealth.val = entry.health; highlights.minHealth.dateKey = dateKey; }

        // Activity
        if (entry.activity > highlights.maxActivity.val) { highlights.maxActivity.val = entry.activity; highlights.maxActivity.dateKey = dateKey; }
        if (entry.activity < highlights.minActivity.val) { highlights.minActivity.val = entry.activity; highlights.minActivity.dateKey = dateKey; }
    }

    return hasData ? highlights : null;
}

function renderHighlights() {
    const grid = document.getElementById('highlightsGrid');
    if (!grid) return;
    
    const highlights = calculateHighlights();
    
    if (!highlights) {
        grid.innerHTML = `<div class="info-card" style="grid-column: 1/-1; padding: 3rem;">
            <p>Aún no tienes suficientes datos con métricas para generar destacados. ¡Sigue escribiendo!</p>
        </div>`;
        return;
    }

    grid.innerHTML = '';
    
    Object.values(highlights).forEach(h => {
        if (!h.dateKey) return;
        
        const [y, m, d] = h.dateKey.split('-').map(Number);
        const dateObj = new Date(y, m, d);
        const dateStr = `${d} ${monthNames[m]} ${y}`;
        
        const card = document.createElement('div');
        card.className = 'highlight-card';
        card.innerHTML = `
            <div class="h-header">
                <div class="h-icon">${h.icon}</div>
                <div class="h-info">
                    <span class="h-label">${h.desc}</span>
                    <span class="h-title">${h.label}</span>
                </div>
            </div>
            <div class="h-meta">
                <span class="h-date">${dateStr}</span>
                <span class="h-value">${Number.isInteger(h.val) ? h.val : h.val.toFixed(1)}</span>
            </div>
        `;
        
        card.addEventListener('click', () => {
            openModal(dateObj, true); // true = fromHighlights
        });
        
        grid.appendChild(card);
    });
}

function openHighlights() {
    renderHighlights();
    const modal = document.getElementById('highlightsModal');
    if (modal) modal.classList.remove('hidden');
}

function closeHighlights() {
    const modal = document.getElementById('highlightsModal');
    if (modal) modal.classList.add('hidden');
}

// Global Event Listeners for Highlights
document.addEventListener('DOMContentLoaded', () => {
    const highlightsBtn = document.getElementById('highlightsBtn');
    if (highlightsBtn) highlightsBtn.addEventListener('click', openHighlights);
    
    const closeHighlightsBtn = document.getElementById('closeHighlights');
    if (closeHighlightsBtn) closeHighlightsBtn.addEventListener('click', closeHighlights);
    
    const backToHighlightsBtn = document.getElementById('backToHighlights');
    if (backToHighlightsBtn) {
        backToHighlightsBtn.addEventListener('click', () => {
            closeModal();
            openHighlights();
        });
    }
});

// Update openModal to support back navigation and read-only mode
const originalOpenModal = openModal;
openModal = function(date, fromHighlights = false) {
    originalOpenModal(date);
    
    const modalOverlay = document.getElementById('entryModal');
    const backBtn = document.getElementById('backToHighlights');
    const nxtBtn = document.getElementById('nextStep');
    const textArea = document.getElementById('entryText');
    const sliders = [
        document.getElementById('moodSlider'),
        document.getElementById('activitySlider'),
        document.getElementById('healthSlider')
    ];

    if (fromHighlights) {
        if (modalOverlay) modalOverlay.classList.add('read-only');
        if (backBtn) backBtn.classList.remove('hidden');
        
        if (nxtBtn) {
            const span = nxtBtn.querySelector('span');
            if (span) span.textContent = 'Ver Métricas';
        }

        if (textArea) {
            textArea.disabled = true;
            textArea.readOnly = true;
        }
        sliders.forEach(s => { if (s) s.disabled = true; });
        
        // When coming from highlights, we might want to hide the highlights modal first
        closeHighlights();
    } else {
        if (modalOverlay) modalOverlay.classList.remove('read-only');
        if (backBtn) backBtn.classList.add('hidden');
        
        if (nxtBtn) {
            const span = nxtBtn.querySelector('span');
            if (span) span.textContent = 'Siguiente';
        }

        if (textArea) {
            textArea.disabled = false;
            textArea.readOnly = false;
        }
        sliders.forEach(s => { if (s) s.disabled = false; });
    }
};

// --- AI TEXT REFINEMENT ---
async function refineTextWithAI() {
    const aiBtn = document.getElementById('aiFormatBtn');
    const textArea = document.getElementById('entryText');
    if (!aiBtn || !textArea || !textArea.value.trim()) return;

    const fullText = textArea.value;
    const apiKey = localStorage.getItem('gemini_api_key');
    const selectedModel = localStorage.getItem('gemini_selected_model');
    
    if (!selectedModel) {
        alert('Por favor, selecciona un modelo de IA en el Centro de Control.');
        if (settingsModal) settingsModal.classList.remove('hidden');
        return;
    }

    // Separate Trackers section to protect it
    let textToRefine = fullText;
    let trackersBlock = "";
    const blockStart = fullText.indexOf('\n\n--- Rastreadores ---');
    if (blockStart !== -1) {
        textToRefine = fullText.substring(0, blockStart);
        trackersBlock = fullText.substring(blockStart);
    }

    if (!textToRefine.trim()) {
        alert('No hay texto suficiente para refinar.');
        return;
    }

    try {
        aiBtn.disabled = true;
        aiBtn.classList.add('loading');
        
        // Using dynamic model selection
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${selectedModel}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Refina el siguiente texto de un diario. Elimina muletillas y redundancias, y mejora la separación mediante puntos, comas y párrafos. NO cambies el significado ni el contenido bajo ningún concepto. Devuelve SOLO el texto refinado, sin comentarios ni explicaciones adicionales: \n\n${textToRefine}`
                    }]
                }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            const errorMessage = errorData.error ? errorData.error.message : response.statusText;
            console.error("Detalle completo del error (Refine):", errorData);
            throw new Error(errorMessage);
        }

        const data = await response.json();
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            textArea.value = data.candidates[0].content.parts[0].text.trim() + trackersBlock;
        } else {
            console.error('[AI] Invalid response format', data);
            alert('No se pudo refinar el texto.');
        }
    } catch (err) {
        console.error('[AI] Error:', err);
        alert('Error al conectar con el servicio de IA o modelo no disponible.');
    } finally {
        aiBtn.disabled = false;
        aiBtn.classList.remove('loading');
    }
}

async function fetchGeminiModels() {
    const selector = document.getElementById('modelSelector');
    const apiKey = localStorage.getItem('gemini_api_key');
    
    if (!selector) return;

    if (!apiKey) {
        selector.innerHTML = '<option value="">Clave no configurada</option>';
        return;
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();
        
        if (data.models) {
            // Filter models that support content generation
            const validModels = data.models.filter(m => 
                m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")
            );

            selector.innerHTML = '';
            const savedModel = localStorage.getItem('gemini_selected_model');

            validModels.forEach(model => {
                const opt = document.createElement('option');
                opt.value = model.name; // e.g., "models/gemini-1.5-flash"
                opt.textContent = model.displayName || model.name;
                
                if (savedModel && model.name === savedModel) {
                    opt.selected = true;
                } else if (!savedModel && model.name === 'models/gemini-1.5-flash') {
                    opt.selected = true;
                }
                
                selector.appendChild(opt);
            });
        }
    } catch (err) {
        console.error('[AI Models] Fetch failed:', err);
        selector.innerHTML = '<option value="">Error cargando lista (Verifica tu API Key)</option>';
    }
}

async function handleGoogleDocImport() {
    const fileInput = document.getElementById('importDocFile');
    if (fileInput) fileInput.click();
}

async function processAIImport(text) {
    const importBtn = document.getElementById('importDocBtn');
    const apiKey = localStorage.getItem('gemini_api_key');
    const selectedModel = localStorage.getItem('gemini_selected_model');
    
    if (!apiKey) {
        alert('Por favor, configura tu Gemini API Key en el Centro de Control.');
        if (settingsModal) settingsModal.classList.remove('hidden');
        return;
    }

    if (!selectedModel) {
        alert('Por favor, selecciona un modelo de IA en el Centro de Control.');
        if (settingsModal) settingsModal.classList.remove('hidden');
        return;
    }

    try {
        if (importBtn) {
            importBtn.disabled = true;
            importBtn.querySelector('.btn-title').textContent = 'Procesando con IA...';
        }
        updateSyncStatus('Importando y procesando con IA...', 'syncing');

        // Límite de seguridad para evitar errores de token en archivos masivos
        const truncatedText = text.substring(0, 150000); 
        
        const systemInstruction = "Eres un asistente de extracción de datos. Tu única tarea es leer el siguiente texto de un diario personal, identificar cada entrada diaria y extraer la fecha y el contenido. DEBES responder ÚNICAMENTE con un objeto JSON válido que contenga un array llamado 'entries'. Cada objeto dentro de 'entries' debe tener dos campos: 'date' (en formato YYYY-MM-DD) y 'content' (el texto de la entrada). No incluyas texto adicional, ni saludos, ni formato markdown (sin bloques de código). Solo el JSON crudo.";
        
        const promptText = `${systemInstruction}\n\nTexto del diario:\n\n${truncatedText}`;
        console.log(`[AI Import] Using selected model: ${selectedModel}`);
        
        const url = `https://generativelanguage.googleapis.com/v1beta/${selectedModel}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: {
                    response_mime_type: "application/json"
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            const errorMessage = errorData.error ? errorData.error.message : response.statusText;
            console.error("Detalle completo del error (Import):", errorData);
            throw new Error(errorMessage);
        }

        const data = await response.json();
        let aiExtracted = { entries: [] };
        
        try {
            if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
                throw new Error('La IA no devolvió ninguna respuesta válida.');
            }
            const rawText = data.candidates[0].content.parts[0].text;
            aiExtracted = JSON.parse(rawText);
        } catch (e) {
            console.error('[AI Import] Parsing failed:', e, data);
            throw new Error('La IA no devolvió un formato válido (JSON esperado). Inténtalo de nuevo.');
        }

        if (!Array.isArray(aiExtracted.entries)) {
            throw new Error('El formato de respuesta de la IA no contiene un array de "entries".');
        }

        const currentEntries = getEntries();
        let importedCount = 0;
        let skippedCount = 0;

        for (const entry of aiExtracted.entries) {
            const { date, content } = entry;
            if (!date || !content) continue;

            const dateParts = date.split('-');
            if (dateParts.length === 3) {
                const year = parseInt(dateParts[0]);
                const month = parseInt(dateParts[1]) - 1; // 0-indexed para la app
                const day = parseInt(dateParts[2]);
                const normalizedKey = `${year}-${month}-${day}`;

                // Solo guardamos si no existe ya para ese día o si el actual está vacío
                if (!currentEntries[normalizedKey] || !currentEntries[normalizedKey].text) {
                    currentEntries[normalizedKey] = {
                        text: content.trim(),
                        mood: null,
                        activity: null,
                        health: null
                    };
                    importedCount++;
                } else {
                    skippedCount++;
                }
            }
        }

        if (importedCount > 0) {
            localStorage.setItem('journAI_entries', JSON.stringify(currentEntries));
            render();
            
            updateSyncStatus('Subiendo datos importados a la nube...', 'syncing');
            const syncSuccess = await window.DriveService.syncData(currentEntries);
            
            if (syncSuccess) {
                alert(`¡Importación exitosa! Se han guardado ${importedCount} entradas correctamente. (${skippedCount} ya existían).`);
                updateSyncStatus('Importación completada', 'success');
            } else {
                alert(`Se han guardado ${importedCount} entradas localmente, pero falló la sincronización en la nube.`);
                updateSyncStatus('Error en sincronización post-import', 'error');
            }
        } else {
            alert('No se encontraron entradas nuevas o válidas para importar.');
            updateSyncStatus('Sin cambios tras importación', 'success');
        }

    } catch (err) {
        console.error('[Import] Error total:', err);
        alert('Error al procesar el archivo: ' + err.message);
        updateSyncStatus('Error en importación', 'error');
    } finally {
        if (importBtn) {
            importBtn.disabled = false;
            importBtn.querySelector('.btn-title').textContent = 'Importar con IA';
        }
    }
}

async function handleDeleteAll() {
    console.info('[JournAI] Delete all triggered');
    const confirmMessage = '¿ESTÁS ABSOLUTAMENTE SEGURO? Esta acción es IRREVERSIBLE y eliminará TODAS las entradas de tu diario en este dispositivo y en la nube.';
    
    if (!confirm(confirmMessage)) {
        console.info('[JournAI] Delete all cancelled');
        return;
    }

    console.info('[JournAI] Proceeding with total deletion');

    try {
        updateSyncStatus('Eliminando datos...', 'syncing');
        localStorage.removeItem('journAI_entries');
        
        // Refresh UI
        render();
        checkTodayEntry();
        
        // Sync with cloud (send empty object to wipe cloud file)
        if (window.DriveService) {
            showSyncIndicator();
            const success = await window.DriveService.syncData({});
            if (success) {
                alert('Todo el diario ha sido eliminado con éxito de este dispositivo y de la nube.');
                updateSyncStatus('Diario eliminado y sincronizado', 'success');
            } else {
                alert('Datos eliminados localmente, pero hubo un problema al limpiar la nube. Por favor, intenta sincronizar manualmente.');
                updateSyncStatus('Eliminado local (Error en nube)', 'error');
            }
        } else {
            alert('Todo el diario local ha sido eliminado.');
            updateSyncStatus('Diario local eliminado', 'success');
        }
    } catch (err) {
        console.error('[Delete All] Error:', err);
        alert('Error al intentar eliminar los datos.');
    } finally {
        hideSyncIndicator();
    }
}

// Global Event Listeners Extension
document.addEventListener('DOMContentLoaded', () => {
    const importBtn = document.getElementById('importDocBtn');
    if (importBtn) importBtn.addEventListener('click', handleGoogleDocImport);

    const deleteAllBtn = document.getElementById('deleteAllBtn');
    if (deleteAllBtn) deleteAllBtn.addEventListener('click', handleDeleteAll);

    const importDocFile = document.getElementById('importDocFile');
    if (importDocFile) {
        importDocFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                processAIImport(event.target.result);
            };
            reader.readAsText(file);
        });
    }
});

// Initialize in sequence
async function initApp() {
    render();
    await performStartupSync();
    checkTodayEntry();
    checkAndPerformBackup();
}

initApp();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Register sw.js with a version query to force browser to check it
        navigator.serviceWorker.register('./sw.js?v=20').catch(err => console.log(err));
    });
}

// Global Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Other listeners already initialized at top-level or other DOMContentLoaded blocks
    const aiBtn = document.getElementById('aiFormatBtn');
    if (aiBtn) aiBtn.addEventListener('click', refineTextWithAI);

    const modelSelector = document.getElementById('modelSelector');
    if (modelSelector) {
        modelSelector.addEventListener('change', (e) => {
            localStorage.setItem('gemini_selected_model', e.target.value);
        });
    }
});
