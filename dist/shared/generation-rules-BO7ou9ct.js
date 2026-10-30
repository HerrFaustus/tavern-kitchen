import{H as c,f as b,it as m,mt as S,nt as O,rt as T,st as C}from"./domain-CK8WPRuF.js";function V(e){const t=Number.parseInt(e,10);return Number.isFinite(t)?Math.max(0,Math.min(30,t)):2}var L=Math.floor(2147483647/1e3);function G(e){const t=Number(e);return Number.isFinite(t)&&t>0?Math.min(L,Math.max(1,Math.floor(t))):30}var o=Object.freeze({unsupportedImport:"仅支持通过“导出记忆包”生成的文件；不支持内部 JSON、裸数据或其他版本的格式。",unconfirmed:"还无法确认修改是否保存；召回仍可使用现有记忆。可重试操作以重新确认；若仍提示冲突，请重新加载当前聊天后核对。",saving:"正在确认上一项修改，请稍后重试。",sourceInvalid:"原文已变化，总结回退尚未完成；召回仍可使用现有记忆。请重试回退，或重新导入／清空总结。",historyInvalid:"这份总结的回退记录不完整，已暂停修改；召回仍可使用现有记忆。请先导出留存，再重新导入或清空总结。",failed:"记忆修改未能保存，请重试本次操作；仍失败时请查看日志。",notSaved:"本次记忆修改未能保存，请重试本次操作。",sourceChanged:"原文已变化，本次锚点结果不再适用；请针对当前正文重新补齐。",conflict:"记忆内容已发生变化，本次修改未保存；请重新打开面板，核对后再修改。",cacheFailed:"原文对应的旧锚点已停用，但本地检索缓存未清理完成；请重试“补齐缺漏”。",anchorsFailed:"本次锚点补齐未能保存，请在“记忆锚点”中重试；详情见日志。"});function B(e,t="memory"){return e?.uncertain||e?.code==="metadata_unconfirmed"?o.unconfirmed:e?.code==="metadata_saving"?o.saving:e?.code==="source_boundary_invalid"?o.sourceInvalid:["history_discontinuous","summary_history_invalid"].includes(e?.code)?o.historyInvalid:e?.code==="metadata_source_changed"?o.sourceChanged:e?.code==="memory_cache_invalidation_failed"?o.cacheFailed:["metadata_draft_conflict","summary_chat_changed_before_save"].includes(e?.code)?o.conflict:t==="anchors"?o.anchorsFailed:e?.code==="metadata_not_saved"?o.notSaved:o.failed}var M=Object.freeze({superseded:"本次成果已失效，可按当前内容继续处理。",partially_superseded:"部分成果已失效，其余修改和有效进度保留。"}),l=Object.freeze({memory_refresh_failed:"修改已保存，界面未能及时更新。",metadata_save_unconfirmed:"保存结果尚未确认，可以让助手继续核对。",metadata_unconfirmed:"有一笔修改等待核对，暂不继续写入。",metadata_not_saved:"本次修改尚未保存，助手可以继续检查原因。",metadata_source_changed:o.sourceChanged,metadata_save_conflict:"保存时发现其他修改，需要先核对当前内容。",metadata_saving:"正在保存，请稍候。",metadata_target_unavailable:"当前聊天文件尚未就绪，暂时无法保存。"}),a=Object.freeze({tab:"助手",toggle:"自动维护记忆",scope:"所有聊天",behavior:"保存后，从下一次总结开始自动检查与修正记忆。",apiHeading:"Agent API",api:"使用共享 Agent API，可在Agent模块任意功能中设置，如后厨工作台 的「Agent API」；已配置则无需重复设置。",heading:"维护记录",cancel:"停止（已完成部分保留）",repair:"重试更新",more:"更早记录",empty:"还没有维护记录",emptyEnabled:"下一次总结后，维护成果会出现在这里。",emptyDisabled:"自动维护未开启。",loading:"正在读取…",settingsSave:"保存设置",settingsClose:"关闭",settingsSaved:"设置已保存",settingsFailed:"设置未能保存",before:"修改前",after:"修改后",evidence:"查看原文",absent:"已移除",notSet:"未记录",retired:{source_changed:"原文后来有过修改，这条锚点的维护结果已不再使用。",anchors_cleared:"锚点后来已被清空，这条记录仅供回看。"},summary:"大总结",anchors:"锚点",merges:"事件合并",missing:"锚点未就绪",noChanges:"本次没有修改",coverage:"审阅范围",related:"相关记忆",saved:e=>`已保存 ${e} 项修改`,staged:e=>`本轮已整理 ${e} 项修改，等待保存`,progress:({action:e,saved:t,staged:n})=>[a.actions[e],t?a.saved(t):"",n?a.staged(n):""].filter(Boolean).join(" · "),actions:{thinking:"正在梳理记忆",reading:"正在查阅",editing:"正在整理修改",saving:"正在保存",checking_save:"正在核对保存结果",compacting:"正在整理上下文"},completedRanges:"已完成",pendingRanges:"待维护",noRanges:"无",rangeCount:(e,t)=>`${e} ${t} 楼`,rangeDetails:"楼层范围",ranges:e=>e.map(t=>a.sourceRange(t.from,t.to)).join("、")||a.noRanges,boundary:e=>`截至第 ${e} 楼`,floor:e=>`第 ${e} 楼`,count:(e,t)=>`${e} ${t}`,moreChanges:e=>`另有 ${e} 项修改`,operation:{edit:"修正",delete:"移除",merge:"合并"},operationTitle:(e,t,n)=>`${e}${t} · ${n}`,changesHeading:"修正明细",allChanges:"全部",previousPage:"上一页",nextPage:"下一页",latestPage:"最新",pagePosition:(e,t)=>`${e} / ${t}`,floorLookup:"锚点楼层",locateFloor:"定位",floorNotFound:"本轮没有这一楼的锚点修改。",report:"AI 汇报",expandReport:"展开全文",collapseReport:"收起全文",fields:{title:"事件",timeLabel:"时间",summary:"经过",participants:"人物",causedBy:"前因",memoryRole:"类型",s:"人物",p:"事项",o:"内容",since:"起始楼层",retracted:"记录状态",trend:"关系",_isState:"重点保留",name:"名称",trajectory:"变化",progress:"进展",moments:"重要时刻",text:"内容",weight:"重要程度",from:"称呼",to:"对应人物",evidence:"依据",semantic:"当时发生的事",where:"地点",edges:"人物与行动"},yes:"是",no:"否",retained:"保留",retracted:"已撤回",sourceRange:(e,t)=>e===t?`第 ${e} 楼`:`第 ${e}–${t} 楼`,relation:e=>`${e.s} · ${e.r} · ${e.t}`,source:{heading:"原文",close:"返回成果",previous:"上一楼",next:"下一楼",more:"继续阅读",retry:"重试",note:"显示当前聊天原文；若后来编辑过，内容可能与维护时不同。",loading:"正在读取原文…",unavailable:"这段原文已无法查看，可能已删除或对应维护记录已撤销。",roles:{user:"用户",assistant:"角色",system:"系统"}},collections:{events:"事件",facts:"持续事实",characters:"人物",arcs:"弧光",keywords:"关键词",characterAliases:"别名",anchors:"逐楼锚点",storyRecords:"场景与进展"},anchorStates:{missing:"未生成",fail:"提取失败"},states:{idle:"",queued:"等待前一轮结束",running:"正在检查记忆…",saving:"正在保存修改…",indexing:"修改已保存，正在更新记忆检索…",...M,completed:"维护已结束",partial:"部分完成，剩余范围将在下次总结后继续。",interrupted:"本次维护未收尾，已保存的修改保留。",turn_limit:"本次维护已达到调用上限，已保存的修改保留。",input_limit:"本次维护已达到上下文上限，已保存的修改保留。",cancelled:"维护已停止，已保存的修改保留。",failed:"本次维护未完成，已保存的修改保留。",unconfirmed:l.metadata_save_unconfirmed,source_invalid:o.sourceInvalid,history_invalid:o.historyInvalid},indexPending:"修改已保存，部分内容还不能用于记忆检索。重试只更新检索，不会重新维护。",errors:{not_configured:"请先在 Agent API 中设置模型和服务地址。",no_boundary:"当前聊天还没有可维护的总结。",agent_auth:"共享 Agent API 的凭据不可用，请在 Agent API 设置中更新。",agent_balance:"共享 Agent API 余额不足。",agent_rate:"共享 Agent API 暂时限流。",agent_model:"共享 Agent API 当前不提供所选模型。",conflict:"聊天已切换，或总结已被替换、回退；维护已停止，此前保存的部分保留。",compaction_failed:"工作上下文整理失败，已完成的范围和修改保留。",input_limit:"近期对话和本轮材料超出上下文容量，无法继续压缩。请缩小本轮请求或查阅范围后重试，已保存的修改保留。",agent_failed:"服务暂时不可用，已保存的修改保留。",empty_response:"模型没有返回内容，已保存的修改保留。",...l,index_failed:"记忆检索未能更新。",index_read_failed:"暂时无法检查记忆检索是否可用。",load_failed:"维护记录暂时无法读取。"}}),I={storyRecords:Object.keys(m),events:["title","timeLabel","summary","participants","causedBy","memoryRole"],facts:["s","p","o","since","retracted","trend","_isState"],characters:["name"],arcs:["name","trajectory","progress","moments"],keywords:["text","weight"],characterAliases:["from","to","evidence"],anchors:["semantic","where","edges"]};function w(e,t){return typeof t=="string"?t:t?e==="storyRecords"?S(t):e==="events"?t.title:e==="facts"?[t.s,t.p].filter(Boolean).join(" · "):e==="anchors"?a.floor(t.floor+1):e==="keywords"?t.text:e==="characterAliases"?[t.from,t.to].join(" → "):t.name:a.collections[e]}function q(e,t){const n=Object.fromEntries((t.json.events||[]).map(i=>[i.id,i.title]));for(const i of e.operations)for(const s of i.changes){const $=s.after??s.before;s.collection==="events"&&(n[s.key]=$.title)}const r={...e.coverage,missingAnchors:e.coverage.missingAnchors.map(i=>({...i,label:a.floor(i.floor)}))};return{...e,coverage:r,eventNames:n}}function u(e){const t=e.changes.find(n=>n.collection===e.collection&&n.key===e.key);return t?.after??t?.before}var f=e=>e.collection==="anchors"?"anchors":"summary";function K(e){return f(e)==="anchors"?u(e).floor+1:null}function J(e){const t=f(e),n=w(e.collection,u(e));return a.operationTitle(a.operation[e.kind],a[t],t==="anchors"?n:`${a.collections[e.collection]} · ${n}`)}function d(e,t,n){return t==null||t===""||Array.isArray(t)&&!t.length?a.notSet:e==="presence"?T[t]||t:e==="certainty"?O[t]||t:e==="status"?C[t]||t:e==="since"?a.floor(t+1):e==="retracted"?t?a.retracted:a.retained:e==="_isState"?t?a.yes:a.no:e==="progress"?`${Math.round(t*100)}%`:e==="causedBy"?t.map(r=>n[r]||a.collections.events).join("、"):e==="edges"?t.map(a.relation).join(`
`):e==="moments"?t.map(r=>typeof r=="string"?r:r.text).join(`
`):Array.isArray(t)?t.join("、"):String(t).replace(/\(#(\d+)(?:-(\d+))?\)/gu,(r,i,s)=>`（${a.sourceRange(i,s||i)}）`)}function X(e,t={},n=!1){const r=typeof e.before=="string"?{name:e.before}:e.before,i=typeof e.after=="string"?{name:e.after}:e.after;return I[e.collection].filter(s=>(r?.[s]!=null||i?.[s]!=null)&&(n||r==null||i==null||!b(r[s],i[s]))).map(s=>({field:s,label:a.fields[s]||m[s],before:d(s,r?.[s],t),after:d(s,i?.[s],t)}))}var Q=Object.freeze({query:"MEMORY_CHAT_QUERY",send:"MEMORY_CHAT_SEND",draft:"MEMORY_CHAT_DRAFT",regenerate:"MEMORY_CHAT_REGENERATE",stop:"MEMORY_CHAT_STOP",clear:"MEMORY_CHAT_CLEAR",takeover:"MEMORY_CHAT_TAKEOVER",state:"MEMORY_CHAT_STATE"});function Z(e=0){const t=window.visualViewport,n=(t?.offsetTop??0)+e,r=t?.offsetLeft??0,i=t?.width??window.innerWidth,s=(t?.height??window.innerHeight)-e;return{top:`calc(${n}px + env(safe-area-inset-top, 0px))`,left:`calc(${r}px + env(safe-area-inset-left, 0px))`,width:`max(0px, calc(${i}px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))`,height:`max(0px, calc(${s}px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)))`}}function W(e,t=window){const n=t.visualViewport;return t.addEventListener("resize",e),t.addEventListener("orientationchange",e),n?.addEventListener("resize",e),n?.addEventListener("scroll",e),e(),()=>{t.removeEventListener("resize",e),t.removeEventListener("orientationchange",e),n?.removeEventListener("resize",e),n?.removeEventListener("scroll",e)}}var U="「向量数据 → 完整重建」",P="会调用 Embedding API",F=`请执行${U}（${P}，不会重新提取 L0 锚点）。`,N=Object.freeze({title:"剧情总结",summaryStopped:"已停止",summaryFailed:"总结失败",summaryFailureReasons:Object.freeze({empty:"模型没有返回总结内容。",parse:"模型返回的内容不是有效的 JSON，无法读取总结。",summary_invalid:"总结历史不完整，无法继续总结；请先导出留存，再修正后导入。",unknown:"未收到具体错误信息。"}),summaryResultInvalid:"模型返回的总结格式不正确",summaryFollowupFailed:e=>`总结已保存，但后续处理失败：
${e}`,summaryCompleted:(e,t)=>`剧情总结完成：更新至 #${e} 楼（新增 ${t} 个事件）`,summaryControls:Object.freeze({generate:"总结",stop:"停止",dismiss:"关闭提示",noChat:"请先打开一个聊天",changing:"正在同步当前聊天状态",disabled:"请先启用当前聊天的剧情总结"}),summaryAttempt:(e,t,n)=>`自动总结 ${e}/${t}：${n}`,summaryRunEnded:({automatic:e,attempts:t,uncertain:n,stale:r,reason:i})=>r?"对话或总结内容已变化，请重新总结。":`${n?"暂时无法确认总结是否保存":`${e?"自动总结":"总结"}失败${e?`（已尝试 ${t} 次）`:""}`}：
${i}${n?`
点击“总结”重新确认保存结果。`:""}`,embeddingTitle:"Embedding 异常",connectionChecking:"连接中…",connectionReady:e=>`连接成功 (${e}维)`,vectorInitialization:Object.freeze({configuration:"无法读取已保存的配置，请重新读取配置后重试。",runtime:"本地向量运行态准备失败，请刷新后重试；仍失败时请查看日志。",embedding:"Embedding 连接测试失败，请检查模型地址、Key 或网络。"}),connectionCancelled:"测试已取消。",configSaveCancelled:"本次保存已取消，配置未保存。请重试。",configLocalCacheUnavailable:"剧情总结本地配置缓存不可写，继续使用内存中的配置。",vectorConfigFailed:"向量配置未能保存，任务未开始。请重新保存配置后重试。",configLoad:Object.freeze({loading:"正在读取已保存的配置…",failed:"读取配置失败，请重试。",interrupted:"读取被新的配置操作中止。",waiting:"等待配置…",retry:"重新读取"}),statsRefreshFailed:"向量统计刷新失败。",embeddingRecall:e=>`记忆召回失败，本次生成已停止。${e}`,recallRetrying:"记忆召回仍在等待向量服务，正在重试；不想继续等待可点击停止生成。",recallInterrupted:Object.freeze({configuration:"记忆设置已变更，本次生成已停止，请重新发送。",memory:"记忆数据已变更，本次生成已停止，请重新发送。"}),embeddingRecallReasons:Object.freeze({timeout:e=>{const t=e.map(({attempt:n,timeoutMs:r})=>`第 ${n} 次限时 ${r/1e3} 秒`).join("；");return`Embedding 请求超时${t?`（${t}）`:""}。请检查服务和网络后重试。`},credentials:()=>"Embedding API Key 无效或没有权限，请检查 Key。",rate_limit:()=>"Embedding 服务限流（HTTP 429），请稍后重试；若 L0 共用同一限额，可降低 L0 并发。",server:e=>`Embedding 服务暂时出错（HTTP ${e}），请稍后重试。`,request_timeout:()=>"Embedding 服务返回请求超时（HTTP 408），请稍后重试。",network:()=>"Embedding 网络请求失败，请检查 API 地址、代理或网络。",invalid_response:()=>"Embedding 返回的向量数据无效或与请求不匹配，请检查模型是否为 Embedding 模型及接口兼容性。",configuration:()=>"未配置 Embedding API Key，请在向量设置中填写 Key。",configuration_url:()=>"Embedding API 地址无效，请检查向量设置中的 API 地址。",http:e=>`Embedding 请求被拒绝（HTTP ${e}），请检查 API 地址、模型配置及召回日志。`,unknown:()=>"Embedding 请求失败，请查看召回日志中的错误详情。"}),recallEmbeddingRequestFailed:"Embedding query request failed",queryActivityLog:"[Query Activity] 查询期间任务时间线：remaining 为本批剩余处理量，deferredUnits 为未纳入本批的待办，均非缓存校验结果；activeUnits 为处理中条目，非 HTTP 并发数；sameOrigin 仅表示同源，不代表共享限额。空 activities 仅表示所记录阶段未运行；dropped > 0 表示记录已截断。",recallHostTimeout:e=>`剧情记忆等待本轮用户消息超过 ${e} 秒，尚未开始召回，本次生成已停止。请检查酒馆生成准备流程。`,recallComputeTimeout:e=>`剧情记忆召回计算超过 ${e} 秒，本次生成已停止。请查看召回日志中的阶段和错误详情。`,recallFailed:"剧情记忆召回失败，本次生成已停止。请查看召回日志中的阶段和错误详情。",startupFailed:"剧情总结未能完成启动，请刷新页面重试；若仍失败，请反馈控制台中的错误。",vectorMaintenance:Object.freeze({loadFailed:"加载时记忆维护未完成",started:({chatId:e,floorsText:t,l0Pending:n,l0VectorMissing:r})=>`延迟向量维护开始 chat=${e} floors=${t} l0Pending=${n} l0VectorMissing=${r}；核对 L1/L2 缺口`,l1Failed:"L1 增量构建或缺口补齐未完成",incomplete:({chunkResult:e,eventResult:t,l0Failed:n,l0VectorResult:r})=>`延迟向量维护未完成 l1=${e.success===!1?e.code||"unknown":"ok"} l2=${t?.success===!1?t.code||"unknown":"ok"} l0Failed=${n} l0Vector=${r?.code||"ok"}，保留缺口并恢复完整性检查`,completed:({l0:e,l1:t,l2:n})=>`延迟向量维护完成 l0=${e} l1=${t} l2=${n}`}),vectorIntegrity:Object.freeze({fingerprintMismatch:"向量引擎/模型已变更",cacheInconsistent:"部分向量缓存与保存的来源不一致",l1Gap:e=>`${e} 层片段未向量化`,l0Gap:e=>`${e} 个楼层的锚点或基础向量未完成`,eventsMissing:e=>`${e} 个事件未向量化`,checking:"正在检查向量状态…",pending:"等待当前任务结束后检查。",unavailable:"暂时无法读取向量状态，将稍后重试；详情见日志。",status:e=>{if(!e.length)return"";const t=e.some(r=>r.action==="rebuild")?F:"",n=e.some(r=>r.code==="l0_gap")?"缺失的锚点文本需在「记忆锚点」中生成/补齐。":"";return`${e.map(r=>r.message).join("、")}。${t}${n}`}}),anchors:Object.freeze({success:"记忆锚点已清空",failed:"记忆锚点未能完全清空，可能已有部分数据被清除。请重试。",refreshFailed:"记忆锚点已清空，但面板统计更新失败。请重新打开面板查看。"}),vectors:Object.freeze({success:"向量数据已清除。如需恢复，请点击“补齐缺漏”。",failed:"向量数据未能完全清空，可能已有部分数据被清除。请重试；如需恢复向量，请点击“补齐缺漏”。",refreshFailed:"向量数据已清空，但面板统计更新失败。请重新打开面板查看。"})}),j="tavern_kitchen_summary_panel_config";function ee(e,t){const n=JSON.stringify(e);try{localStorage.setItem(j,n)}catch(r){t(N.configLocalCacheUnavailable,r.name)}}var te=`### 卡片要求
- 每张卡片记一件有叙事价值的事。以后玩家随口提起它时，比如"上次在酒馆拍欠条那回"，系统靠卡片里的词把这张卡片找回来。所以卡片要留下玩家会用来指代这件事的东西：人名和原文称呼、地点、关键物件、具体动作、关系或态度的变化、约定或交换条件、被揭开的秘密；原文有关键原话时，再留一句 15 字以内的。
- "两人发生冲突""关系恶化"这类话放在哪件事上都成立，找不回具体那一次。要写清是谁、在哪、拿着什么、对谁做了什么、结果怎样。

### 时间写法
- 卡片以后会在别的时间被读到，timeLabel 和 summary 里的时间要让人知道说的是哪一天，而不是只写“今天、昨天、明晚”。
- 原文给了日期，就用原文日期；有年份就保留，原文和已有总结都没有交代年份时不补年份。
- 原文没有日期时，可以写“搬入新家的第二晚”这类能找到对应事件的说法。已有总结按“第3天”记时，就接着用同一套记法；日期和间隔都要有原文或已有总结的依据，不凭空推算。
- 时间标签示例：原文写“2026年6月12日”，就写“2026年6月12日”；原文只写“6月12日”且已有总结也未交代年份，就写“6月12日”。
- 原文明确当前为2026年6月12日，追问“昨晚”的去向并约定“明晚”见面时，分别写为2026年6月11日晚和2026年6月13日晚。

### 详略与篇幅
- 每张卡片写 1 句，事情确实多时写 2 句。两句都要有具体内容，第一句不用来铺垫。
- 写不下时，先舍弃气氛描写，其次是次要人物的反应，再次是心理描写；连续的动作可以压成结果。人名、地点、物件、关键动作和原话最后才删。
- 只写和这件事有关的名词。

### 文风和示例
- 用朴实、白描、有烟火气的笔触记录事实，避免比喻和意象
- 示例只示范写到多具体，不要求模仿题材、语气或句式
- 不合格：
  1. 二人在酒馆发生冲突，关系恶化。
  2. 两人有暧昧互动，并约定再次见面。
  3. 她揭示了一个秘密，对方受到打击。
- 合格：
  1. 苏晚在黑鹭酒馆当众把欠条拍到顾衡胸口，骂他拿她母亲的旧宅做赌注，顾衡想抓她手腕被她甩开，周围赌客起哄，两人彻底撕破脸。 (#120-123)
  2. 2026年6月12日，周柠在旅馆浴室门口盯着林雨锁骨上的咬痕，追问2026年6月11日晚和谁在一起，林雨一边整理湿透的白衬衫一边嘴硬否认，最后答应2026年6月13日晚还去旧码头见她。 (#88-91)`;function x(e){return String(e||"").trim()||`### 卡片要求
- 每张卡片记一件有叙事价值的事。以后玩家随口提起它时，比如"上次在酒馆拍欠条那回"，系统靠卡片里的词把这张卡片找回来。所以卡片要留下玩家会用来指代这件事的东西：人名和原文称呼、地点、关键物件、具体动作、关系或态度的变化、约定或交换条件、被揭开的秘密；原文有关键原话时，再留一句 15 字以内的。
- "两人发生冲突""关系恶化"这类话放在哪件事上都成立，找不回具体那一次。要写清是谁、在哪、拿着什么、对谁做了什么、结果怎样。

### 时间写法
- 卡片以后会在别的时间被读到，timeLabel 和 summary 里的时间要让人知道说的是哪一天，而不是只写“今天、昨天、明晚”。
- 原文给了日期，就用原文日期；有年份就保留，原文和已有总结都没有交代年份时不补年份。
- 原文没有日期时，可以写“搬入新家的第二晚”这类能找到对应事件的说法。已有总结按“第3天”记时，就接着用同一套记法；日期和间隔都要有原文或已有总结的依据，不凭空推算。
- 时间标签示例：原文写“2026年6月12日”，就写“2026年6月12日”；原文只写“6月12日”且已有总结也未交代年份，就写“6月12日”。
- 原文明确当前为2026年6月12日，追问“昨晚”的去向并约定“明晚”见面时，分别写为2026年6月11日晚和2026年6月13日晚。

### 详略与篇幅
- 每张卡片写 1 句，事情确实多时写 2 句。两句都要有具体内容，第一句不用来铺垫。
- 写不下时，先舍弃气氛描写，其次是次要人物的反应，再次是心理描写；连续的动作可以压成结果。人名、地点、物件、关键动作和原话最后才删。
- 只写和这件事有关的名词。

### 文风和示例
- 用朴实、白描、有烟火气的笔触记录事实，避免比喻和意象
- 示例只示范写到多具体，不要求模仿题材、语气或句式
- 不合格：
  1. 二人在酒馆发生冲突，关系恶化。
  2. 两人有暧昧互动，并约定再次见面。
  3. 她揭示了一个秘密，对方受到打击。
- 合格：
  1. 苏晚在黑鹭酒馆当众把欠条拍到顾衡胸口，骂他拿她母亲的旧宅做赌注，顾衡想抓她手腕被她甩开，周围赌客起哄，两人彻底撕破脸。 (#120-123)
  2. 2026年6月12日，周柠在旅馆浴室门口盯着林雨锁骨上的咬痕，追问2026年6月11日晚和谁在一起，林雨一边整理湿透的白衬衫一边嘴硬否认，最后答应2026年6月13日晚还去旧码头见她。 (#88-91)`}var g=e=>`[Event Summary Style]
${x(e)}`,_=`[Memory Role]
memoryRole describes what an event leaves for later context. Choose one role based on its main evidenced result:
- 状态变化: A status is established, changed or ended: identity, relationship, residence, ownership or ongoing circumstances.
- 约定承诺: A plan, promise, rule or responsibility is agreed, fulfilled or cancelled. An intention alone is not a completed state change.
- 信息揭示: Someone learns an identity, secret, reason or truth. Preserve who learned it in the summary.
- 偏好习惯: An explicitly stated preference, aversion or taboo, or a recurring behavior supported by the available history. A single action alone does not establish a habit.
- 具体经历: A recognizable interaction or experience, including daily life, conflict, comfort or adventure, whose main contribution is the episode itself.
These roles are different uses of memory, not importance levels. Choose the main result; keep other relevant details in the summary. Continuous actions and reactions about the same occurrence stay together rather than being split to fill roles.`,Y=`[Arc Progress Tracking]
角色弧光记录一个角色在经历中逐渐发生的变化。本次新对话让某个角色的变化有了推进时，才输出这个角色的 arcUpdates。
- name：角色的正式名。
- trajectory：这个角色当前所处的阶段，15 字以内。
- progress：0～100 的整数，和已有总结里显示的进度是同一刻度。
- newMoment：本次推动变化的那段经历；没有可写的就省略。`,p=`### 事实记录什么
- 事实记录剧情已经确认、之后会持续成立的情况，比如身份、生死、住在哪里、东西归谁、两人是什么关系、稳定的身体特征。角色扮演时，这些事实让角色前后一致。某一次发生了什么，记在事件卡片里。
- s 是主体，p 是记录哪一方面，o 是这一方面现在的完整情况。同一 s+p 只保存一条，新内容替换旧内容；同一方面沿用已有谓词，不另起同义的名称。

### 核心事实与普通事实
- 核心事实（isState: true）不按当前相关人物筛选，也不受普通事实的数量上限影响。普通事实（isState: false）会结合当前相关人物选择；每个主体最多保留 10 条，超出时先清理最早记录的。
- 按遗漏的后果分类：缺了它会让剧情出错的，记为核心事实，比如身份、生死、居住地、归属、关系状态、稳定的身体特征和约束后续行动的规则。持续时间长短不决定分类，影响行动能力的伤势、有明确期限的债务，遗漏同样会出错。其他已确认的事实记为普通事实。

### 身体特征
- 外貌统一用谓词 p="身体特征"，只记录稳定、有辨识度的特征。衣着、姿势、表情和普通伤势随时会变，不记在这里。
- 新发现的特征与已有特征并存时，o 要把两者写全。
- 例：已有 {"s":"鹿椿若","p":"身体特征","o":"头顶白色分叉鹿角","isState":true}，后续发现鹿耳时，o 写作"头顶白色分叉鹿角，鹿耳"。

### 关系事实
- p 写作“对X的看法”，X 是对方的主名；o 写主体对这个人的具体看法和缘由。
- trend 用一个词概括这份看法，只代表主体一方的态度，对方可能看法不同。以“${c[3]}”为中点，向左越来越疏远、敌对，向右越来越投契、亲近：
  ${c.slice(0,4).join(" ← ")} → ${c.slice(4).join(" → ")}`,ne=`## factUpdates 规则
${p}

### 本次输出什么
- factUpdates 只包含新对话中新出现或有变化的事实；没有变化时省略。
- 新建或更新写 {s, p, o, isState, trend?}，isState 填布尔值。核心与普通的分类在首次记录时决定，之后更新同一 s+p 时沿用原分类。
- 删除写 {s, p, retracted: true}。`,h="- 同一个角色在剧情里可能有多种写法：称号、昵称、缩写、其他语言的名字或译名。别名把这些写法指向同一个主名。",y="可以作为依据的有：明确揭示的身份、稳定使用的称号或昵称、只可能指这个人的缩写、同一名字在其他语言里的写法或译名。",E="- 称号、昵称或缩写在当前剧情和已有资料里只指这一位角色时，才算别名。亲昵称呼、亲属称呼、泛称、普通职位和代词可以指很多人；读音或字形相近也说明不了是同一人。",re=`## characterAliasUpdates（可选）
${h}
- 当前对话和已有总结能确认两种名称是同一角色时输出。${y}
${E}
- to 是已有总结中稳定使用的主名，from 是其他写法，evidence 简短说明依据。
- 例: {"to":"五条悟","from":["悟","Gojo Satoru"],"evidence":"当前中文称呼“悟”与既有日文名五条悟均指同一角色"}
- 保存时，系统会把角色列表、事件参与者、事实的主体和关系对象、弧光的角色名统一改成主名；卡片正文和引语里的称呼保持原样。这里只给出映射。`;function ae(e){return`
Summary Specialist:
Acknowledged. Now reviewing the incremental summarization specifications:

${_}

${g(e)}

${Y}

Ready to process incremental summary requests with strict deduplication.`}var k="- scene、where 和 edges.r 使用当前 <round> 正文的主要语言；混合语言时跟随主要叙事语言，并保留原文人名、专名和引语；JSON 键保持协议规定，不翻译",A=e=>`### 这张卡片用来做什么
${e} 记录本轮对话中的一个具体场景，用于找回对应原文，也会作为记忆提供给后续对话。
玩家可能通过人物、地点、物件、某个动作或一句话提起这段经历，因此卡片需要保留能够辨认这一幕的具体事实。

### 事实如何保持准确
- 每项叙述都以本轮正文为依据。正文没有交代的身份、动机、因果和结果保持未知，不按常识或剧情合理性补全。
- 人名、称呼和代词对应同一位角色后再归并；无法确认时保留原文称呼，不猜测姓名。
- 准确区分谁做了什么、对谁做、谁说了什么、谁知道什么，不把不同人物的行动或信息混在一起。
- 保留原文的否定、条件和不确定性。打算做不等于已经做，怀疑不等于证实，人物的说法和猜测仍归属于该人物。
- 时间、数量、身份、物品归属、行动顺序和结果与原文一致。压缩表达不能改变这些事实。

### 场景里记录什么
- 写清人物、地点、具体行动、行动对象和已发生的结果；同一场景内连续发生的行动按原文顺序串起来。
- 正文明确给出的姓名、具体地点、日期、数量、物件名称和约定条件，属于本场景的就保留具体内容，不改成笼统泛称。
- 保留本场景有辨识度的称呼、衣着或身体特征、动作细节和关键原话，使“那次穿什么”“拿着什么”“做了哪个动作”也能对应到这一幕。
- 言语可以缩写，但保留说话人、对象和实际内容，尤其是透露的信息、承诺、拒绝与交换条件，不概括成“交谈”或“发生互动”。
- 正文明示的情绪、态度和关系变化可以记录；仅有动作描写时记录动作，不自行解释人物内心。

### 篇幅与组织
- 用朴实、自然的完整句叙述，不列关键词清单，不加文学化修饰。
- 每张通常写60–180字；原文信息少时可以更短，不为达到字数补写内容。
- 缩短时先合并重复表达、压缩修辞和气氛描写，保留具体事实及其相互关系。
- 每张围绕一个场景展开，不把不同场景堆成一段。`,v=`- edges 用于寻找行为相近或人物组合相关的其他卡片。
- s 是做这件事的角色，t 是承受的角色。结合正文和消息的 name 确认角色身份，能确认时写名字；只能确认称呼时写称呼，仍认不出是谁时不写这一条。user、assistant 是消息标签，不是角色名。
- r 写“动作 + 对象或结果”，建议 6～12 字，最多 20 字。人物已经在 s、t 里，r 只写做了什么，不写人名、心理和评价，不同场景里相似的行为才能对上。
- 合格：提出交易条件、拒绝对方请求、当众揭露秘密、安抚对方情绪、强行打断发言、转移谈话焦点
- 不合格：我觉得她现在很害怕、他突然非常生气地大喊起来、user开始说话、assistant解释了很多细节
- 每张卡片最多 3 条。`,R="- 场景地点，无明确地点时空字符串",H="- 一轮通常是一个场景，写一张。地点、时间或在场人物明显切换时分成两张，最多两张。",z=[{weakScene:"车站归还雨伞",anchor:{scene:"雨停后，许宁在车站门口把黄色雨伞还给赵岚，指着伞柄的裂纹说明借来时就有。赵岚摸了摸裂口，确认借出时已经开裂，把雨伞收进布袋，没有要求许宁赔偿。",edges:[{s:"许宁",t:"赵岚",r:"归还雨伞并说明原有裂纹"},{s:"赵岚",t:"许宁",r:"确认原有裂纹未要求赔偿"}],where:"车站门口"}},{weakScene:"两人发生争执，最后达成约定。",anchor:{scene:"程遥在修车铺把漏气的后轮推到柜台前，拿出三天前的维修收据，要求孟川免费返修。孟川拆下内胎后指出气嘴旁有一道新划口，程遥否认自己划伤轮胎，两人约定先保留旧内胎，再一起查看当天的监控。",edges:[{s:"程遥",t:"孟川",r:"出示维修收据要求免费返修"},{s:"孟川",t:"程遥",r:"指出气嘴旁有新划口"},{s:"程遥",t:"孟川",r:"约定保留内胎并查看监控"}],where:"修车铺"}}],se=`${k}

## 一轮写几张
${H}
- 无角色互动时返回 {"anchors":[]}

## scene 写法
${A("scene")}

### Scene examples (not exhaustive)
These examples contrast titles or vague recaps with concrete narratives. They show the level of detail, not a topic, tone or sentence pattern to copy. Facts for the actual response come only from the current <round>.
${z.map(({weakScene:e,anchor:t})=>`Insufficient scene: ${e}
Complete response, when these facts are present in the source:
${JSON.stringify({anchors:[t]})}`).join(`

`)}

## edges：谁对谁做了什么
${v}

## where
${R}`,ie=e=>[_,g(e),`[Facts]
${p}`,`[Character Aliases]
${h}
- 对话与既有记忆能确认两种名称是同一角色时，别名才成立。${y}
${E}`],oe=[`[Anchor semantic]
${A("semantic")}`,`[Anchor edges]
${v}`,`[Anchor where]
${R}`];export{M as C,L as D,B as E,G as O,a as S,o as T,w as _,ne as a,J as b,x as c,N as d,F as f,X as g,Q as h,te as i,V as k,j as l,W as m,se as n,ae as o,Z as p,re as r,ie as s,oe as t,ee as u,f as v,l as w,q as x,K as y};
