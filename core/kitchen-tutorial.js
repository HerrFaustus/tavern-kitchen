export const TUTORIAL_SECTIONS = Object.freeze([
    {
        id: 'agents',
        tabLabel: '1. 三类 Agent 与模型',
        title: '3 个后台 Agent 与本地无 Key 模型配置',
        lead: '酒馆后厨把职责清晰拆分给更新、推演、编剧三个自动通道，互不抢占主聊天上下文：',
        blocks: [
            {
                heading: '三大 Agent 各自管什么',
                items: [
                    '更新 Agent：在下一楼回复完成后对前一楼做总结、自动层级压缩（L0 → L1 → L2）与结构化世界状态结算，默认注入剧情。',
                    '推演 Agent：每轮 AI 回复后直接输出非形式化「后台正文」作为主楼延伸，呈现在楼尾「推演框」，不改动结构化档案。',
                    '编剧（StoryPlanner）：按人物与局势目标，直接结合世界状态、分层总结与近期/召回原文自动生成章节与全局创作札记。',
                ],
            },
            {
                heading: '本地无 Key 模型（Ollama / LM Studio / vLLM）怎么填',
                items: [
                    '渠道选择 OpenAI Compatible，地址填入本地服务（例如 http://127.0.0.1:11434/v1 或 :1234/v1）。',
                    'API Key 直接留空：后厨不会伪造占位 Authorization 请求头，本地免鉴权接口可直接通过“测试连接”。',
                    '若代理对 max_tokens / max_completion_tokens 报错，后厨会自动切换兼容字段并记住当前端点的能力。',
                ],
            },
        ],
    },
    {
        id: 'floors',
        tabLabel: '2. 楼尾双框与排队',
        title: '楼尾双框结构：固定延迟总结与独立后台推演',
        lead: '每条叙事 AI 回复下方提供全自动只读的「更新框 + 推演框」双框卡片：',
        blocks: [
            {
                heading: '更新框与推演框怎么协作',
                items: [
                    '上方为「更新框」：当前最新楼层会等待下一楼回复完成后自动总结前楼；已总结楼层默认自动隐藏（保留可视数 0），只留展开查阅。',
                    '下方为「推演框」：每轮回复完成后由推演 Agent 自动生成风味、人物或局势延伸，重Roll/编辑最新楼层不会触发历史回退冲突。',
                    '总结 Agent追赶上来后，会将同一楼层的主楼正文与后台正文视为同类素材，一并计入总结与早期原文召回索引。',
                ],
            },
            {
                heading: '遇到排队中断或错误横幅',
                items: [
                    '正在排队/运行中（黄灯）：耐心等待当前楼层自动推进，无需手工介入。',
                    '请求报错（红灯）：状态栏仅提供“重试本楼 / 前往设置 / 查看恢复”，绑定好模型或修复原文后点击“重试本楼”即可自动继续。',
                ],
            },
        ],
    },
    {
        id: 'world',
        tabLabel: '3. 只读视图与数据',
        title: '只读世界观摩与仅保留的触发入口',
        lead: '所有世界档案、人物、局势与悬念由后台自动结算呈现，不再提供易造成脏数据的手工逐条改写：',
        blocks: [
            {
                heading: '系统触发与仅保留的入口',
                items: [
                    '开局世界生成（生成世界）、编剧札记（立即生成／更新札记）与剧情页「补齐总结 / 从断点重记」均保留触发入口。',
                    '在「数据」页可执行 KitchenCard 整卡导出/导入、来源不一致时的只读预览恢复与孤儿数据清理。',
                    '「设置 → 世界与推演」仅保留街头见闻频率开关（off 降低日常风味密度，仍每轮持续推演）；世界状态默认自动注入剧情。',
                ],
            },
        ],
    },
    {
        id: 'diagnostics',
        tabLabel: '4. 红黄灯与恢复',
        title: '红黄灯故障自查与本地降级说明',
        lead: '当环境权限或服务端接口受限时，后厨优先保障数据不丢并给出明确提示：',
        blocks: [
            {
                heading: '常见状态与自动保护',
                items: [
                    '绿灯（就绪）：楼层进度与世界状态一致；若后台变化命中歧义/待定，系统会自动降级或跳过并记录日志，不会卡死队列。',
                    '黄/红灯（阻断失败）：请检查模型 Key、端点与网络状态；401/403 请在「设置 → API」重新测试连接。',
                    '若宿主未实现服务端文件接口或更换了 Embedding 模型维度，可在「设置 → 剧情与召回」按提示一键重建向量索引。',
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
