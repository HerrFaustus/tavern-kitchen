export const TUTORIAL_SECTIONS = Object.freeze([
    {
        id: 'agents',
        tabLabel: '1. 三类 Agent 与主 API',
        title: '3 个后台 Agent、「同酒馆主 API」与本地模型',
        lead: '酒馆后厨把职责拆分给总结、推演、编剧三个自动通道，互不抢占主聊天上下文：',
        blocks: [
            {
                heading: '三大 Agent 各自管什么',
                items: [
                    '总结 Agent：在玩家发送下一轮消息前先锁定并完成上一楼总结、自动层级压缩（L0 → L1 → L2）与结构化世界/地图状态结算，并同步开局世界初始化。',
                    '推演 Agent：每条叙事 AI 回复完成后立即独立输出非形式化「后台正文」作为延伸，呈现在楼尾「推演框」，不直接改动结构化世界账本。',
                    '编剧 Agent：结合当前世界状态、分层总结与近期/召回原文，围绕人物与局势生成章节稿与全局创作札记；章节 L2 收束后自动更新。',
                ],
            },
            {
                heading: '快速绑定：「同酒馆主 API」或本地无 Key 模型',
                items: [
                    '在「设置 → API」可直接为总结、推演、编剧三者点「一键全绑同酒馆主 API」，直接复用当前酒馆主聊天补全接口，且不会继承前台窄 max_tokens 上限。',
                    '如需独立或本地无 Key 模型（Ollama / LM Studio / vLLM）：展开「编辑连接」，渠道选 OpenAI Compatible，填写本地地址并将 API Key 留空，向量/重排模型在「检索服务」中独立绑定。',
                ],
            },
        ],
    },
    {
        id: 'floors',
        tabLabel: '2. 总结锁与楼尾双框',
        title: '发送前双层总结锁与楼尾只读双框',
        lead: '每条叙事 AI 回复底部提供只读「更新框 + 推演框」，输入框正上方常驻 Agent 状态横栏：',
        blocks: [
            {
                heading: '发前自动总结与双层总结锁',
                items: [
                    '点击发送下一轮消息前，若存在未总结楼层或尚未确认开局初始化，后厨会先锁定发送按钮、保留输入框草稿并自动跑完总结与世界写库，随后自动放行原发送。',
                    '运行中横栏实时显示当前阶段与已耗时，可点击「取消自动发送」仅完成本楼总结并保留草稿；重 Roll（Swipe）/ 编辑最新楼层不会触发历史回退冲突。',
                ],
            },
            {
                heading: '楼尾双框怎么配合',
                items: [
                    '上方「更新框」展示本楼摘要与世界变更（未总结楼可直接点「手动总结」，最新已结算尾楼支持「重新总结」）；已总结楼层默认自动隐藏（保留可视数 0）。',
                    '下方「推演框」展示该楼独立后台正文，下一轮结算时主楼与后台正文会一并进入总结与早期原文召回索引（主角交易金币仍只核对主楼/玩家实付原话）。',
                ],
            },
        ],
    },
    {
        id: 'world',
        tabLabel: '3. 查阅、搜索与数据',
        title: '只读世界查阅、跨页跳转与数据恢复',
        lead: '所有世界档案、人物、地图、局势与悬念均由后台自动结算呈现，不提供易造成脏数据的手工逐条改写：',
        blocks: [
            {
                heading: '高效查阅与保留的操作入口',
                items: [
                    '总结、人物、局势、悬念、地图与编剧均支持本地即时筛选；点人名、地点或「查看原楼 / 放大地图」可在模块间联动跳转或打开宽弹窗阅读。',
                    '保留的触发入口包括：开局「世界 → 世界生成」、总结页手动补齐 / 从断点重记、编剧「立即生成／更新札记」、数据页后厨卡导入/导出与原位版本恢复。',
                    '「设置 → 世界与推演」仅保留街头见闻频率偏好（关闭/偶尔/活跃）；删除酒馆聊天时自动级联清理世界、札记、向量三库数据。',
                ],
            },
        ],
    },
    {
        id: 'diagnostics',
        tabLabel: '4. 横栏状态与故障自查',
        title: 'Agent 横栏状态说明与常见故障处理',
        lead: '当接口异常、缺少绑定或来源变化时，后厨优先保证数据不错乱并在输入框上方横栏给出原地操作：',
        blocks: [
            {
                heading: '横栏常见状态与排查',
                items: [
                    '待命态：常驻展示已总结/待总结楼数，并提供「手动总结」与「打开后厨」快捷入口。',
                    '运行中：显示阶段文案、实时耗时与「取消自动发送」；若缺 Agent 绑定会直接给出「前往设置」并在绑定保存后放行。',
                    '阻断报错锁定态：报错锁死发送时点「收起」会折叠为紧凑红色锁定条（不会误报待命），点击「展开报错 / 重试 / 前往设置 / 查看恢复」即可继续。',
                    '如更换 Embedding 模型维度或需要补齐早期检索索引，可在「设置 → 剧情与召回」一键补齐或重建向量。',
                ],
            },
        ],
    },
]);

function renderSection(doc, section, state, elements) {
    const { bodyEl, stepEl, prevBtn, nextBtn, tabButtons } = elements;
    const total = TUTORIAL_SECTIONS.length;
    const activeIndex = TUTORIAL_SECTIONS.findIndex(item => item.id === section.id);

    for (const btn of tabButtons) {
        const selected = btn.dataset.sectionId === section.id;
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        btn.tabIndex = selected ? 0 : -1;
    }

    bodyEl.replaceChildren();
    const heading = doc.createElement('h4');
    heading.className = 'tk-tutorial-section-title';
    heading.textContent = section.title;
    const lead = doc.createElement('p');
    lead.className = 'tk-tutorial-lead';
    lead.textContent = section.lead;
    bodyEl.append(heading, lead);

    for (const block of section.blocks) {
        const card = doc.createElement('section');
        card.className = 'tk-tutorial-card';
        const subTitle = doc.createElement('h5');
        subTitle.textContent = block.heading;
        const list = doc.createElement('ul');
        for (const itemText of block.items) {
            const li = doc.createElement('li');
            li.textContent = itemText;
            list.append(li);
        }
        card.append(subTitle, list);
        bodyEl.append(card);
    }

    bodyEl.scrollTop = 0;
    state.index = activeIndex;
    stepEl.textContent = `${activeIndex + 1} / ${total}`;
    prevBtn.disabled = activeIndex <= 0;
    nextBtn.disabled = activeIndex >= total - 1;
}

/**
 * Open or focus the offline interactive Kitchen tutorial dialog.
 *
 * @param {{ doc?: Document, initialSectionId?: string, onClose?: () => void }} [options]
 * @returns {HTMLDialogElement | null}
 */
export function openKitchenTutorial({
    doc = typeof document !== 'undefined' ? document : null,
    initialSectionId = TUTORIAL_SECTIONS[0].id,
    onClose,
} = {}) {
    if (!doc?.body) return null;

    let dialog = doc.getElementById('tk-tutorial-dialog');
    if (dialog) {
        const targetTab = dialog.querySelector(`[data-section-id="${initialSectionId}"]`);
        if (targetTab) targetTab.click();
        if (typeof dialog.showModal === 'function' && !dialog.open) {
            dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
        return dialog;
    }

    dialog = doc.createElement('dialog');
    dialog.id = 'tk-tutorial-dialog';
    dialog.className = 'tk-tutorial-dialog';
    dialog.setAttribute('aria-labelledby', 'tk-tutorial-title');

    const header = doc.createElement('header');
    header.className = 'tk-tutorial-header';
    const title = doc.createElement('h3');
    title.id = 'tk-tutorial-title';
    title.textContent = '酒馆后厨 · 离线使用教程';
    const closeIcon = doc.createElement('button');
    closeIcon.type = 'button';
    closeIcon.className = 'menu_button tk-tutorial-close';
    closeIcon.setAttribute('aria-label', '关闭教程');
    closeIcon.textContent = '✕';
    header.append(title, closeIcon);

    const nav = doc.createElement('div');
    nav.className = 'tk-tutorial-tabs';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', '教程章节');

    const bodyEl = doc.createElement('div');
    bodyEl.className = 'tk-tutorial-body';
    bodyEl.setAttribute('role', 'tabpanel');

    const footer = doc.createElement('footer');
    footer.className = 'tk-tutorial-footer';
    const stepEl = doc.createElement('span');
    stepEl.className = 'tk-tutorial-step';
    const prevBtn = doc.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'menu_button';
    prevBtn.textContent = '上一节';
    const nextBtn = doc.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'menu_button';
    nextBtn.textContent = '下一节';
    const doneBtn = doc.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'menu_button tk-tutorial-done';
    doneBtn.textContent = '我知道了';
    const footerActions = doc.createElement('div');
    footerActions.className = 'tk-tutorial-footer-actions';
    footerActions.append(prevBtn, nextBtn, doneBtn);
    footer.append(stepEl, footerActions);

    const state = { index: 0 };
    const tabButtons = [];
    const elements = { bodyEl, stepEl, prevBtn, nextBtn, tabButtons };

    for (const [idx, section] of TUTORIAL_SECTIONS.entries()) {
        const tab = doc.createElement('button');
        tab.type = 'button';
        tab.className = 'tk-tutorial-tab';
        tab.dataset.sectionId = section.id;
        tab.setAttribute('role', 'tab');
        tab.textContent = section.tabLabel;
        tab.addEventListener('click', () => {
            renderSection(doc, section, state, elements);
        });
        tab.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            event.preventDefault();
            const delta = event.key === 'ArrowRight' ? 1 : -1;
            const nextIndex = (idx + delta + TUTORIAL_SECTIONS.length) % TUTORIAL_SECTIONS.length;
            tabButtons[nextIndex].click();
            tabButtons[nextIndex].focus();
        });
        tabButtons.push(tab);
        nav.append(tab);
    }

    const closeDialog = () => {
        if (typeof dialog.close === 'function' && dialog.open) {
            dialog.close();
        } else {
            dialog.removeAttribute('open');
        }
        onClose?.();
    };

    prevBtn.addEventListener('click', () => {
        if (state.index > 0) tabButtons[state.index - 1].click();
    });
    nextBtn.addEventListener('click', () => {
        if (state.index < TUTORIAL_SECTIONS.length - 1) tabButtons[state.index + 1].click();
    });
    closeIcon.addEventListener('click', closeDialog);
    doneBtn.addEventListener('click', closeDialog);
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) closeDialog();
    });

    dialog.append(header, nav, bodyEl, footer);
    doc.body.append(dialog);

    const initialSection = TUTORIAL_SECTIONS.find(item => item.id === initialSectionId) || TUTORIAL_SECTIONS[0];
    renderSection(doc, initialSection, state, elements);

    if (typeof dialog.showModal === 'function') {
        dialog.showModal();
    } else {
        dialog.setAttribute('open', '');
    }
    return dialog;
}
