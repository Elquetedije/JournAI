const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

let currentDate = new Date();
let selectedDate = null;
let activeFilter = 'mood';
let activeView = 'days'; // 'years', 'months', 'days'

// State management (LocalStorage)
function getEntries() {
    return JSON.parse(localStorage.getItem('journAI_entries') || '{}');
}

function saveEntry(dateKey, text, mood, activity, health) {
    const entries = getEntries();
    entries[dateKey] = { text, mood, activity, health };
    localStorage.setItem('journAI_entries', JSON.stringify(entries));
    render();
}

function deleteEntry(dateKey) {
    const entries = getEntries();
    if (confirm('¿Estás seguro de que deseas eliminar esta entrada?')) {
        delete entries[dateKey];
        localStorage.setItem('journAI_entries', JSON.stringify(entries));
        render();
        return true;
    }
    return false;
}

function getDateKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

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
    moodValue.textContent = moodSlider.value;
    activityValue.textContent = activitySlider.value;
    healthValue.textContent = healthSlider.value;
    
    // Reactive Glow for Modal
    const colors = getColorForValue(parseInt(moodSlider.value));
    const modalContent = document.querySelector('#entryModal .modal-content');
    if (modalContent) {
        modalContent.style.setProperty('--glow-color', colors.glow);
    }
}

moodSlider.addEventListener('input', updateSliderLabels);
activitySlider.addEventListener('input', updateSliderLabels);
healthSlider.addEventListener('input', updateSliderLabels);

// Aggregation Logic
function getAverageMetric(year, month = null) {
    const entries = getEntries();
    let total = 0;
    let count = 0;
    
    Object.keys(entries).forEach(key => {
        const [eYear, eMonth] = key.split('-').map(Number);
        if (eYear === year && (month === null || eMonth === month)) {
            total += entries[key][activeFilter] || 5;
            count++;
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
    viewTitle.textContent = `${monthNames[month]} ${year}`;
    
    const firstDay = new Date(year, month, 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const entries = getEntries();
    
    // Add Weekdays header if not present (handled in HTML but needs cleanup if switching views)
    document.querySelector('.weekdays').style.display = 'grid';

    for (let i = offset; i > 0; i--) {
        calendarGrid.appendChild(createDayElement(daysInPrevMonth - i + 1, 'other-month'));
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(year, month, i);
        const dateKey = getDateKey(date);
        const entry = entries[dateKey];
        const dayDiv = createDayElement(i, new Date().toDateString() === date.toDateString() ? 'today' : '');
        
        if (entry) {
            const colors = getColorForValue(entry[activeFilter]);
            dayDiv.style.backgroundColor = colors.bg;
            dayDiv.style.borderColor = colors.border;
            dayDiv.style.setProperty('--glow-color', colors.glow);
            dayDiv.classList.add('has-entry');
        }
        dayDiv.addEventListener('click', () => openModal(date));
        calendarGrid.appendChild(dayDiv);
    }
}

function renderMonths() {
    const year = currentDate.getFullYear();
    viewTitle.textContent = `${year}`;
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
    viewTitle.textContent = `${baseYear} - ${baseYear + 11}`;
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
viewTitle.addEventListener('click', () => {
    if (activeView === 'days') activeView = 'months';
    else if (activeView === 'months') activeView = 'years';
    render();
});

document.getElementById('prevBtn').addEventListener('click', () => {
    if (activeView === 'days') currentDate.setMonth(currentDate.getMonth() - 1);
    else if (activeView === 'months') currentDate.setFullYear(currentDate.getFullYear() - 1);
    else if (activeView === 'years') currentDate.setFullYear(currentDate.getFullYear() - 12);
    render();
});

document.getElementById('nextBtn').addEventListener('click', () => {
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

document.getElementById('writeTodayBtn').addEventListener('click', () => {
    openModal(new Date());
});

document.getElementById('closeModal').addEventListener('click', closeModal);

function closeModal() {
    entryModal.classList.add('hidden');
}

function openModal(date) {
    selectedDate = date;
    const entries = getEntries();
    const dateKey = getDateKey(date);
    const entry = entries[dateKey];
    
    const isNew = !entry;
    const data = entry || { text: "", mood: 5, activity: 5, health: 5 };
    
    modalDateTitle.textContent = `Entrada: ${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    entryText.value = data.text || "";
    moodSlider.value = data.mood || 5;
    activitySlider.value = data.activity || 5;
    healthSlider.value = data.health || 5;
    updateSliderLabels();
    
    saveIcon.textContent = isNew ? '➕' : '✏️';
    saveText.textContent = isNew ? 'Añadir Entrada' : 'Guardar Cambios';
    
    const deleteBtn = document.getElementById('deleteEntry');
    if (isNew) deleteBtn.classList.add('hidden');
    else deleteBtn.classList.remove('hidden');
    
    entryModal.classList.remove('hidden');
    entryText.focus();
}

document.getElementById('saveEntry').addEventListener('click', () => {
    if (selectedDate) {
        saveEntry(getDateKey(selectedDate), entryText.value, parseInt(moodSlider.value), parseInt(activitySlider.value), parseInt(healthSlider.value));
        closeModal();
    }
});

// Export to Google-Doc compatible format
function exportToFormattedDoc() {
    const entries = getEntries();
    const sortedDates = Object.keys(entries).sort();
    
    let html = `
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 900px; margin: 0 auto; padding: 50px; background: #fff; }
            .doc-header { text-align: center; margin-bottom: 50px; border-bottom: 3px double #333; padding-bottom: 20px; }
            h1 { font-size: 2.5em; margin: 0; }
            h2 { color: #1a1a1a; margin-top: 60px; font-size: 2em; border-bottom: 1px solid #ddd; }
            h3 { color: #444; margin-top: 40px; font-size: 1.5em; border-left: 5px solid #3b82f6; padding-left: 15px; }
            .entry { margin-bottom: 40px; border-bottom: 1px solid #f0f0f0; padding-bottom: 20px; }
            .date { font-weight: 700; font-size: 1.2em; margin-bottom: 8px; }
            .metrics { display: flex; gap: 15px; font-size: 0.85em; color: #666; background: #f8fafc; padding: 8px 12px; border-radius: 6px; margin: 10px 0; }
            .content { font-size: 1.1em; color: #374151; white-space: pre-wrap; line-height: 1.7; }
            @media print { .no-print { display: none; } }
        </style>
    </head>
    <body>
        <h1>JournAI - Diario Estelar Completo</h1>
        <p style="text-align: center; color: #666;">Exportado el ${new Date().toLocaleDateString()}</p>
        
        <div class="toc">
            <h2>Tabla de Contenidos</h2>
            <ul>
    `;

    const structure = {};
    sortedDates.forEach(key => {
        const [year, month, day] = key.split('-').map(Number);
        if (!structure[year]) structure[year] = {};
        if (!structure[year][month]) structure[year][month] = [];
        structure[year][month].push({ day, ...entries[key] });
    });

    Object.keys(structure).sort().forEach(year => {
        html += `<li><a href="#year-${year}">Año ${year}</a></li>`;
    });
    
    html += `</ul></div>`;

    Object.keys(structure).sort().forEach(year => {
        html += `<h2 id="year-${year}">Año ${year}</h2>`;
        Object.keys(structure[year]).sort((a,b) => a-b).forEach(month => {
            html += `<h3 id="year-${year}-month-${month}">${monthNames[month]} ${year}</h3>`;
            structure[year][month].sort((a,b) => a.day - b.day).forEach(entry => {
                html += `
                <div class="entry">
                    <div class="date">${entry.day} de ${monthNames[month]}</div>
                    <div class="metrics">Ánimo: ${entry.mood}/10 | Actividad: ${entry.activity}/10 | Salud: ${entry.health}/10</div>
                    <div class="content">${entry.text || "*Sin texto escrito*"}</div>
                </div>`;
            });
        });
    });

    html += `</body></html>`;
    
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Diario_JournAI_${new Date().getFullYear()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

document.getElementById('exportDoc').addEventListener('click', exportToFormattedDoc);

// Settings Modal Selectors
const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettings = document.getElementById('closeSettings');
const downloadBackupBtn = document.getElementById('downloadBackup');
const uploadBackupBtn = document.getElementById('uploadBackupBtn');
const importFile = document.getElementById('importFile');

// Open/Close Settings
settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
});

closeSettings.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

// Data Management: Download JSON
downloadBackupBtn.addEventListener('click', () => {
    const entries = getEntries();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(entries, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `journai_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
});

// Data Management: Restore JSON
uploadBackupBtn.addEventListener('click', () => {
    importFile.click();
});

importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedData = JSON.parse(event.target.result);
            if (confirm('¿Estás seguro de que deseas restaurar esta copia? Esto sobrescribirá tus datos actuales.')) {
                localStorage.setItem('journAI_entries', JSON.stringify(importedData));
                render();
                settingsModal.classList.add('hidden');
                alert('¡Copia restaurada con éxito!');
            }
        } catch (err) {
            alert('Error al leer el archivo. Asegúrate de que sea un JSON válido.');
        }
    };
    reader.readAsText(file);
});

// Global Keyboard Shortcuts (Premium UX)
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
        settingsModal.classList.add('hidden');
    }
});

// Initial Render
render();

// Service Worker Registration for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registrado', reg))
            .catch(err => console.log('Error al registrar Service Worker', err));
    });
}

