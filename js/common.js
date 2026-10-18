// js/common.js - общие функции для всех инструментов Caps Game

const CONFIG = {
    NANO: 1e9,
    FIRESTORE_QUERY: "https://firestore.googleapis.com/v1/projects/capsgame-prod/databases/(default)/documents:runQuery",
    CACHE_TTL_MS: 15 * 60 * 1000,
    COLLECTIONS_API: "https://firestore.googleapis.com/v1/projects/capsgame-prod/databases/(default)/documents/Static/CapsCollections",
    STORAGE_BASE: "https://firebasestorage.googleapis.com/v0/b/capsgame-prod.appspot.com/o/",
    USERS_API: (tgId) => `https://firestore.googleapis.com/v1/projects/capsgame-prod/databases/(default)/documents/Users/${tgId}`,
    SQUADS_INFO_API: (squadId) => `https://firestore.googleapis.com/v1/projects/capsgame-prod/databases/(default)/documents/SquadsV2/${squadId}`,
    SQUADS_REQUESTS_API: (squadId) => `https://firestore.googleapis.com/v1/projects/capsgame-prod/databases/(default)/documents/SquadsV2/${squadId}/Requests`,
    CAPS_GD_V1: "https://firestore.googleapis.com/v1/projects/capsgame-prod/databases/(default)/documents/CapsGD/v1",
    CAPS_GD_V1_MASK: (fields) => {
        const mask = fields.map(f => `mask.fieldPaths=${encodeURIComponent(f)}`).join('&');
        return `https://firestore.googleapis.com/v1/projects/capsgame-prod/databases/(default)/documents/CapsGD/v1?${mask}`;
    },
    SQUAD_ID: '-1002917473074',
    PAGE_SIZE: 50,
    GRADE_ORDER: ['COMMON', 'COMMON_PLUS', 'RARE', 'RARE_PLUS', 'EPIC', 'EPIC_PLUS', 'LEGEND', 'LEGEND_PLUS', 'DIAMOND'],
};

// ============= FIRESTORE-ХЕЛПЕРЫ =============

async function firestoreGet(url) {
    const response = await fetch(url);
    if (!response.ok) {
        if (response.status === 404) throw new Error('Документ не найден (404)');
        throw new Error(`Ошибка API: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

async function firestoreQuery(body) {
    const response = await fetch(CONFIG.FIRESTORE_QUERY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        throw new Error(`Ошибка API: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
        throw new Error('Неверный формат ответа от сервера');
    }
    return data;
}

async function fetchGameConfig(maskFields = []) {
    const cacheKey = `capsgd:${maskFields.slice().sort().join(',')}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const url = maskFields.length > 0
        ? CONFIG.CAPS_GD_V1_MASK(maskFields)
        : CONFIG.CAPS_GD_V1;

    const doc = await firestoreGet(url);
    cacheSet(cacheKey, doc);
    return doc;
}

// ============= ПАРСЕРЫ FIRESTORE-ТИПОВ =============

function parseFirestoreValue(val, defaultValue = null) {
    if (!val) return defaultValue;
    if (val.integerValue !== undefined) return parseInt(val.integerValue);
    if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
    if (val.stringValue !== undefined) return val.stringValue;
    if (val.booleanValue !== undefined) return val.booleanValue;
    if (val.timestampValue !== undefined) return val.timestampValue;
    if (val.nullValue !== undefined) return null;
    if (val.mapValue !== undefined) return val.mapValue.fields || {};
    if (val.arrayValue !== undefined) return val.arrayValue.values || [];
    return defaultValue;
}

function parseFirestoreMap(mapVal) {
    return mapVal?.mapValue?.fields || {};
}

function parseFirestoreArray(arrayVal) {
    return arrayVal?.arrayValue?.values || [];
}

function parseFirestoreNumber(val, defaultValue = null) {
    if (!val) return defaultValue;
    if (val.integerValue !== undefined) return parseInt(val.integerValue);
    if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
    return defaultValue;
}

function isFirestoreScalar(val) {
    return val && (
        val.integerValue !== undefined ||
        val.doubleValue !== undefined ||
        val.stringValue !== undefined ||
        val.booleanValue !== undefined
    );
}

function getFieldValue(fields, fieldName, defaultValue = null) {
    if (!fields || !fields[fieldName]) return defaultValue;
    return parseFirestoreValue(fields[fieldName], defaultValue);
}

function safeNumber(value, defaultValue = 0) {
    if (value === undefined || value === null) return defaultValue;
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
}

// ============= УТИЛИТЫ =============

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function formatNumber(num) {
    return num?.toLocaleString() || '0';
}

function formatNumberShort(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 10_000) return (n / 1000).toFixed(1) + 'k';
    return n.toLocaleString('ru-RU');
}

function formatTime(timestampValue) {
    if (!timestampValue) return '—';
    const date = new Date(timestampValue);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ============= КЭШ =============

function cacheGet(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.t > CONFIG.CACHE_TTL_MS) {
            localStorage.removeItem(key);
            return null;
        }
        return parsed.v;
    } catch { return null; }
}

function cacheSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
    } catch {}
}

// ============= КОЛЛЕКЦИИ =============

const COLLECTION_TYPES = {
    common:    { label: 'Common',    emoji: '📀', color: '#94a3b8', bg: '#e2e8f0' },
    special:   { label: 'Special',   emoji: '✨', color: '#16a34a', bg: '#dcfce7' },
    event:     { label: 'Event',     emoji: '🎉', color: '#2563eb', bg: '#dbeafe' },
    community: { label: 'Community', emoji: '👥', color: '#9333ea', bg: '#f3e5f5' },
    premium:   { label: 'Premium',   emoji: '💎', color: '#b45309', bg: '#fef3c7' }
};

function getCollectionTypeInfo(type) {
    return COLLECTION_TYPES[type] || { label: type || 'Other', emoji: '🎴', color: '#64748b', bg: '#e2e8f0' };
}

function getCollectionStatusInfo(status) {
    const map = {
        'available':     { emoji: '✅', label: 'Доступна',  color: '#16a34a', bg: '#dcfce7' },
        'sold-out':      { emoji: '🔒', label: 'Продана',   color: '#b91c1c', bg: '#fee2e2' },
        'not-available': { emoji: '🚧', label: 'Скоро',     color: '#b45309', bg: '#fef3c7' }
    };
    return map[status] || { emoji: '❓', label: status || '—', color: '#64748b', bg: '#e2e8f0' };
}

function buildCollectionLogoUrl(collectionId) {
    const path = `collections/${collectionId}/logo.png`;
    return `${CONFIG.STORAGE_BASE}${encodeURIComponent(path)}?alt=media`;
}

function buildCollectionChipUrl(collectionId, number) {
    const path = `collections/${collectionId}/${number}.png`;
    return `${CONFIG.STORAGE_BASE}${encodeURIComponent(path)}?alt=media`;
}

async function fetchCollectionsList() {
    try {
        const data = await firestoreGet(CONFIG.COLLECTIONS_API);
        if (!data.fields?.collections?.arrayValue?.values) return [];

        const list = data.fields.collections.arrayValue.values
            .map(item => {
                const f = item.mapValue.fields;
                const id = getFieldValue(f, 'id');
                if (!id) return null;

                let order = 0;
                if (f.order?.doubleValue !== undefined) order = parseFloat(f.order.doubleValue);
                else if (f.order?.integerValue !== undefined) order = parseInt(f.order.integerValue, 10);
                if (isNaN(order)) order = 0;

                const designedByFields = f.designedBy?.mapValue?.fields || null;
                const designedBy = designedByFields ? {
                    name: getFieldValue(designedByFields, 'name', null),
                    type: getFieldValue(designedByFields, 'type', null),
                    image: getFieldValue(designedByFields, 'image', null)
                } : null;

                return {
                    id,
                    title: getFieldValue(f, 'title', 'Без названия'),
                    status: getFieldValue(f, 'status', 'unknown'),
                    size: safeNumber(getFieldValue(f, 'size', 0)),
                    supply: safeNumber(getFieldValue(f, 'supply', 0)),
                    used: safeNumber(getFieldValue(f, 'used', 0)),
                    burned: safeNumber(getFieldValue(f, 'burned', 0)),
                    type: getFieldValue(f, 'type', 'common'),
                    order,
                    system: safeNumber(getFieldValue(f, 'system', 0)),
                    releasedAt: f.releasedAt?.timestampValue || null,
                    hasCustomDiamond: getFieldValue(f, 'hasCustomDiamond', false),
                    hasLogo: getFieldValue(f, 'hasLogo', false),
                    isStandard: getFieldValue(f, 'isStandard', false),
                    isCommunity: getFieldValue(f, 'isCommunity', false),
                    isSpecial: getFieldValue(f, 'isSpecial', false),
                    designedBy
                };
            })
            .filter(Boolean);

        const byType = {};
        for (const c of list) {
            (byType[c.type] ||= []).push(c);
        }
        for (const t of Object.keys(byType)) {
            byType[t].sort((a, b) => a.order - b.order);
        }

        const TYPE_ORDER = ['common', 'special', 'event', 'community', 'premium'];
        const flat = [];
        for (const t of TYPE_ORDER) {
            if (byType[t]) flat.push(...byType[t]);
        }
        for (const t of Object.keys(byType)) {
            if (!TYPE_ORDER.includes(t)) flat.push(...byType[t]);
        }

        return flat;
    } catch (err) {
        console.error('Ошибка загрузки коллекций:', err);
        return [];
    }
}

// ============= RECRUITER =============

function buildImageUrl(path) {
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const encodedPath = encodeURIComponent(path);
    return `${CONFIG.STORAGE_BASE}${encodedPath}?alt=media`;
}

async function fetchPlayerProfile(tgId) {
    const apiUrl = CONFIG.USERS_API(tgId);
    const response = await fetch(apiUrl);
    if (!response.ok) {
        if (response.status === 404) throw new Error('Игрок не найден. Проверьте TG ID');
        throw new Error(`Ошибка API: ${response.status}`);
    }
    const data = await response.json();
    if (!data.fields) throw new Error('Неверный формат ответа');
    return data;
}

function getUrlParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

function getSortedGrades(gradeStats) {
    const result = [];
    for (const grade of CONFIG.GRADE_ORDER) {
        if (gradeStats[grade] > 0) {
            result.push({ grade, count: gradeStats[grade] });
        }
    }
    return result;
}

function getGradeClass(grade) {
    const classes = {
        'COMMON': 'grade-common',
        'COMMON_PLUS': 'grade-common-plus',
        'RARE': 'grade-rare',
        'RARE_PLUS': 'grade-rare-plus',
        'EPIC': 'grade-epic',
        'EPIC_PLUS': 'grade-epic-plus',
        'LEGEND': 'grade-legend',
        'LEGEND_PLUS': 'grade-legend-plus',
        'DIAMOND': 'grade-diamond'
    };
    return classes[grade] || 'grade-common';
}

// ============= SQUADS =============

async function fetchSquadInfo(squadId) {
    const url = CONFIG.SQUADS_INFO_API(squadId);
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

async function fetchRequestsPage(squadId, pageToken = null) {
    let url = `${CONFIG.SQUADS_REQUESTS_API(squadId)}?pageSize=${CONFIG.PAGE_SIZE}`;
    if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }
    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) return { requests: [], nextPageToken: null };
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const documents = data.documents || [];
        const nextPageToken = data.nextPageToken || null;

        const requests = documents.map(doc => {
            const fields = doc.fields || {};
            const nameParts = doc.name.split('/');
            const requestId = nameParts[nameParts.length - 1];
            const status = getFieldValue(fields, 'status', 'UNKNOWN');
            const createdAt = getFieldValue(fields, 'createdAt', null);
            const updatedAt = getFieldValue(fields, 'updatedAt', null);
            const userId = getFieldValue(fields, 'userId', requestId);

            return {
                id: requestId,
                userId: userId || requestId,
                status: status,
                createdAt: createdAt,
                updatedAt: updatedAt,
                raw: doc
            };
        });

        return { requests, nextPageToken };
    } catch (err) {
        console.error('Ошибка загрузки заявок:', err);
        throw err;
    }
}

async function fetchAllRequests(squadId) {
    let all = [];
    let pageToken = null;
    let hasMore = true;

    while (hasMore) {
        const result = await fetchRequestsPage(squadId, pageToken);
        all = all.concat(result.requests);
        pageToken = result.nextPageToken;
        hasMore = !!pageToken;
    }

    return all;
}

// ============= FINDER =============

const STATUS_MAP = {
    'SALE': { emoji: '💰', label: 'На продаже', color: '#22c55e' },
    'READY': { emoji: '✅', label: 'Готова', color: '#fbbf24' },
    'STAKED': { emoji: '💎', label: 'В стейкинге', color: '#3b82f6' },
    'WITHDRAWN': { emoji: '📤', label: 'Выведена', color: '#8b5cf6' },
    'BURNED': { emoji: '🔥', label: 'Сожжена', color: '#ef4444' },
    'LOCKED': { emoji: '🔒', label: 'Заблокирована', color: '#6b7280' },
    'BANNED': { emoji: '🚫', label: 'Забанена', color: '#dc2626' },
    'NFT_EDITING': { emoji: '✏️', label: 'Редактирование NFT', color: '#f59e0b' }
};

// Цвета по мотивам игры (плоские). gradient — опционально для мест, где можно применить background.
const GRADE_MAP = {
    'COMMON':      { label: 'Common',   color: '#94a3b8', gradient: null },
    'COMMON_PLUS': { label: 'Common+',  color: '#94a3b8', gradient: null },
    'RARE':        { label: 'Rare',     color: '#2c53db', gradient: null },
    'RARE_PLUS':   { label: 'Rare+',    color: '#2c53db', gradient: null },
    'EPIC':        { label: 'Epic',     color: '#8b1fbc', gradient: 'linear-gradient(360deg,#6811c4 0%,#b526a4 100%)' },
    'EPIC_PLUS':   { label: 'Epic+',    color: '#8b1fbc', gradient: 'linear-gradient(360deg,#6811c4 0%,#b526a4 100%)' },
    'LEGEND':      { label: 'Legend',   color: '#f0b428', gradient: 'linear-gradient(174deg,#eec51f,#dc8f3d,#ff9936,#f6cc1f)' },
    'LEGEND_PLUS': { label: 'Legend+',  color: '#f0b428', gradient: 'linear-gradient(174deg,#eec51f,#dc8f3d,#ff9936,#f6cc1f)' },
    'DIAMOND':     { label: 'Diamond',  color: '#7a8aff', gradient: 'linear-gradient(#527fff 50%,#9d95ff 100%)' }
};

function getStatusInfo(status) {
    return STATUS_MAP[status] || { emoji: '❓', label: status || 'Неизвестно', color: '#6b7280' };
}

function getGradeInfo(grade) {
    return GRADE_MAP[grade] || { label: grade || 'Unknown', color: '#6b7280', gradient: null };
}

// Возвращает background-значение: gradient если есть, иначе плоский цвет.
function getGradeBg(grade) {
    const info = getGradeInfo(grade);
    return info.gradient || info.color;
}

async function searchCapsByNumber(number) {
    const query = {
        structuredQuery: {
            from: [{ collectionId: "Caps" }],
            where: {
                fieldFilter: {
                    field: { fieldPath: "number" },
                    op: "EQUAL",
                    value: { integerValue: String(number) }
                }
            },
            limit: 200
        }
    };
    return firestoreQuery(query);
}

// ============= FLOOR =============

async function fetchCollectionFloors(collectionId) {
    const cacheKey = `floor-v4:${collectionId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    async function queryOne(grade, currency) {
        const query = {
            structuredQuery: {
                from: [{ collectionId: "Caps" }],
                where: {
                    compositeFilter: {
                        op: "AND",
                        filters: [
                            { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "SALE" } } },
                            { fieldFilter: { field: { fieldPath: "collectionId" }, op: "EQUAL", value: { stringValue: collectionId } } },
                            { fieldFilter: { field: { fieldPath: "grade" }, op: "EQUAL", value: { stringValue: grade } } },
                            { fieldFilter: { field: { fieldPath: "priceCurrency" }, op: "EQUAL", value: { stringValue: currency } } }
                        ]
                    }
                },
                orderBy: [{ field: { fieldPath: "price" }, direction: "ASCENDING" }],
                limit: 1
            }
        };

        try {
            const data = await firestoreQuery(query);
            if (data.length === 0 || !data[0].document) return null;

            const f = data[0].document.fields || {};
            const raw = f.price?.integerValue !== undefined
                ? parseInt(f.price.integerValue)
                : (f.price?.doubleValue !== undefined ? parseFloat(f.price.doubleValue) : null);
            if (raw === null || isNaN(raw)) return null;

            return raw / CONFIG.NANO;
        } catch {
            return null;
        }
    }

    const tasks = [];
    for (const grade of CONFIG.GRADE_ORDER) {
        tasks.push(queryOne(grade, 'ton').then(v => ({ grade, currency: 'ton', price: v })));
        tasks.push(queryOne(grade, 'sol').then(v => ({ grade, currency: 'sol', price: v })));
    }

    const results = await Promise.all(tasks);

    const byGrade = {};
    for (const grade of CONFIG.GRADE_ORDER) {
        byGrade[grade] = { ton: null, sol: null };
    }
    for (const r of results) {
        if (r.price !== null && r.price !== undefined) {
            byGrade[r.grade][r.currency] = r.price;
        }
    }

    cacheSet(cacheKey, byGrade);
    return byGrade;
}

async function fetchDiamondFloor(collectionId) {
    const floors = await fetchCollectionFloors(collectionId);
    return floors?.DIAMOND?.ton ?? null;
}

// ============= STAKING =============

async function fetchActiveStakingSpeeds() {
    const cacheKey = 'staking:speeds';
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    try {
        const doc = await fetchGameConfig(['staking']);
        const staking = doc.fields?.staking?.mapValue?.fields || {};
        const speeds = staking.speeds?.mapValue?.fields || {};
        const configs = staking.configs?.arrayValue?.values || [];

        const sortedConfigs = configs
            .map(c => c.mapValue.fields)
            .filter(f => f.from?.timestampValue)
            .sort((a, b) => new Date(b.from.timestampValue) - new Date(a.from.timestampValue));

        const latest = sortedConfigs[0];
        const snapshotName = latest?.speed?.stringValue || 'pause';
        if (snapshotName === 'pause') {
            const empty = { name: 'pause', data: {} };
            cacheSet(cacheKey, empty);
            return empty;
        }

        const snapshot = speeds[snapshotName]?.mapValue?.fields || {};
        const data = {};
        for (const [collectionId, colVal] of Object.entries(snapshot)) {
            const grades = colVal?.mapValue?.fields || {};
            data[collectionId] = {};
            for (const [gradeKey, gradeVal] of Object.entries(grades)) {
                if (gradeKey === 'compound' || gradeKey === 'bonuses') continue;
                const num = gradeVal.doubleValue !== undefined
                    ? parseFloat(gradeVal.doubleValue)
                    : (gradeVal.integerValue !== undefined ? parseInt(gradeVal.integerValue) : null);
                if (num !== null) data[collectionId][gradeKey] = num;
            }
        }

        const result = { name: snapshotName, data };
        cacheSet(cacheKey, result);
        return result;
    } catch (err) {
        console.error('Ошибка загрузки скоростей стейкинга:', err);
        return { name: null, data: {} };
    }
}

// ============= ПРОЧЕЕ =============

function showToast(message, type = 'info') {
    console.log(`[${type}] ${message}`);
}

// ============= ЭКСПОРТ =============

window.CapsTools = {
    CONFIG,
    // Firestore
    firestoreGet,
    firestoreQuery,
    fetchGameConfig,
    // Парсеры
    parseFirestoreValue,
    parseFirestoreMap,
    parseFirestoreArray,
    parseFirestoreNumber,
    isFirestoreScalar,
    getFieldValue,
    safeNumber,
    // Утилиты
    escapeHtml,
    formatNumber,
    formatNumberShort,
    formatTime,
    // Коллекции
    fetchCollectionsList,
    // Recruiter
    fetchPlayerProfile,
    getUrlParam,
    getSortedGrades,
    getGradeClass,
    // Squads
    fetchSquadInfo,
    fetchRequestsPage,
    fetchAllRequests,
    // Общее
    buildImageUrl,
    // Finder
    getStatusInfo,
    getGradeInfo,
    getGradeBg,
    searchCapsByNumber,
    showToast,
    STATUS_MAP,
    GRADE_MAP,
    COLLECTION_TYPES,
    getCollectionTypeInfo,
    getCollectionStatusInfo,
    buildCollectionLogoUrl,
    buildCollectionChipUrl,
    // Кэш
    cacheGet,
    cacheSet,
    // Market
    fetchCollectionFloors,
    fetchDiamondFloor,
    // Staking
    fetchActiveStakingSpeeds,
};