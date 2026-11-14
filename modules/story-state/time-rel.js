// Story-internal relative time inference adapted from BaiBaiBook timeRel.ts.
// Parses standard Gregorian dates (including Chinese numerals and calendar prefixes),
// allows conservative same-month comparisons for fantasy calendars, and returns ''
// whenever dates are ambiguous so callers never mislabel story time.

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DATE_FIELD_SEPARATOR = '[\\s·・•‧∙⋅.．。﹒/／,，、_\\-—–－]*';
const CN_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_NUM_CLASS = '[一二三四五六七八九十两零〇廿卅]';

function normalizeNumericDateSeparators(dateStr) {
    if (!dateStr) return dateStr;
    return String(dateStr)
        .replace(/^(\d{4,})[.．。﹒](\d{1,2})[.．。﹒](\d{1,2})(?![\d.．。﹒])/, '$1/$2/$3')
        .replace(/^(\d{1,2})[.．。﹒](\d{1,2})(?=$|\s)/, '$1/$2');
}

function isFloorOrClockOnlyText(dateStr) {
    if (!dateStr) return true;
    const s = String(dateStr).trim();
    if (/^#\d+(?:\s*[–—\-~→]\s*#?\d+)?$/.test(s)) return true;
    if (/^\d{1,2}[:：]\d{2}(?:\s|$)/.test(s)) return true;
    return s === '旧档汇总' || s === '未记录时间';
}

function looksLikeStructuredNumericDate(dateStr) {
    if (!dateStr) return false;
    return (
        /^(?:\d{4,}[/.\-．。﹒]\d{1,2}[/.\-．。﹒]\d{1,2}|\d{1,2}[/.\-．。﹒]\d{1,2})(?=$|\s)/.test(dateStr) ||
        new RegExp(`^\\d+\\s*年${DATE_FIELD_SEPARATOR}\\d{1,2}\\s*月${DATE_FIELD_SEPARATOR}\\d{1,2}\\s*日?(?=$|\\s)`).test(dateStr) ||
        new RegExp(`^\\d{1,2}\\s*月${DATE_FIELD_SEPARATOR}\\d{1,2}\\s*日?(?=$|\\s)`).test(dateStr)
    );
}

function extractDayNumber(dateStr) {
    if (!dateStr) return null;
    const m = dateStr.match(/(\d+)\s*[日号]/) || dateStr.match(/第\s*(\d+)\s*[日天]?/);
    if (m) return parseInt(m[1], 10);
    return null;
}

function extractMonthIdentifier(dateStr) {
    if (!dateStr) return null;
    const m = dateStr.match(/([^\s\d]+月)/);
    if (m) return m[1];
    const num = dateStr.match(/(?:\d{4}[/-])?(\d{1,2})[/-]\d{1,2}/);
    if (num) return `${num[1]}月`;
    return null;
}

function cnNumToInt(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const str = s.replace(/^初/, '').replace(/廿/g, '二十').replace(/卅/g, '三十');
    if (!str) return null;
    const shiIdx = str.indexOf('十');
    if (shiIdx >= 0) {
        const tens = shiIdx === 0 ? 1 : CN_DIGIT[str[shiIdx - 1]];
        const onesPart = str.slice(shiIdx + 1);
        const ones = onesPart ? CN_DIGIT[onesPart] : 0;
        if (tens === undefined || ones === undefined) return null;
        return tens * 10 + ones;
    }
    if (str.length === 1) return CN_DIGIT[str] ?? null;
    return null;
}

export function parseStoryDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    let s = dateStr.trim();
    if (isFloorOrClockOnlyText(s)) return null;
    s = s.replace(/\s*\([日一二三四五六]\)\s*/g, ' ').trim();
    s = normalizeNumericDateSeparators(s);

    if (/[xX]{2}|[?？]{2}/.test(s)) {
        return { type: 'fantasy', raw: dateStr.trim() };
    }

    const full = s.match(/^(\d{4,})[/-](\d{1,2})[/-](\d{1,2})/);
    if (full) {
        const year = parseInt(full[1], 10);
        const month = parseInt(full[2], 10);
        const day = parseInt(full[3], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { year, month, day, type: 'standard' };
    }

    const short = s.match(/^(\d{1,2})[/-](\d{1,2})(?:\s|$)/);
    if (short) {
        const month = parseInt(short[1], 10);
        const day = parseInt(short[2], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day, type: 'standard' };
    }

    const NUM = `(?:\\d+|${CN_NUM_CLASS}+)`;
    const DAY = `(?:初)?${NUM}`;

    const yearCn = s.match(new RegExp(`(${NUM})\\s*年${DATE_FIELD_SEPARATOR}(${NUM})\\s*月${DATE_FIELD_SEPARATOR}(${DAY})\\s*日?`));
    if (yearCn) {
        const year = cnNumToInt(yearCn[1]);
        const month = cnNumToInt(yearCn[2]);
        const day = cnNumToInt(yearCn[3]);
        if (year != null && month != null && day != null && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const prefixEnd = s.indexOf(yearCn[0]);
            const calendarPrefix = s.substring(0, prefixEnd).trim() || undefined;
            return { year, month, day, type: 'standard', calendarPrefix };
        }
    }

    if (new RegExp(`(?:${NUM})\\s*年`).test(s)) return null;

    const cn = s.match(new RegExp(`(${NUM})\\s*月${DATE_FIELD_SEPARATOR}(${DAY})\\s*日?`));
    if (cn) {
        const month = cnNumToInt(cn[1]);
        const day = cnNumToInt(cn[2]);
        if (month != null && day != null && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return { month, day, type: 'standard' };
        }
    }

    if (looksLikeStructuredNumericDate(s)) return null;
    const monthId = extractMonthIdentifier(s);
    const dayNum = extractDayNumber(s);
    if (monthId || dayNum !== null) {
        return { monthId: monthId ?? undefined, day: dayNum, type: 'fantasy', raw: dateStr.trim() };
    }

    return null;
}

export function calculateRelativeDays(fromDate, toDate) {
    if (!fromDate || !toDate) return null;
    const stripTime = x => normalizeNumericDateSeparators(
        String(x).trim()
            .replace(/\s+\d{1,2}[:：]\d{2}.*$/, '')
            .replace(/\s+(凌晨|早上|上午|中午|下午|傍晚|晚上|深夜|子时|丑时|寅时|卯时|辰时|巳时|午时|未时|申时|酉时|戌时|亥时).*$/i, '')
            .trim(),
    );
    if (stripTime(fromDate) === stripTime(toDate)) {
        return parseStoryDate(fromDate) ? 0 : null;
    }

    const from = parseStoryDate(fromDate);
    const to = parseStoryDate(toDate);
    if (!from || !to) return null;

    if (from.type === 'standard' && to.type === 'standard') {
        const defaultYear = 2024;
        const fromYear = from.year || to.year || defaultYear;
        const toYear = to.year || from.year || defaultYear;
        const fromObj = new Date(0);
        fromObj.setFullYear(fromYear, (from.month ?? 1) - 1, from.day ?? 1);
        const toObj = new Date(0);
        toObj.setFullYear(toYear, (to.month ?? 1) - 1, to.day ?? 1);
        return Math.round((toObj.getTime() - fromObj.getTime()) / DAY_MS);
    }

    if (from.type === 'fantasy' || to.type === 'fantasy') {
        const fromMonth = from.monthId ?? from.month;
        const toMonth = to.monthId ?? to.month;
        if (from.day != null && to.day != null) {
            if (fromMonth && toMonth && fromMonth !== toMonth) return null;
            return to.day - from.day;
        }
        return null;
    }

    return null;
}

function toDatePair(fromDate, toDate) {
    const from = parseStoryDate(fromDate);
    const to = parseStoryDate(toDate);
    if (from?.type !== 'standard' || to?.type !== 'standard') return null;
    const defaultYear = new Date().getFullYear();
    const fromYear = from.year || to.year || defaultYear;
    const toYear = to.year || from.year || defaultYear;
    const f = new Date(0);
    f.setFullYear(fromYear, (from.month ?? 1) - 1, from.day ?? 1);
    const t = new Date(0);
    t.setFullYear(toYear, (to.month ?? 1) - 1, to.day ?? 1);
    return { from: f, to: t };
}

function weekDiffByMonday(from, to) {
    const weekStart = d => {
        const wd = d.getDay();
        const offset = wd === 0 ? -6 : 1 - wd;
        return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + offset);
    };
    return Math.round((weekStart(to) - weekStart(from)) / WEEK_MS);
}

function monthDiff(from, to) {
    return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export function weekdayLabel(timeStr) {
    const s = timeStr?.trim();
    if (!s) return '';
    const d = parseStoryDate(s);
    if (!d || d.type !== 'standard' || d.year == null || d.calendarPrefix) return '';
    const obj = new Date(0);
    obj.setFullYear(d.year, (d.month ?? 1) - 1, d.day ?? 1);
    return `周${WEEKDAY_NAMES[obj.getDay()]}`;
}

export function relativeTimeLabel(eventTime, nowTime) {
    const ev = eventTime?.trim();
    const now = nowTime?.trim();
    if (!ev || !now) return '';

    const days = calculateRelativeDays(ev, now);
    if (days === null || days === undefined) return '';

    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days === 2) return '前天';
    if (days === 3) return '大前天';
    if (days === -1) return '明天';
    if (days === -2) return '后天';
    if (days === -3) return '大后天';

    const fromHasPrefix = !!parseStoryDate(ev)?.calendarPrefix;
    const toHasPrefix = !!parseStoryDate(now)?.calendarPrefix;
    const pair = fromHasPrefix || toHasPrefix ? null : toDatePair(ev, now);

    if (days > 0) {
        if (days < 4) return `${days}天前`;
        if (days >= 4 && days <= 13 && pair) {
            const wd = weekDiffByMonday(pair.from, pair.to);
            if (wd === 1) return `上周${WEEKDAY_NAMES[pair.from.getDay()]}`;
            if (wd === 2) return `上上周${WEEKDAY_NAMES[pair.from.getDay()]}`;
        }
        if (days >= 7 && days < 60 && pair && monthDiff(pair.from, pair.to) === 1) {
            return `上个月${pair.from.getDate()}号`;
        }
        if (days >= 300 && pair) {
            const yearDiff = pair.to.getFullYear() - pair.from.getFullYear();
            if (yearDiff === 1) return `去年${pair.from.getMonth() + 1}月${pair.from.getDate()}日`;
            if (yearDiff === 2) return `前年${pair.from.getMonth() + 1}月${pair.from.getDate()}日`;
        }
        if (days < 30) return `${days}天前`;
        if (days < 365) {
            const md = pair ? monthDiff(pair.from, pair.to) : 0;
            const months = md > 0 ? md : Math.floor(days / 30);
            return `${months}个月前`;
        }
        const years = Math.floor(days / 365);
        const remainMonths = Math.round((days % 365) / 30);
        if (remainMonths > 0 && years < 5) return `${years}年${remainMonths}个月前`;
        return `${years}年前`;
    }

    const abs = Math.abs(days);
    if (abs < 4) return `${abs}天后`;
    if (abs >= 4 && abs <= 13 && pair) {
        const wd = weekDiffByMonday(pair.from, pair.to);
        if (wd === -1) return `下周${WEEKDAY_NAMES[pair.from.getDay()]}`;
        if (wd === -2) return `下下周${WEEKDAY_NAMES[pair.from.getDay()]}`;
    }
    if (abs >= 7 && abs < 60 && pair && monthDiff(pair.from, pair.to) === -1) {
        return `下个月${pair.from.getDate()}号`;
    }
    if (abs < 30) return `${abs}天后`;
    if (abs < 365) {
        const md = pair ? monthDiff(pair.from, pair.to) : 0;
        const months = md < 0 ? Math.abs(md) : Math.floor(abs / 30);
        return `${months}个月后`;
    }
    const years = Math.floor(abs / 365);
    const remainMonths = Math.round((abs % 365) / 30);
    if (remainMonths > 0 && years < 5) return `${years}年${remainMonths}个月后`;
    return `${years}年后`;
}

function parseAgeNumber(raw) {
    const m = raw.trim().match(new RegExp(`^(?:约|大约)?\\s*(\\d{1,3}|${CN_NUM_CLASS}+)\\s*岁?$`));
    if (!m) return null;
    const n = cnNumToInt(m[1]);
    return n != null && n > 0 && n < 1000 ? n : null;
}

function anchorLabel(ageTime) {
    const d = parseStoryDate(ageTime);
    if (d?.type === 'standard' && d.year != null) return `${d.calendarPrefix ?? ''}${d.year}年`;
    return ageTime.trim();
}

export function ageDisplay(age, ageTime, now) {
    const raw = age?.trim();
    if (!raw) return '';
    const anchor = ageTime?.trim();
    const cur = now?.trim();
    if (!anchor || !cur) return raw;

    const days = calculateRelativeDays(anchor, cur);
    const num = parseAgeNumber(raw);
    if (days != null && days >= 0 && days < 365) return raw;
    if (days != null && days >= 365 && num != null) {
        const est = num + Math.floor(days / 365);
        const label = anchorLabel(anchor);
        return label ? `约${est}岁(${label}时${num}岁)` : `约${est}岁`;
    }
    const label = anchorLabel(anchor);
    return label ? `${raw}(${label}时)` : raw;
}

export function splitStoryTimeRange(label) {
    const raw = String(label || '').trim();
    if (!raw || isFloorOrClockOnlyText(raw)) return {};
    const parts = raw.split(/\s+(?:[-–—~→])\s+|\s*[~→]\s*/).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) return { start: parts[0], end: parts[parts.length - 1] };
    return { start: raw, end: raw };
}

function timePointWithRelative(time, now) {
    const value = String(time || '').trim();
    if (!value) return '';
    const parts = [relativeTimeLabel(value, now), weekdayLabel(value)].filter(Boolean);
    return parts.length ? `${value}(${parts.join('·')})` : value;
}

export function formatRelativeStoryRange({ timeStart = '', timeEnd = '', timeLabel = '', isCompressed = false } = {}, now = '') {
    const legacy = timeLabel ? splitStoryTimeRange(timeLabel) : {};
    const start = String(timeStart || legacy.start || '').trim();
    const end = String(timeEnd || legacy.end || '').trim();
    if (!start && !end) return '';
    if (isCompressed && start && end && start !== end) {
        return `${timePointWithRelative(start, now)} - ${timePointWithRelative(end, now)}`;
    }
    const point = end || start;
    const parts = [relativeTimeLabel(point, now), weekdayLabel(point)].filter(Boolean);
    const base = start && end && start !== end ? `${start} - ${end}` : point;
    return parts.length ? `(${parts.join('·')}) ${base}` : base;
}

export function latestStoryTime(store, chat = null, extraRecords = null) {
    if (Array.isArray(chat)) {
        for (let i = chat.length - 1; i >= 0; i--) {
            const mes = typeof chat[i]?.mes === 'string' ? chat[i].mes : '';
            const endTag = mes.match(/<bbs_end\b[^>]*>([\s\S]*?)<\/bbs_end>/i)?.[1]?.trim();
            if (endTag && parseStoryDate(endTag)) return endTag;
            const startTag = mes.match(/<bbs_start\b[^>]*>([\s\S]*?)<\/bbs_start>/i)?.[1]?.trim();
            if (startTag && parseStoryDate(startTag)) return startTag;
        }
    }
    const records = Array.isArray(extraRecords) ? extraRecords : (store?.json?.storyRecords || []);
    const clock = records.filter(record => record?.kind === 'clock').at(-1);
    if (clock) {
        const candidate = String(clock.date || clock.label || '').trim();
        if (candidate && parseStoryDate(candidate)) return candidate;
    }
    const history = store?.summaryHistory || [];
    for (let i = history.length - 1; i >= 0; i--) {
        const batch = history[i];
        const candidates = [batch?.timeEnd, batch?.storyTime, batch?.storyTimeEnd, ...(batch?.memoryTags?.times || [])];
        for (let j = candidates.length - 1; j >= 0; j--) {
            const text = String(candidates[j] || '').trim();
            if (text && parseStoryDate(text)) return text;
        }
    }
    return '';
}
