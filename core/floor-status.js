import { paidPrice } from '../modules/world-records/turn-actions.js';

/** Validates required agents (`update`, `simulation`) and emits a non-blocking status notice if optional `planner` is unbound. */
export async function preflightOrderedFloorAgents({ floor, checkAgent, render, abort, throwOnRequired = false }) {
    // WHY: Check required agents before queue.beforeGeneration so an unconfigured-agent block
    // fails closed immediately instead of pausing generation indefinitely while waiting to resume.
    try {
        await checkAgent('update');
        await checkAgent('simulation');
    } catch (error) {
        render({ floor, message: error.message, error });
        abort?.();
        if (throwOnRequired) throw error;
        return false;
    }
    // WHY: StoryPlanner is optional until chapter compression triggers; warn non-blockingly so chat
    // generation is never aborted merely because the user has not bound a planner model yet.
    try {
        await checkAgent('planner');
    } catch (error) {
        render({ floor, message: `${error.message}（未配置编剧前暂不生成章节札记，正文继续）`, agent: 'planner' });
    }
    return true;
}

export function resolveFailureRoute(error) {
    const message = String(error?.message || error || '');
    if (/proposals|提案|待核/i.test(message) && !/数据页|原文|原位/.test(message)) return 'situation';
    if (/原文|来源不一致|来源|损坏|数据页|原位|回退|corrupt|mismatch/i.test(message)) return 'data';
    if (/世界|冲突|版本|分支|后楼|conflict|version|branch/i.test(message)) return 'world';
    return 'data';
}

/** Builds `#tk-floor-status` purely from DOM primitives so floor-host and unit tests share identical review controls. */
export function renderFloorStatus({
    doc,
    info,
    hasChat,
    entry,
    readOwner,
    isCurrentFailure,
    onRetry,
    onOpenAgent,
    onOpenRecovery,
    onSaveFloorWork,
}) {
    if (!info) return null;
    const statusNode = doc.createElement('div');
    statusNode.id = 'tk-floor-status';
    statusNode.setAttribute('role', info.error ? 'alert' : 'status');
    const title = doc.createElement('span');
    title.textContent = hasChat ? `后厨 · 第 ${info.floor + 1} 楼 · ${info.message}` : `后厨 · ${info.message}`;
    statusNode.append(title);

    const appendButton = (parent, label, action) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'menu_button';
        b.textContent = label;
        b.addEventListener('click', () => {
            Promise.resolve().then(action).catch(e => { title.textContent = e.message; });
        });
        parent.append(b);
    };

    if (info.error) {
        appendButton(statusNode, '重试本楼', onRetry);
        appendButton(
            statusNode,
            info.error.agent ? '前往设置' : '查看恢复',
            () => (info.error.agent ? onOpenAgent(info.error.agent) : onOpenRecovery(resolveFailureRoute(info.error))),
        );
        for (const [id, item] of Object.entries(entry?.review || {})) {
            if (entry.decisions?.[id] === 'rejected') continue;
            const card = doc.createElement('div');
            card.className = 'tk-review-card';
            card.dataset.effectId = id;
            const baseRows = entry?.editedGroups?.[id] || item.rows;
            const draftRows = structuredClone(baseRows);
            const refSelections = { ...(entry?.resolvedRefs?.[id] || {}) };
            const corrections = draftRows.filter(r => r.type === 'trade' && paidPrice(r.paymentQuote) !== null && r.price !== paidPrice(r.paymentQuote));
            const why = doc.createElement('span');
            why.textContent = draftRows.map(r => (r.type === 'trade'
                ? `${r.quote} · 模型价 ${r.price} 金币 · 收付依据「${r.paymentQuote}」`
                : `${r.quote}（${r.field || r.type}）`)).join('、') + (item.reason ? ` — ${item.reason}` : '');
            card.append(why);

            let ambiguitySelect = null;
            if (item.ambiguity?.candidates?.length) {
                const wrap = doc.createElement('label');
                wrap.className = 'tk-review-field';
                const cap = doc.createElement('span');
                cap.textContent = `选择对象「${item.ambiguity.ref}」`;
                ambiguitySelect = doc.createElement('select');
                ambiguitySelect.dataset.reviewRef = item.ambiguity.ref;
                for (const candidate of item.ambiguity.candidates) {
                    const opt = doc.createElement('option');
                    opt.value = candidate.id;
                    opt.textContent = `${candidate.name} (${candidate.kind})`;
                    ambiguitySelect.append(opt);
                }
                if (refSelections[item.ambiguity.ref]) ambiguitySelect.value = refSelections[item.ambiguity.ref];
                ambiguitySelect.addEventListener('change', () => { refSelections[item.ambiguity.ref] = ambiguitySelect.value; });
                wrap.append(cap, ambiguitySelect);
                card.append(wrap);
            }

            for (let idx = 0; idx < draftRows.length; idx++) {
                const row = draftRows[idx];
                const origRow = baseRows[idx] || row;
                const editRow = doc.createElement('div');
                editRow.className = 'tk-review-edits';
                const addInput = (labelText, field, value, type, onInput) => {
                    const label = doc.createElement('label');
                    label.className = 'tk-review-field';
                    const span = doc.createElement('span');
                    span.textContent = labelText;
                    const input = doc.createElement('input');
                    input.type = type;
                    input.dataset.reviewField = field;
                    input.value = value;
                    input.addEventListener('input', () => onInput(input.value));
                    label.append(span, input);
                    editRow.append(label);
                };
                addInput('引文', 'quote', row.quote ?? '', 'text', v => { row.quote = v; });
                if (row.type === 'trade') {
                    addInput('成交价', 'price', row.price == null ? '' : String(row.price), 'number', v => {
                        const n = Number(v);
                        if (Number.isSafeInteger(n) && n > 0) {
                            row.price = n;
                            row.priceEdited = true;
                        }
                    });
                    addInput('收付依据', 'paymentQuote', row.paymentQuote ?? '', 'text', v => { row.paymentQuote = v; });
                } else if (row.type === 'set' && (typeof origRow.value !== 'object' || origRow.value === null)) {
                    addInput('属性值', 'value', row.value == null ? '' : String(row.value), 'text', v => {
                        if (typeof origRow.value === 'number' && v.trim() !== '' && Number.isFinite(Number(v))) row.value = Number(v);
                        else if (typeof origRow.value === 'boolean' && (v === 'true' || v === 'false')) row.value = v === 'true';
                        else row.value = v;
                    });
                }
                card.append(editRow);
            }

            const confirmWrap = doc.createElement('label');
            confirmWrap.className = 'tk-review-confirm';
            const confirmCheck = doc.createElement('input');
            confirmCheck.type = 'checkbox';
            confirmCheck.dataset.reviewConfirmed = 'true';
            const confirmText = doc.createElement('span');
            confirmText.textContent = '已人工核对';
            confirmWrap.append(confirmCheck, confirmText);
            card.append(confirmWrap);

            const commitReview = async decisionValue => {
                const owner = readOwner();
                if (ambiguitySelect && item.ambiguity?.ref) refSelections[item.ambiguity.ref] = ambiguitySelect.value;
                await onSaveFloorWork(
                    entry.source,
                    () => { if (readOwner() !== owner || !isCurrentFailure()) throw new Error('请重新核对本楼'); },
                    record => {
                        (record.editedGroups ??= {})[id] = draftRows;
                        if (Object.keys(refSelections).length) (record.resolvedRefs ??= {})[id] = { ...refSelections };
                        if (decisionValue) (record.decisions ??= {})[id] = decisionValue;
                    },
                );
                await onRetry();
            };

            appendButton(card, '应用修改并重试', () => commitReview(confirmCheck.checked ? 'accepted' : null));
            const accept = corrections.length ? '按原文价确认（' + corrections.map(r => paidPrice(r.paymentQuote) + ' 金币').join('、') + '）' : '确认该组';
            appendButton(card, accept, () => commitReview('accepted'));
            appendButton(card, '拒绝该组', async () => {
                const owner = readOwner();
                await onSaveFloorWork(
                    entry.source,
                    () => { if (readOwner() !== owner || !isCurrentFailure()) throw new Error('请重新核对本楼'); },
                    record => { (record.decisions ??= {})[id] = 'rejected'; },
                );
                await onRetry();
            });
            statusNode.append(card);
        }
    } else if (info.agent) {
        appendButton(statusNode, '前往设置', () => onOpenAgent(info.agent));
    }
    return statusNode;
}
