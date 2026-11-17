

import { buildTimelineTree, selectTimelineTree, timelineLabel, timelineLabels } from './timeline-tree.js';
import { buildCharacterIdentity } from './data/character-aliases.js';

export const ARCHIVE_COPY = Object.freeze({
    allEvents: '全部剧情', allSubjects: '全部对象', unknownRole: '未标注',
    newest: '最新在前', oldest: '最早在前',
    noResults: '没有找到匹配的内容', noEvents: '还没有剧情记录',
    noEventsHint: '总结当前聊天后，故事的经过会在这里展开。',
    noPeople: '暂无人物记录', noFacts: '暂无世界状态', noAliases: '暂无相关别名',
    eventDetail: '剧情详情', personDetail: '人物档案',
    participants: '参与人物', causes: '前因', noTime: '未标注时间', untitled: '未命名事件',
    noTrajectory: '暂无人物轨迹', disabledChat: '当前聊天已停用',
});

export function getArchiveCharacters(data) {
    const entries = new Map();
    const {resolveName, entityFor, isAmbiguous} = buildCharacterIdentity(data.entities, data.characterAliases);
    
    const add = rawName => {
        const name = resolveName(rawName);
        if (!name || isAmbiguous(rawName)) return;
        const id = entityFor(rawName)?.id || name;
        if (!entries.has(id)) entries.set(id, { name, id });
    };
    for (const entity of data.entities || []) if (entity.kind === 'person') {
        const id = entity.id || entity.name;
        entries.set(id, { name: entity.name, id });
    }
    for (const name of data.legacyCharacterNames || []) add(name);
    for (const item of data.characters.main) add(typeof item === 'string' ? item : item.name);
    for (const relation of data.characters.relationships) { add(relation.from); add(relation.to); }
    for (const alias of data.characterAliases) add(alias.to);
    for (const record of data.storyRecords || []) {
        if (record.kind === 'person') add(record.name);
        if (record.kind === 'knowledge') add(record.person);
        for (const name of record.holders || []) add(name);
    }
    return [...entries.values()];
}

/** Read-only grouping of existing facts. Unknown predicates stay in the situation view. */
export function getWorldFactSection(fact) {
    const predicate = String(fact.p || '');
    if (/当前|目前|正在|临时|现任|局势|状态|动向|进展|计划|战况|天气/.test(predicate)) return 'world';
    return /设定|规则|地理|地形|气候|历史|文化|风俗|法律|制度|种族|物种|能力体系|魔法体系|货币|语言|信仰体系|组织宗旨|起源|背景|常识/.test(predicate) ? 'lore' : 'world';
}

export function getArchiveStateFacts(data, section) {
    return data.facts.filter(fact => !fact.retracted && !/^对.+的/.test(fact.p) && (!section || getWorldFactSection(fact) === section));
}

// Presentation state belongs to this iframe. Data and all writes remain owned by story-summary-ui.
export function createSummaryArchive({ getData, hasChat, getSelectedCharacter, onSelectCharacter, onTimelineChange, onFactsChange, postMsg, setHtml, h }) {
    const $ = id => document.getElementById(id);
    const detail = $('archive-detail');
    let view = 'story';
    let role = '';
    let subject = '';
    let descending = true;
    const expanded = new Set();
    let initialExpansion = true;
    let detailEventId = null;
    let restoreFocus = null, openPerson = null, rosterScroll = 0, sourceKey = null;

    const worldSection = () => document.documentElement.classList.contains('tk-embedded') ? document.documentElement.dataset.kitchenView === 'lore' ? 'lore' : 'world' : undefined;
    const worldFacts = () => getArchiveStateFacts(getData(), worldSection());

    function closeDialogs() {
        for (const dialog of [detail]) {
            if (!dialog.open) continue;
            detailEventId = sourceKey = null;
            dialog.close();
            postMsg('FULLSCREEN_CLOSED');
        }
        if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
        restoreFocus = null;
    }

    function openDialog(dialog) {
        if (!dialog.open) {
            restoreFocus = document.activeElement;
            dialog.showModal();
            postMsg('FULLSCREEN_OPENED');
        }
    }

    function openFloorSource(floor) {
        if (!Number.isInteger(floor) || floor < 0) return;
        sourceKey = `floor:${floor}`;
        $('archive-detail-title').textContent = `第 ${floor + 1} 楼原文`;
        $('archive-detail-body').textContent = '正在读取原楼…';
        openDialog(detail);
        postMsg('WORLD_FIELD_SOURCE', { key: sourceKey, floor, chatId: getData().chatId, branchId: getData().branchId });
    }

    function showEvent(event) {
        detailEventId = event.id;
        $('archive-detail-title').textContent = ARCHIVE_COPY.eventDetail;
        setHtml($('archive-detail-body'), `
            <div class="archive-muted">${h(event.timeLabel || ARCHIVE_COPY.noTime)}</div>
            <h3 class="archive-detail-heading">${h(event.title || ARCHIVE_COPY.untitled)}</h3>
            <p class="archive-detail-text">${h(event.summary || '')}</p>
            ${event.participants?.length ? `<h3>${ARCHIVE_COPY.participants}</h3><div class="archive-participants">${event.participants.map(name => `<span class="archive-text">${h(name)}</span>`).join('')}</div>` : ''}
            `);
        openDialog(detail);
    }

    function timelineEvents() {
        const data = getData();
        const roots = buildTimelineTree(data.rounds || [], data.narrativeUnits || []);
        if (initialExpansion && data.rounds?.length) {
            const latest = data.rounds.reduce((a,b) => (a._addedAt ?? -1) >= (b._addedAt ?? -1) ? a : b);
            const expandLatest = node => {
                if (node.round) return node.round === latest;
                if (!node.children.some(expandLatest)) return false;
                expanded.add(node.id);
                return true;
            };
            roots.some(expandLatest);
            initialExpansion = false;
        }
        return selectTimelineTree(roots, {
            level: role, query: '', descending,
        });
    }

    function timelineItem(node) {
        if (!node.round) {
            const { id, level, start, end, text, reason, evidence } = node;
            return `<details class="timeline-unit" data-unit="${h(id)}" ${expanded.has(id) || node.reveal ? 'open' : ''}>
                <summary><strong>${h(timelineLabel(level))}</strong> <span class="archive-muted">第 ${h(start + 1)}–${h(end + 1)} 楼</span>
                <span class="timeline-unit-text">${h(text)}</span></summary>
                ${reason ? `<p class="archive-muted">收束依据：${h(reason)}</p>` : ''}
                ${evidence ? `<blockquote>第 ${h(evidence.floor)} 楼：${h(evidence.quote)}</blockquote>` : ''}
                <div class="timeline-children">${node.children.map(timelineItem).join('')}</div></details>`;
        }
        const { round: event, index } = node;
        return `<article class="archive-event">
            <div class="archive-event-time">${h(event.timeLabel || '')}</div>
            <div class="archive-event-main">
                <button class="archive-event-title" data-archive-event="${index}">${h(event.title || ARCHIVE_COPY.untitled)}</button>
                <p>${h(event.summary || '')}</p>
                <div class="archive-event-meta">${(event.participants || []).map(name => `<span class="archive-text">${h(name)}</span>`).join('')}<span>${h(event.memoryRole || ARCHIVE_COPY.unknownRole)}</span></div>
            </div>
        </article>`;
    }

    function refreshIndexes() {
        const data = getData();
        const counts = { round: (data.rounds || []).length, stage: 0, chapter: 0 };
        for (const unit of data.narrativeUnits || []) counts[unit.level] = (counts[unit.level] || 0) + 1;
        const extraLevels = [...new Set((data.narrativeUnits || []).map(unit => String(unit.level)))].filter(level => !Object.hasOwn(timelineLabels, level));
        const roles = [...Object.keys(timelineLabels), ...extraLevels].filter(level => counts[level]);
        if (roles.length < 2 || !roles.includes(role)) role = '';
        const totalUnits = Object.values(counts).reduce((sum, count) => sum + count, 0);
        $('archive-story-index').parentElement.hidden = roles.length < 2;
        setHtml($('archive-story-index'), (roles.length > 1 ? ['', ...roles] : []).map(item => `<button class="archive-index-button" data-archive-role="${h(item)}" aria-pressed="${item === role}">${h(timelineLabel(item) || ARCHIVE_COPY.allEvents)}<span>${item ? counts[item] : totalUnits}</span></button>`).join(''));
        $('archive-story-heading').textContent = (timelineLabel(role || (roles.length === 1 ? roles[0] : '')) || ARCHIVE_COPY.allEvents) + '（' + (role ? counts[role] : totalUnits) + '）';
        $('archive-order').textContent = descending ? ARCHIVE_COPY.newest : ARCHIVE_COPY.oldest;
        const facts = worldFacts();
        const subjects = [...new Set(facts.map(f => f.s))];
        if (subject && !subjects.includes(subject)) subject = '';
        setHtml($('archive-world-index'), ['', ...subjects].map(item => `<button class="archive-index-button" data-archive-subject="${h(item)}" aria-pressed="${item === subject}">${h(item || ARCHIVE_COPY.allSubjects)}<span>${item ? facts.filter(f => f.s === item).length : facts.length}</span></button>`).join(''));
        $('archive-world-count').textContent = facts.length;
        $('archive-world-heading').textContent = worldSection() === 'lore' ? '设定' : worldSection() === 'world' ? '局势' : '世界状态';
        $('archive-world-hint').textContent = worldSection() === 'lore' ? '规则、地理、历史等背景记录。' : '当前状态与变化；未明确分类的旧记录也暂列于此。';
        $('archive-world-hint').hidden = !worldSection();
        $('archive-people-count').textContent = getArchiveCharacters(data).length;
    }

    function refreshRoster() {
        const data = getData();
        const characters = getArchiveCharacters(data);
        const roster = $('archive-roster'), page = $('archive-people');
        const current = hasChat() && characters.find(entry => entry.id === getSelectedCharacter());
        if (!current || current.id !== openPerson) openPerson = null;
        const showDetail = !!current && (characters.length === 1 || !!openPerson);
        roster.hidden = showDetail;
        $('archive-people-back').hidden = !(showDetail && characters.length > 1);
        const layout = page.querySelector('.archive-people-layout');
        layout.hidden = !hasChat() || (characters.length > 1 && !showDetail);
        const heading = $('archive-person-name');
        heading.textContent = showDetail ? current.name : '';
        heading.hidden = !showDetail;
        const selectedId = showDetail ? current.id : '';
        if (page.dataset.personId !== selectedId) {
            page.dataset.personId = selectedId;
            page.dispatchEvent(new CustomEvent('kitchen-person-changed'));
        }
        if (showDetail) return;
        if (!hasChat() || !characters.length) {
            setHtml(roster, '<p class="archive-empty">' + (hasChat() ? '这段对话尚无人物记录。' : '选择一段对话后查看人物档案。') + '</p>');
            return;
        }
        setHtml(roster, characters.map(person => {
            const entity = data.entities?.find(item => item.id === person.id);
            const fields = entity?.fields || {};
            const entry = ['身份','职务','称号','当前位置','阵营'].map(key => fields[key]).find(field => field?.nature === 'established_fact' && typeof field.value === 'string' && field.value);
            const duplicate = characters.some(other => other.id !== person.id && other.name === person.name);
            const recent = !duplicate && data.storyRecords?.find(record => record.kind === 'person' && record.name === person.name && record.note);
            const hint = entry?.value || recent?.note || (duplicate ? '档案 ' + person.id : '尚无身份资料');
            return `<button class="archive-person" data-archive-person="${h(person.id)}"><strong>${h(person.name)}</strong><span>${h(hint)}</span></button>`;
        }).join(''));
    }

    function switchView(next) {
        closeDialogs();
        view = next;
        document.querySelector('.archive-hero').hidden = view !== 'story';
        document.querySelectorAll('.archive-tab').forEach(tab => {
            const selected = tab.dataset.view === view;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
            $(`archive-${tab.dataset.view}`).hidden = !selected;
        });
        onTimelineChange();
        onFactsChange();
        refreshRoster();
    }

    function reset() {
        closeDialogs();
        openPerson = null; rosterScroll = 0; sourceKey = null;
        $('archive-roster').closest('.archive').scrollTop = 0;
        expanded.clear(); initialExpansion = true;
        role = '';
        subject = '';
        descending = true;
    }

    document.querySelectorAll('.archive-tab').forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.view));
        tab.addEventListener('keydown', event => {
            const tabs = [...document.querySelectorAll('.archive-tab')];
            const index = tabs.indexOf(tab);
            const target = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
            if (target == null) return;
            event.preventDefault();
            switchView(tabs[target].dataset.view);
            tabs[target].focus();
        });
    });
    $('archive-people-back').addEventListener('click', () => {
        const previous = openPerson;
        openPerson = null; refreshRoster();
        const scroll = $('archive-roster').closest('.archive');
        scroll.scrollTop = rosterScroll;
        [...$('archive-roster').querySelectorAll('button')].find(row => row.dataset.archivePerson === previous)?.focus({preventScroll:true});
    });
    $('archive-order').addEventListener('click', () => {
        descending = !descending;
        refreshIndexes();
        onTimelineChange({ page: 0 });
    });
    $('archive-close').addEventListener('click', () => postMsg('CLOSE_PANEL'));
    document.querySelectorAll('[data-close-archive]').forEach(button => button.addEventListener('click', closeDialogs));
    for (const dialog of [detail]) {
        dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialogs(); });
        dialog.addEventListener('click', event => {
            if (event.target !== dialog) return;
            const bounds = dialog.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialogs();
        });
    }
    document.addEventListener('click', event => {
        const unit = event.target.closest('.timeline-unit > summary')?.parentElement;
        if (unit) {
            if (unit.open) expanded.delete(unit.dataset.unit);
            else expanded.add(unit.dataset.unit);
        }
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.archiveRole != null) { role = button.dataset.archiveRole; refreshIndexes(); onTimelineChange({ page: 0 }); }
        if (button.dataset.archiveSubject != null) { subject = button.dataset.archiveSubject; refreshIndexes(); onFactsChange(); }
        if (button.dataset.archiveEvent != null) showEvent((getData().rounds || [])[Number(button.dataset.archiveEvent)]);
        if (button.dataset.archivePerson != null) {
            if (detail.open) closeDialogs();
            const name = button.dataset.archivePerson;
            const character = getArchiveCharacters(getData()).find(c => c.id === name);
            if (character && view === 'people') {
                rosterScroll = $('archive-roster').closest('.archive').scrollTop;
                openPerson = character.id; onSelectCharacter(character.id);
                $('archive-person-name').focus();
            }
        }
        if (button.dataset.worldProof) {
            sourceKey = button.dataset.worldProof;
            $('archive-detail-title').textContent = '交接来源';
            $('archive-detail-body').textContent = '正在读取原楼…';
            openDialog(detail);
            postMsg('WORLD_FIELD_SOURCE', {key: sourceKey, chatId: getData().chatId, branchId: getData().branchId});
        }
    });
    return {
        showFieldSource(result) {
            const data = getData();
            if (!detail.open || !sourceKey || result.key !== sourceKey || result.chatId !== data.chatId || result.branchId !== data.branchId) return;
            $('archive-detail-body').textContent = result.text == null ? '当前分支无法核对这条原文。' : '第 ' + (result.floor + 1) + ' 楼 · ' + result.name + '\n\n' + result.text;
        },
        closeDialogs, reset, switchView, timelineEvents, timelineItem, refreshIndexes, refreshRoster, openFloorSource,
        hasTimelineFilter: () => !!role,
        isPeopleVisible: () => view === 'people',
        isStoryVisible: () => view === 'story',
        worldFacts,
        filteredFacts: () => worldFacts().filter(f => (!subject || f.s === subject)),
        refresh() {
            refreshIndexes(); refreshRoster();
            if (detail.open && detailEventId != null) {
                const event = (getData().rounds || []).find(e => e.id === detailEventId);
                if (event) showEvent(event); else closeDialogs();
            }
        },
    };
}
