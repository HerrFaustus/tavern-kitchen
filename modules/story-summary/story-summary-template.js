/**
 * Semantic markup for the story-summary surface (mounted directly inside an Open Shadow DOM host).
 * Contains zero <script> tags and zero legacy boot-spinner wrappers.
 */
export const STORY_SUMMARY_MARKUP = `
    <div class="archive">
        <div class="archive-topbar">
            <div class="archive-brand">总结</div>
            <div class="archive-actions">
                <button class="archive-icon" id="archive-close" aria-label="关闭总结" title="关闭总结">×</button>
            </div>
        </div>
        <div class="archive-hero">
            <div class="archive-meta"><span>已总结 <b id="stat-summarized">0</b> 楼</span><span>待总结 <b id="stat-pending">0</b> 楼</span><span id="archive-chat-state" hidden></span><div class="stat-warning hidden" id="pending-warning">再删1条将回滚</div></div>
            <div class="summary-generate-bar archive-actions"><button class="btn btn-p" id="btn-generate"></button></div>
        </div>
        <div class="archive-nav">
            <nav class="archive-tabs" role="tablist" aria-label="剧情档案">
                <button class="archive-tab" id="archive-tab-story" role="tab" data-view="story" aria-selected="true" aria-controls="archive-story">剧情 <span id="stat-events">0</span></button>
                <button class="archive-tab" id="archive-tab-people" role="tab" data-view="people" aria-selected="false" aria-controls="archive-people" tabindex="-1">人物 <span id="archive-people-count">0</span></button>
                <button class="archive-tab" id="archive-tab-world" role="tab" data-view="world" aria-selected="false" aria-controls="archive-world" tabindex="-1">世界 <span id="archive-world-count">0</span></button>
            </nav>
        </div>
        <div id="summary-notice" class="summary-notice" hidden>
            <div id="summary-status" class="summary-status" role="status" aria-live="polite"></div>
            <button id="btn-dismiss-summary" class="summary-dismiss" type="button" hidden></button>
        </div>
        <div class="archive-content">
            <section id="archive-story" role="tabpanel" aria-labelledby="archive-tab-story" class="archive-story">
                <aside class="archive-index">
                    <div class="archive-label">剧情索引</div>
                    <nav id="archive-story-index" aria-label="总结层级"></nav>
                </aside>
                <div class="archive-reading">
                    <div class="archive-section-head">
                        <h2 id="archive-story-heading">全部剧情</h2>
                        <div class="archive-actions">
                            <button class="archive-text" id="archive-tree-toggle" hidden>展开全部</button>
                            <button class="archive-text" id="archive-order">最新在前</button>
                            <button class="archive-text" id="tl-paging-toggle" aria-pressed="false" aria-controls="tl-pager">分页</button>
                        </div>
                    </div>
                    <div class="tk-filter-bar tk-story-toolbar" id="archive-story-toolbar">
                        <input type="search" class="tk-filter-input" id="archive-story-search" placeholder="筛选剧情摘要、人物或时间…" aria-label="筛选剧情摘要">
                    </div>
                    <div class="tl-pager hidden" id="tl-pager">
                        <button class="tl-pg-btn" id="tl-pg-first" aria-label="第一页">«</button>
                        <button class="tl-pg-btn" id="tl-pg-prev" aria-label="上一页">‹</button>
                        <div class="tl-pg-strip" id="tl-pg-strip"></div>
                        <input type="number" class="tl-pg-num" id="tl-pg-num" min="1" value="1" title="跳转到指定页">
                        <button class="tl-pg-btn" id="tl-pg-next" aria-label="下一页">›</button>
                        <button class="tl-pg-btn" id="tl-pg-last" aria-label="最后一页">»</button>
                    </div>
                    <div id="timeline-list"></div>
                </div>
            </section>
            <section id="archive-people" role="tabpanel" aria-labelledby="archive-tab-people" hidden>
                <div class="tk-filter-bar tk-people-toolbar" id="archive-people-toolbar" hidden>
                    <input type="search" class="tk-filter-input" id="archive-people-search" placeholder="搜索人物姓名或身份…" aria-label="搜索人物">
                    <button type="button" class="btn btn-sm" id="archive-people-presence-toggle" aria-pressed="false">仅看在场</button>
                </div>
                <div class="archive-roster" id="archive-roster"></div>
                <button type="button" class="archive-text" id="archive-people-back" hidden>返回人物列表</button>
                <div class="archive-people-layout">
                    <div class="archive-person-head">
                        <h2 id="archive-person-name" tabindex="-1"></h2>
                    </div>
                    <div id="archive-profile-home">
                        <section class="archive-profile" id="archive-profile">
                            <div id="profile-content"></div>
                        </section>
                    </div>
                </div>
            </section>
            <section id="archive-world" role="tabpanel" aria-labelledby="archive-tab-world" hidden>
                <div class="tk-filter-bar tk-world-toolbar" id="archive-world-toolbar">
                    <input type="search" class="tk-filter-input" id="archive-world-search" placeholder="筛选局势、风物或世界条目…" aria-label="筛选局势与世界条目">
                </div>
                <div class="archive-world-layout">
                    <nav class="archive-world-index" id="archive-world-index" aria-label="世界状态对象"></nav>
                    <div><div class="archive-section-head"><h2 id="archive-world-heading">世界状态</h2></div><p id="archive-world-hint" class="archive-muted" hidden></p><div id="facts-list"></div></div>
                </div>
            </section>
        </div>
    </div>

    <section id="data-page" hidden aria-label="后厨数据">
    <div id="data-overview">
        <h3>后厨数据</h3><p id="kitchen-card-counts">读取当前聊天的数据…</p>
        <p>后厨卡保存总结、世界与地图、编剧札记；设置和召回缓存不包含在内。</p>
        <p id="kitchen-card-status" role="status"></p>
    </div>
    <div id="data-controls">
        <section id="kitchen-card-actions">
            <button class="btn" id="btn-export-kitchen-card">导出后厨卡</button>
            <button class="btn" id="btn-import-kitchen-card">导入后厨卡</button>
            <input id="kitchen-card-file" type="file" accept=".json,application/json" hidden>
        </section>
        <section id="world-recovery" hidden aria-label="世界版本与恢复"></section>
    </div>
    </section>

    <section id="recall-page" hidden aria-label="每轮召回记录">
        <div class="recall-page-head">
            <h3>每轮召回结果</h3>
            <label class="recall-round-picker">
                <span>查看轮次</span>
                <select id="recall-round-select" aria-label="选择召回轮次"></select>
            </label>
        </div>
        <div id="recall-empty" class="recall-empty"></div>
        <div id="recall-detail" class="recall-detail" hidden></div>
        <details class="recall-raw-diagnostics" id="recall-diagnostics-wrap" hidden>
            <summary>原始诊断日志</summary>
            <pre id="recall-diagnostics-log" class="debug-log-viewer"></pre>
        </details>
    </section>

    <dialog class="archive-drawer" id="archive-detail" aria-labelledby="archive-detail-title">
        <div class="archive-drawer-head"><h2 id="archive-detail-title"></h2><button class="archive-icon" data-close-archive="" aria-label="返回档案">×</button></div>
        <div class="archive-drawer-body" id="archive-detail-body"></div>
    </dialog>

    <!-- Settings Workspace (设置 → 剧情与召回) -->
    <div class="summary-workspace" id="settings-modal">
        <div class="workspace-shell">
            <div id="settings-config-status" class="settings-config-status" role="status" aria-live="polite" hidden>
                <span id="settings-config-message"></span>
                <button type="button" class="btn btn-sm" id="settings-config-retry" hidden></button>
            </div>
            <div class="workspace-layout"><div class="modal-body">
                <section class="settings-section summary-group" id="settings-retention-section">
                    <h3 class="settings-section-title">总结原文保留<small class="workspace-scope">全局</small></h3>
                    <label class="archive-setting"><span>隐藏已总结楼层 · <strong id="summarized-count">0</strong> 楼</span><input type="checkbox" id="hide-summarized"></label>
                    <label class="archive-setting"><span>保留最近原文（轮）</span><input type="number" id="keep-visible-count" min="0" max="50" value="0"></label>
                </section>
                <section class="settings-section summary-group" id="settings-recall-section">
                    <h3 class="settings-section-title">原文召回与向量<small class="workspace-scope">全局 / 此聊天</small></h3>
                    <p class="settings-hint">原文检索默认启用；配置向量模型后自动补齐向量，重排模型可选。未配置向量模型时仍可使用关键词检索。</p>
                    <label class="archive-setting"><span>按需注入相关早期原文</span><input type="checkbox" id="recall-early-original"></label>
                    <div id="vector-config-area">
                        <div class="settings-row">
                            <div class="settings-field">
                                <label for="vector-recall-timeout">召回超时（秒）</label>
                                <input type="number" id="vector-recall-timeout" min="1" step="1">
                            </div>
                        </div>
                    </div>
                    <div class="neo-card" id="vector-data-card">
                        <div class="neo-card-title"><span>向量数据 · 此聊天</span></div>
                        <div class="settings-row">
                            <div class="settings-field full">
                                <div class="vector-stats" id="vector-stats">
                                    <div class="vector-stat-col">
                                        <span class="vector-stat-label">正文片段向量:</span>
                                        <span class="vector-stat-value"><strong id="vector-chunk-count">0</strong></span>
                                    </div>
                                </div>
                                <div class="settings-hint" id="vector-integrity-status" role="status"></div>
                            </div>
                        </div>
                        <div class="engine-progress hidden" id="vector-gen-progress">
                            <div class="progress-bar"><div class="progress-inner"></div></div>
                            <span class="progress-text">0%</span>
                        </div>
                        <div class="settings-btn-row" id="vector-action-row">
                            <button class="btn btn-sm btn-p" id="btn-repair-vectors" style="flex:1">补齐缺漏</button>
                            <button class="btn btn-sm" id="btn-gen-vectors" style="flex:1">完整重建</button>
                            <button class="btn btn-sm btn-del" id="btn-clear-vectors" style="flex:1">清空</button>
                            <button class="btn btn-sm hidden" id="btn-cancel-vectors" style="flex:1">取消</button>
                        </div>
                    </div>
                </section>
            </div></div>
            <div class="modal-foot" data-setting-section="function"><div id="api-connect-status" role="status"></div><button class="btn" id="settings-cancel">还原修改</button><button class="btn btn-p" id="settings-save"></button></div>
        </div>
    </div>

    <!-- Confirm Modal -->
    <div class="modal" id="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="modal-bg" id="confirm-backdrop"></div>
        <div class="modal-box confirm-modal-box">
            <div class="modal-head">
                <h2 id="confirm-title">确认操作</h2>
                <button aria-label="取消" type="button" class="modal-close" id="confirm-close">×</button>
            </div>
            <div class="modal-body">
                <div id="confirm-message" style="margin: 10px 0; line-height: 1.6; color: var(--txt);">内容</div>
                <div id="confirm-action-list" class="confirm-action-list hidden"></div>
            </div>
            <div class="modal-foot">
                <button type="button" class="btn" id="confirm-cancel">退出</button>
                <button type="button" class="btn btn-del" id="confirm-ok">执行</button>
            </div>
        </div>
    </div>
`;
