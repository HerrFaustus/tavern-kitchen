import{P as n}from"./domain-JIMcWOhy.js";import{t as E}from"./panel-policy-B7trbgeC.js";function C(e){const r=Number.parseInt(e,10);return Number.isFinite(r)?Math.max(0,Math.min(30,r)):0}var f={enabled:!0,timing:"after_ai",interval:1,delayFloors:0};function U(e={}){const r=e.summaryWorkflowVersion===1;return{summaryWorkflowVersion:1,inlineSummary:{enabled:!1,review:e.inlineSummary?.review===!0},trigger:{...e.trigger||{},...r?{}:f,delayFloors:0,maxPerRun:100}}}var _=Math.floor(2147483647/1e3);function I(e){const r=Number(e);return Number.isFinite(r)&&r>0?Math.min(_,Math.max(1,Math.floor(r))):30}function N(e={}){const r=Number(e.proofreadingInterval);return{proofreadingInterval:Number.isInteger(r)?Math.max(1,Math.min(100,r)):5,proofreadingPrompt:String(e.proofreadingPrompt??"").trim().slice(0,4e3)}}var S="「向量数据 → 完整重建」",p="会调用 Embedding API",$=`请执行${S}（${p}，不会重新提取 L0 锚点）。`,A=Object.freeze({title:"总结",summaryStopped:"已停止",summaryFailed:"总结失败",summaryFailureReasons:Object.freeze({empty:"模型没有返回总结内容。",parse:"模型返回的内容不是有效的 JSON，无法读取总结。",summary_invalid:"总结历史不完整，无法继续总结；请先导出留存，再修正后导入。",unknown:"未收到具体错误信息。"}),summaryResultInvalid:"模型返回的总结格式不正确",summaryFollowupFailed:e=>`总结已保存，但后续处理失败：
${e}`,summaryCompleted:e=>`本轮总结已保存至 #${e} 楼`,summaryControls:Object.freeze({generate:"总结",stop:"停止",dismiss:"关闭提示",noChat:"请先打开一个聊天",changing:"正在同步当前聊天状态",disabled:"请先打开后厨并选择一段对话"}),summaryAttempt:(e,r,a)=>`自动总结 ${e}/${r}：${a}`,summaryRunEnded:({automatic:e,attempts:r,uncertain:a,stale:t,reason:g})=>t?"对话或总结内容已变化，请重新总结。":`${a?"暂时无法确认总结是否保存":`${e?"自动总结":"总结"}失败${e?`（已尝试 ${r} 次）`:""}`}：
${g}${a?`
点击“总结”重新确认保存结果。`:""}`,embeddingTitle:"Embedding 异常",connectionChecking:"连接中…",connectionReady:e=>`连接成功 (${e}维)`,vectorInitialization:Object.freeze({configuration:"无法读取已保存的配置，请重新读取配置后重试。",runtime:"本地向量运行态准备失败，请刷新后重试；仍失败时请查看日志。",embedding:"Embedding 连接测试失败，请检查模型地址、Key 或网络。"}),connectionCancelled:"测试已取消。",configSaveCancelled:"本次保存已取消，配置未保存。请重试。",configLocalCacheUnavailable:"总结本地配置缓存不可写，继续使用内存中的配置。",vectorConfigFailed:"向量配置未能保存，任务未开始。请重新保存配置后重试。",configLoad:Object.freeze({loading:"正在读取已保存的配置…",failed:"读取配置失败，请重试。",interrupted:"读取被新的配置操作中止。",waiting:"等待配置…",retry:"重新读取"}),statsRefreshFailed:"向量统计刷新失败。",embeddingRecall:e=>`记忆召回失败，本次生成已停止。${e}`,recallRetrying:"记忆召回仍在等待向量服务，正在重试；不想继续等待可点击停止生成。",recallInterrupted:Object.freeze({configuration:"记忆设置已变更，本次生成已停止，请重新发送。",memory:"记忆数据已变更，本次生成已停止，请重新发送。"}),embeddingRecallReasons:Object.freeze({timeout:e=>{const r=e.map(({attempt:a,timeoutMs:t})=>`第 ${a} 次限时 ${t/1e3} 秒`).join("；");return`Embedding 请求超时${r?`（${r}）`:""}。请检查服务和网络后重试。`},credentials:()=>"Embedding API Key 无效或没有权限，请检查 Key。",rate_limit:()=>"Embedding 服务限流（HTTP 429），请稍后重试；若 L0 共用同一限额，可降低 L0 并发。",server:e=>`Embedding 服务暂时出错（HTTP ${e}），请稍后重试。`,request_timeout:()=>"Embedding 服务返回请求超时（HTTP 408），请稍后重试。",network:()=>"Embedding 网络请求失败，请检查 API 地址、代理或网络。",invalid_response:()=>"Embedding 返回的向量数据无效或与请求不匹配，请检查模型是否为 Embedding 模型及接口兼容性。",configuration:()=>"未配置 Embedding API Key，请在向量设置中填写 Key。",configuration_url:()=>"Embedding API 地址无效，请检查向量设置中的 API 地址。",http:e=>`Embedding 请求被拒绝（HTTP ${e}），请检查 API 地址、模型配置及召回日志。`,unknown:()=>"Embedding 请求失败，请查看召回日志中的错误详情。"}),recallEmbeddingRequestFailed:"Embedding query request failed",queryActivityLog:"[Query Activity] 查询期间任务时间线：remaining 为本批剩余处理量，deferredUnits 为未纳入本批的待办，均非缓存校验结果；activeUnits 为处理中条目，非 HTTP 并发数；sameOrigin 仅表示同源，不代表共享限额。空 activities 仅表示所记录阶段未运行；dropped > 0 表示记录已截断。",recallHostTimeout:e=>`剧情记忆等待本轮用户消息超过 ${e} 秒，尚未开始召回，本次生成已停止。请检查酒馆生成准备流程。`,recallComputeTimeout:e=>`剧情记忆召回计算超过 ${e} 秒，本次生成已停止。请查看召回日志中的阶段和错误详情。`,recallFailed:"剧情记忆召回失败，本次生成已停止。请查看召回日志中的阶段和错误详情。",startupFailed:"总结未能完成启动，请刷新页面重试；若仍失败，请反馈控制台中的错误。",vectorMaintenance:Object.freeze({loadFailed:"加载时记忆维护未完成",started:({chatId:e,floorsText:r,l0Pending:a,l0VectorMissing:t})=>`延迟向量维护开始 chat=${e} floors=${r} l0Pending=${a} l0VectorMissing=${t}；核对 L1/L2 缺口`,l1Failed:"L1 增量构建或缺口补齐未完成",incomplete:({chunkResult:e,eventResult:r,l0Failed:a,l0VectorResult:t})=>`延迟向量维护未完成 l1=${e.success===!1?e.code||"unknown":"ok"} l2=${r?.success===!1?r.code||"unknown":"ok"} l0Failed=${a} l0Vector=${t?.code||"ok"}，保留缺口并恢复完整性检查`,completed:({l0:e,l1:r,l2:a})=>`延迟向量维护完成 l0=${e} l1=${r} l2=${a}`}),vectorIntegrity:Object.freeze({keyword:"当前使用关键词检索；配置向量模型后可补充语义检索。",fingerprintMismatch:"向量引擎/模型已变更",cacheInconsistent:"部分向量缓存与保存的来源不一致",l1Gap:e=>`${e} 层片段未向量化`,l0Gap:e=>`${e} 个楼层的锚点或基础向量未完成`,eventsMissing:e=>`${e} 个事件未向量化`,checking:"正在检查向量状态…",pending:"等待当前任务结束后检查。",unavailable:"暂时无法读取向量状态，将稍后重试；详情见日志。",status:e=>{if(!e.length)return"";const r=e.some(t=>t.action==="rebuild")?$:"",a=e.some(t=>t.code==="l0_gap")?"缺失的锚点文本需在「记忆锚点」中生成/补齐。":"";return`${e.map(t=>t.message).join("、")}。${r}${a}`}}),anchors:Object.freeze({success:"记忆锚点已清空",failed:"记忆锚点未能完全清空，可能已有部分数据被清除。请重试。",refreshFailed:"记忆锚点已清空，但面板统计更新失败。请重新打开面板查看。"}),vectors:Object.freeze({success:"向量数据已清除。如需恢复，请点击“补齐缺漏”。",failed:"向量数据未能完全清空，可能已有部分数据被清除。请重试；如需恢复向量，请点击“补齐缺漏”。",refreshFailed:"向量数据已清空，但面板统计更新失败。请重新打开面板查看。"})}),R="tavern_kitchen_summary_panel_config";function M(e,r){const a=JSON.stringify(e);try{localStorage.setItem(R,a)}catch(t){r(A.configLocalCacheUnavailable,t.name)}}var F="以本轮原文为据，写清人物、关键互动、条件和实际结果。";function v(e){return String(e||"").trim()||"以本轮原文为据，写清人物、关键互动、条件和实际结果。"}var i=e=>`[Summary Style]
${v(e)}`,s=`### 事实记录什么
- 事实记录剧情已经确认、之后会持续成立的情况，比如身份、生死、住在哪里、东西归谁、两人是什么关系、稳定的身体特征。角色扮演时，这些事实让角色前后一致。某一次发生了什么，记在本轮总结里。
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
- trend 用一个词概括这份看法，只代表主体一方的态度，对方可能看法不同。以“${n[3]}”为中点，向左越来越疏远、敌对，向右越来越投契、亲近：
  ${n.slice(0,4).join(" ← ")} → ${n.slice(4).join(" → ")}`,w=`## factUpdates 规则
${s}

### 本次输出什么
- factUpdates 只包含新对话中新出现或有变化的事实；没有变化时省略。
- 新建或更新写 {s, p, o, isState, trend?}，isState 填布尔值。核心与普通的分类在首次记录时决定，之后更新同一 s+p 时沿用原分类。
- 删除写 {s, p, retracted: true}。`,o="- 同一个角色在剧情里可能有多种写法：称号、昵称、缩写、其他语言的名字或译名。别名把这些写法指向同一个主名。",c="可以作为依据的有：明确揭示的身份、稳定使用的称号或昵称、只可能指这个人的缩写、同一名字在其他语言里的写法或译名。",m="- 称号、昵称或缩写在当前剧情和已有资料里只指这一位角色时，才算别名。亲昵称呼、亲属称呼、泛称、普通职位和代词可以指很多人；读音或字形相近也说明不了是同一人。",P=`## characterAliasUpdates（可选）
${o}
- 当前对话和已有总结能确认两种名称是同一角色时输出。${c}
${m}
- to 是已有总结中稳定使用的主名，from 是其他写法，evidence 简短说明依据。
- 自动核对本轮原文、既有主名、世界人物稳定编号及已确认别名。同一人物复用已有身份，新出现的称号和别名归入该人物属性；明确同一身份时自动补充映射。同名、共用称号或身份未揭示时分别保留，以稳定编号区分，等待后续证据。
- 例: {"to":"五条悟","from":["悟","Gojo Satoru"],"evidence":"当前中文称呼“悟”与既有日文名五条悟均指同一角色"}
- 保存时，系统会把角色列表、事件参与者、事实的主体和关系对象统一改成主名；卡片正文和引语里的称呼保持原样。这里只给出映射。`,y=E("memory","summaryGuide","总结写作指引",`
Summary Specialist:
Acknowledged. Now reviewing the incremental summarization specifications:

{{style}}


Ready to process incremental summary requests with strict deduplication.`);function k(e){return y({style:i(e)})}var h="- scene、where 和 edges.r 使用当前 <round> 正文的主要语言；混合语言时跟随主要叙事语言，并保留原文人名、专名和引语；JSON 键保持协议规定，不翻译",l=e=>`### 这张卡片用来做什么
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
- 每张围绕一个场景展开，不把不同场景堆成一段。`,d=`- edges 用于寻找行为相近或人物组合相关的其他卡片。
- s 是做这件事的角色，t 是承受的角色。结合正文和消息的 name 确认角色身份，能确认时写名字；只能确认称呼时写称呼，仍认不出是谁时不写这一条。user、assistant 是消息标签，不是角色名。
- r 写“动作 + 对象或结果”，建议 6～12 字，最多 20 字。人物已经在 s、t 里，r 只写做了什么，不写人名、心理和评价，不同场景里相似的行为才能对上。
- 合格：提出交易条件、拒绝对方请求、当众揭露秘密、安抚对方情绪、强行打断发言、转移谈话焦点
- 不合格：我觉得她现在很害怕、他突然非常生气地大喊起来、user开始说话、assistant解释了很多细节
- 每张卡片最多 3 条。`,u="- 场景地点，无明确地点时空字符串",L="- 一轮通常是一个场景，写一张。地点、时间或在场人物明显切换时分成两张，最多两张。",O=[{weakScene:"车站归还雨伞",anchor:{scene:"雨停后，许宁在车站门口把黄色雨伞还给赵岚，指着伞柄的裂纹说明借来时就有。赵岚摸了摸裂口，确认借出时已经开裂，把雨伞收进布袋，没有要求许宁赔偿。",edges:[{s:"许宁",t:"赵岚",r:"归还雨伞并说明原有裂纹"},{s:"赵岚",t:"许宁",r:"确认原有裂纹未要求赔偿"}],where:"车站门口"}},{weakScene:"两人发生争执，最后达成约定。",anchor:{scene:"程遥在修车铺把漏气的后轮推到柜台前，拿出三天前的维修收据，要求孟川免费返修。孟川拆下内胎后指出气嘴旁有一道新划口，程遥否认自己划伤轮胎，两人约定先保留旧内胎，再一起查看当天的监控。",edges:[{s:"程遥",t:"孟川",r:"出示维修收据要求免费返修"},{s:"孟川",t:"程遥",r:"指出气嘴旁有新划口"},{s:"程遥",t:"孟川",r:"约定保留内胎并查看监控"}],where:"修车铺"}}],z=`${h}

## 一轮写几张
${L}
- 无角色互动时返回 {"anchors":[]}

## scene 写法
${l("scene")}

### Scene examples (not exhaustive)
These examples contrast titles or vague recaps with concrete narratives. They show the level of detail, not a topic, tone or sentence pattern to copy. Facts for the actual response come only from the current <round>.
${O.map(({weakScene:e,anchor:r})=>`Insufficient scene: ${e}
Complete response, when these facts are present in the source:
${JSON.stringify({anchors:[r]})}`).join(`

`)}

## edges：谁对谁做了什么
${d}

## where
${u}`,j=e=>[i(e),`[Facts]
${s}`,`[Character Aliases]
${o}
- 对话与既有记忆能确认两种名称是同一角色时，别名才成立。${c}
${m}`],D=[`[Anchor semantic]
${l("semantic")}`,`[Anchor edges]
${d}`,`[Anchor where]
${u}`];export{w as a,v as c,A as d,N as f,C as g,U as h,F as i,R as l,I as m,z as n,k as o,_ as p,P as r,j as s,D as t,M as u};
