const PERSONAL_CLIENT_ID = window.CONFIG?.PERSONAL_CLIENT_ID || '';
const PERSONAL_CLIENT_SECRET = window.CONFIG?.PERSONAL_CLIENT_SECRET || '';
const PERSONAL_REFRESH_TOKEN = window.CONFIG?.PERSONAL_REFRESH_TOKEN || '';

class DriveService {
    static async getAccessToken() {
        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: PERSONAL_CLIENT_ID,
                    client_secret: PERSONAL_CLIENT_SECRET,
                    refresh_token: PERSONAL_REFRESH_TOKEN,
                    grant_type: 'refresh_token'
                })
            });

            if (!response.ok) throw new Error('Failed to refresh token');
            const data = await response.json();
            return data.access_token;
        } catch (e) {
            console.error('[DriveService] Token Error:', e);
            throw e;
        }
    }

    static async findOrCreateRecursiveFolder(accessToken, path) {
        const parts = path.split('/').filter(p => p.length > 0);
        let parentId = 'root';

        for (const part of parts) {
            parentId = await this.findOrCreateFolder(accessToken, part, parentId);
        }
        return parentId;
    }

    static async findOrCreateFolder(accessToken, folderName, parentId = 'root') {
        let q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        if (parentId !== 'root') {
            q += ` and '${parentId}' in parents`;
        }
        const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id, name)`;
        
        const res = await fetch(searchUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!res.ok) throw new Error('Folder search failed');
        
        const data = await res.json();
        if (data.files && data.files.length > 0) return data.files[0].id;

        // Create folder
        const metadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder'
        };
        if (parentId !== 'root') {
            metadata.parents = [parentId];
        }

        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(metadata)
        });
        if (!createRes.ok) throw new Error('Folder creation failed');
        const createData = await createRes.json();
        return createData.id;
    }

    static async findOrCreateFile(accessToken, filename, folderId, content) {
        const q = `name='${filename}' and '${folderId}' in parents and trashed=false`;
        const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id, name)`;
        
        const res = await fetch(searchUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!res.ok) throw new Error('File search failed');
        
        const data = await res.json();
        if (data.files && data.files.length > 0) {
            // Update existing
            const fileId = data.files[0].id;
            await this.updateFile(accessToken, fileId, content);
            return fileId;
        }

        // Create new
        const metadata = {
            name: filename,
            parents: [folderId],
            mimeType: 'application/json'
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([content], { type: 'application/json' }));

        const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: form
        });
        if (!createRes.ok) throw new Error('File creation failed');
        const createData = await createRes.json();
        return createData.id;
    }

    static async updateFile(accessToken, fileId, content) {
        const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
        const res = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: content
        });
        if (!res.ok) throw new Error('File update failed');
    }

    static async findFile(accessToken, filename, mimeType, folderId) {
        let q = `name='${filename}' and mimeType='${mimeType}' and trashed=false`;
        if (folderId) q += ` and '${folderId}' in parents`;
        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const data = await res.json();
        return data.files && data.files.length > 0 ? data.files[0].id : null;
    }

    static async createEmptyDoc(accessToken, filename, folderId) {
        const metadata = {
            name: filename,
            mimeType: 'application/vnd.google-apps.document',
            parents: [folderId]
        };
        const res = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata)
        });
        const data = await res.json();
        return data.id;
    }

    static async getDoc(accessToken, docId) {
        const url = `https://docs.googleapis.com/v1/documents/${docId}?includeTabsContent=true`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!res.ok) {
            const err = await res.json();
            console.warn('[DriveService] Google Docs API Error:', err.error?.message || 'Unknown error');
            return null;
        }
        return await res.json();
    }

    static async performGoogleDocExport(dataByYear) {
        try {
            console.log('[DriveService] --- FASE 1: Creando pestañas principales (Años) ---');
            const token = await this.getAccessToken();
            const folderId = await this.findOrCreateRecursiveFolder(token, 'AI/Gems/Background til journal 2');
            const filename = 'JournAI Export';
            
            let docId = await this.findFile(token, filename, 'application/vnd.google-apps.document', folderId);
            if (docId) {
                await fetch(`https://www.googleapis.com/drive/v3/files/${docId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            }
            docId = await this.createEmptyDoc(token, filename, folderId);

            const years = Object.keys(dataByYear).sort((a,b) => b - a);
            if (years.length === 0) return true;

            // FASE 1: Crear años únicamente
            const phase1Requests = years.map(year => ({ 
                addDocumentTab: { tabProperties: { title: year } } 
            }));

            const res1 = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ requests: phase1Requests })
            });

            if (!res1.ok) {
                const err = await res1.json();
                console.error('[DriveService] Error FASE 1:', err);
                throw new Error(err.error?.message);
            }

            const data1 = await res1.json();
            const yearToTabId = {};
            years.forEach((year, index) => {
                const reply = data1.replies[index].addDocumentTab;
                // Ruta defensiva: API v1 puede devolverlo en tabId o tabProperties.tabId
                yearToTabId[year] = reply.tabId || reply.tabProperties?.tabId;
                console.log(`[DriveService] Padre: ${year} -> ID: ${yearToTabId[year]}`);
            });

            // FASE 2: Crear subpestañas (Meses) vinculadas
            console.log('[DriveService] --- FASE 2: Jerarquía (Meses) ---');
            const monthOrder = [];
            const phase2Requests = [];

            years.forEach(year => {
                const months = Object.keys(dataByYear[year]).sort((a,b) => b - a);
                months.forEach(month => {
                    const monthName = window.monthNames[month];
                    monthOrder.push({ year, month });
                    phase2Requests.push({
                        addDocumentTab: {
                            tabProperties: {
                                title: monthName,
                                parentTabId: yearToTabId[year]
                            }
                        }
                    });
                });
            });

            const res2 = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ requests: phase2Requests })
            });

            if (!res2.ok) {
                const err = await res2.json();
                console.error('[DriveService] Error FASE 2:', err);
                throw new Error(err.error?.message);
            }

            const data2 = await res2.json();
            const monthToTabId = {};
            monthOrder.forEach((item, index) => {
                const reply = data2.replies[index].addDocumentTab;
                monthToTabId[`${item.year}-${item.month}`] = reply.tabId || reply.tabProperties?.tabId;
            });

            // FASE 3: Inserción de texto
            console.log('[DriveService] --- FASE 3: Volcado de Contenido ---');
            const phase3Requests = [];
            
            years.forEach(year => {
                Object.keys(dataByYear[year]).sort((a,b) => b - a).forEach(month => {
                    const tabId = monthToTabId[`${year}-${month}`];
                    const monthName = window.monthNames[month];
                    let text = `${monthName.toUpperCase()} ${year}\n\n`;
                    Object.keys(dataByYear[year][month]).sort((a,b) => b - a).forEach(day => {
                        const entry = dataByYear[year][month][day];
                        text += `[${day}/${parseInt(month)+1}/${year}] Mood: ${entry.mood}\n${entry.text}\n\n`;
                    });

                    phase3Requests.push({
                        insertText: { location: { tabId: tabId, index: 1 }, text: text }
                    });
                });
            });

            const res3 = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ requests: phase3Requests })
            });

            if (res3.ok) {
                console.log('[DriveService] Exportación con Subpestañas Completada.');
                return true;
            }
            return false;
        } catch (e) {
            console.error('[DriveService] Fallo Crítico:', e.message);
            return false;
        }
    }

    static async performGoogleDocOutlineExport(token, dataByYear, docId) {
        try {
            console.log('[DriveService] Populating Document Outline via Docs API...');
            
            // Step 1: Get Doc to see internal index
            const doc = await this.getDoc(token, docId);
            const endIndex = doc.body.content[doc.body.content.length - 1].endIndex;

            // Step 2: Clear content (if not empty) and Insert Text
            let fullText = "JOURNAI - DIARIO ESTELAR\n\n";
            const stylingRequests = [];
            let currentIdx = 1; // Content starts at 1
            
            // Header
            stylingRequests.push({ 
                updateParagraphStyle: { range: { startIndex: 1, endIndex: fullText.length }, paragraphStyle: { alignment: 'CENTER', namedStyleType: 'TITLE' }, fields: 'alignment,namedStyleType' } 
            });
            currentIdx = fullText.length + 1;

            const years = Object.keys(dataByYear).sort((a,b) => b - a);
            years.forEach(year => {
                const yearText = `${year}\n`;
                const yearStart = currentIdx;
                fullText += yearText;
                currentIdx += yearText.length;
                stylingRequests.push({
                    updateParagraphStyle: { range: { startIndex: yearStart, endIndex: currentIdx }, paragraphStyle: { namedStyleType: 'HEADING_1' }, fields: 'namedStyleType' }
                });

                Object.keys(dataByYear[year]).sort((a,b) => b - a).forEach(month => {
                    const monthName = window.monthNames[month];
                    const monthText = `${monthName} ${year}\n`;
                    const monthStart = currentIdx;
                    fullText += monthText;
                    currentIdx += monthText.length;
                    stylingRequests.push({
                        updateParagraphStyle: { range: { startIndex: monthStart, endIndex: currentIdx }, paragraphStyle: { namedStyleType: 'HEADING_2' }, fields: 'namedStyleType' }
                    });

                    Object.keys(dataByYear[year][month]).sort((a,b) => b - a).forEach(day => {
                        const entry = dataByYear[year][month][day];
                        const entryText = `[${day}/${parseInt(month)+1}/${year}]\nMood: ${entry.mood}\n${entry.text}\n\n`;
                        fullText += entryText;
                        currentIdx += entryText.length;
                    });
                });
            });

            const requests = [
                // Clear existing
                { deleteContentRange: { range: { startIndex: 1, endIndex: Math.max(2, endIndex - 1) } } },
                // Insert new text
                { insertText: { location: { index: 1 }, text: fullText } },
                // Apply styles
                ...stylingRequests
            ];

            const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ requests })
            });

            if (!res.ok) {
                const err = await res.json();
                console.error('[DriveService] Outline update failed:', err);
                throw new Error(err.error?.message);
            }

            console.log('[DriveService] Professional Outline (Native) completed successfully');
            return true;
        } catch (e) {
            console.error('[DriveService] Outline Fallback Error:', e.message);
            return false;
        }
    }

    static async performGoogleDocOutlineExport(token, dataByYear) {
        try {
            console.log('[DriveService] Fallback to Google Doc Outline export (Permissions limited)...');
            const folderId = await this.findOrCreateRecursiveFolder(token, 'AI/Gems/Background til journal 2');
            const filename = 'JournAI Export';
            
            let html = `<html><head><meta charset="UTF-8"></head><body>`;
            html += `<h1 style="text-align:center">JournAI - Diario Estelar</h1><hr>`;

            const years = Object.keys(dataByYear).sort((a,b) => b - a);
            years.forEach(year => {
                html += `<h1>${year}</h1>`;
                Object.keys(dataByYear[year]).sort((a,b) => b - a).forEach(month => {
                    const monthName = window.monthNames[month];
                    html += `<h2>${monthName} ${year}</h2>`;
                    Object.keys(dataByYear[year][month]).sort((a,b) => b - a).forEach(day => {
                        const entry = dataByYear[year][month][day];
                        html += `<h3>${day} de ${monthName}</h3><p>${entry.text}</p>`;
                    });
                });
            });
            html += `</body></html>`;

            let docId = await this.findFile(token, filename, 'application/vnd.google-apps.document', folderId);
            const metadata = { name: filename, mimeType: 'application/vnd.google-apps.document', parents: folderId ? [folderId] : [] };
            const boundary = '-------314159265358979323846';
            const body = "\r\n--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + "\r\n--" + boundary + "\r\nContent-Type: text/html\r\n\r\n" + html + "\r\n--" + boundary + "--";

            const url = docId ? `https://www.googleapis.com/upload/drive/v3/files/${docId}?uploadType=multipart` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
            const method = docId ? 'PATCH' : 'POST';

            await fetch(url, {
                method: method,
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
                body: body
            });
            return true;
        } catch (e) {
            return false;
        }
    }
}

window.DriveService = DriveService;
