export const TUTORIAL_SECTIONS = Object.freeze([
    {
        id: 'agents',
        tabLabel: '1. Agent 与无 Key 配置',
        title: '3 个 AI Agent 与本地无 Key 模型配置',
        lead: '酒馆后厨把不同职责拆给各自适合的通道，互不抢占主聊天上下文：',
        blocks: [
            {
                heading: '三大通道各自管什么',
                items: [
                    '剧情总结 / 记忆抽取：逐层提炼事件、时间线与状态变更，写入聊天元数据并驱动回顾视图。',
                    'StoryPlanner（推演与开局）：读取世界书、世界档案与近期楼层，生成每章/全球推演与开场投影。',
                    '向量召回（Embedding / Rerank）：把剧情切片本地存入 IndexedDB，在相关对话时精准召回冷记忆。',
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
        id: 'review',
        tabLabel: '2. 待核横幅操作',
        title: '待核横幅怎么点：生成、重试与手动放行',
        lead: '当某一楼出现网络抖动、编辑回退或待确认记忆时，顶部或状态栏会亮起横幅：',
        blocks: [
            {
                heading: '遇到“待核”或中断时按顺序排查',
                items: [
                    '正在排队/运行中（黄灯）：耐心等待当前楼层完成，切勿连续狂点“生成”触发重复请求。',
                    '请求报错（红灯）：先看报错里的 HTTP 状态码与“展开详情”；临时 429/503 会自动退避重试最多 2 次，仍失败时点击“重试本楼”。',
                    '聊天发生删楼 / 重roll / 切换分支：受影响楼层会自动标为待重建或清理孤儿记录，重新生成即可对齐。',
                ],
            },
            {
                heading: '确认无误后的操作',
                items: [
                    '想微调某段记忆：在对应事件卡片中直接编辑并保存，所有联动视图会同步刷新。',
                    '确认仅是提醒、无需重跑：点击“通过 / 忽略待核”即可恢复常规自动步进。',
                ],
            },
        ],
    },
    {
        id: 'world',
        tabLabel: '3. 世界书与导出',
        title: '世界档案增删改与 KitchenCard / 向量导出',
        lead: '世界档案、人物关系与时间线统一存放在当前聊天的权威状态中，改一处全域一致：',
        blocks: [
            {
                heading: '世界档案与剧情修改',
                items: [
                    '在「世界设定」「人物」「线索与伏笔」页签可直接新增、编辑或删除条目。',
                    '每次提交都会同步更新当前聊天元数据并刷新缓存，不再需要手动多处复制。',
                    '群聊与单聊同样支持：向量库按聊天维度隔离，删聊天时关联数据库会自动清理。',
                ],
            },
            {
                heading: '迁移与备份建议',
                items: [
                    '换设备或长期存档：在「数据管理 / KitchenCard」页签导出整张卡与记忆包。',
                    '重装扩展前：可先导出 `.zip` 向量包；在同模型、同维度下可直接导入秒恢复，省去重新 Embedding 的费用。',
                ],
            },
        ],
    },
    {
        id: 'diagnostics',
        tabLabel: '4. 红黄灯自查',
        title: '红黄灯故障自查与本地降级说明',
        lead: '当环境权限或服务端接口受限时，后厨优先保障数据不丢并给出明确提示：',
        blocks: [
            {
                heading: '常见状态灯含义',
                items: [
                    '绿灯（就绪）：所有楼层与当前世界状态一致，新消息发送后将按配置自动接力。',
                    '黄灯（处理中 / 待核）：存在后台队列、大对话降级确认或升级自检提醒，按提示点击操作即可。',
                    '红灯（阻断失败）：请检查「展开详情」中的状态码；401/403 请核对 Key 与端点前缀（系统已自动脱敏，可放心截图排查）。',
                ],
            },
            {
                heading: '跨宿主（如 TauriTavern）与升级提示',
                items: [
                    '若宿主未实现 /api/files/upload 或 /api/chats/get（返回 404/405/501），后厨会自动切换浏览器 IndexedDB 本地镜像并保留完整读写与冲突检测。',
                    '若切换了不同维度的 Embedding 模型触发维度不匹配提示，请在向量面板点击“重建向量索引”，切勿跨维度混用。',
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
