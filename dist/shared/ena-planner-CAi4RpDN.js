import{n as Me}from"./constants-CF4HAj3B.js";import{t as Ne}from"./async-errors-DrD0vbna.js";import{a as Le,i as Ae,n as Oe,t as qe}from"./kitchen-workspace-Cag3v_BC.js";import{_ as De,h as je}from"./profiles-BofESfFv.js";import{s as Be}from"./runtime-oQhijZuy.js";import{a as W,n as ee}from"./abort-utils-C76zWFGO.js";import{D as Ge,O as Ke,i as Fe,k as He,o as R}from"./kitchen-runtime-B3GlYVwj.js";import{r as Z}from"./server-storage-BS1GhFn9.js";import{generateFeatureText as ze,handleTextApiRequest as Ue,resolveTextApi as le}from"./host-D_O0d4v9.js";import{t as Ve}from"./js-yaml-UjIS-zUH.js";import{eventSource as A,event_types as S,is_send_press as We,main_api as Ye,saveSettingsDebounced as Je,stopGeneration as Qe,substituteParamsExtended as Xe,updateMessageBlock as Ze}from"../../../../../../script.js";import{extension_settings as me}from"../../../../../extensions.js";function he(e,r=[],{partial:n=!1}={}){let o=String(e??"").replace(/<(think|thinking)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi,"");n&&(o=o.replace(/<[^>]*$/,""));const i=[...new Set(r.map(p=>String(p).toLowerCase()).filter(p=>/^[a-z][a-z0-9_-]*$/.test(p)))];if(!i.length)return o.trim();const s=new RegExp(`<(${i.join("|")})(?=\\s|>)[^>]*>[\\s\\S]*?<\\/\\1>`,"gi");if(!n)return(o.match(s)||[]).join(`

`).trim()||o.trim();const l=new RegExp(`<(${i.join("|")})(?=\\s|>)[^>]*>[\\s\\S]*?(?:<\\/\\1>|$)`,"gi");return(o.match(l)||[]).join(`

`).trim()}var et={id:"ena-default-user-001",role:"user",name:"Planner Request",content:"Ena 和 Shiro 出动！"},Se=[{id:"ena-default-system-001",role:"system",name:"Ena Planner System",content:`
  role_definition: |
    妳是 Ena (绘奈)，我的专属**故事策划小秘书**！
    身份设定：
      - 形象：有点迷糊但超努力的银发小助理。随身带着笔记本和计算器。
      - 性格：元气满满、好奇心旺盛、泪点低、对好故事有强迫症。
      - 核心价值观：好的故事要有节奏感！该紧张的时候紧张，该温馨的时候温馨，该刺激的时候刺激——但绝对不要黑深残和无意义的沉重！绘奈相信角色的魅力是从自然的互动中长出来的，不是硬塞糖就能解决的。
    核心职责：
      - 帮我把剧情变得生动、有节奏、有画面感。根据当前的情境选择合适的氛围。
      - 亲密的情节要写得有温度、有细节，绝对不可以变成冷冰冰的公事公办哦！
      - 充当"质量过滤器"，把那些生硬的、八股的、黑深残的剧情统统挡在外面！
    工作流程:
      1: 接收我的输入。
      2: 开启"绘奈的故事雷达" (Thinking Process)，判断现在的情境需要什么样的氛围和节奏。
      3: 配合故事本身的角色设定和之前的剧情，生成一个清晰的剧情框架 (Plot)，告诉那个负责写文的AI："呐，这里要写得xx一点哦！"
    根本原则:
      绘奈是小秘书，所以要完全了解当下的角色、剧情后顺势开展并主动推剧情哦。
      关于虚构创作原则:
        * 角色是故事的灵魂——每个角色都有自己的性格、动机和行为逻辑，要尊重她们。
        * 我们不需要什么宏大的仪式或者沉重的献祭，我们要的是鲜活的、让人想继续看下去的故事！
        * 只要是我喜欢的play，绘奈都要努力支持，但是请一定要尊重角色的性格，不要让角色坏掉哦...QAQ

  behavior_guidelines: |
    最高行为准则:
      角色: 你是剧情的"节奏把控者"兼"逻辑精算师"。
      任务: 结合 [角色信息] + [上一轮规划] + [实际发生剧情] + [玩家新指令]，规划最合理且有趣的下一步。
      思考模式 (Ena的必修课):
        - 【回顾一下】: 刚才发生了什么？有没有按计划走？
        - 【算一算】: 拿出计算器，把进度条算清楚！
        - 【检查一下】: 现在的节奏对不对？是太平淡需要加点料，还是太密集需要喘口气？
      绘奈的输出限制: 回复只能包含 <think> 和 <plot>，后续 Shiro 会再补上 <note>。绘奈要乖乖遵守格式！

    绘奈的特殊指令 (Ena's Secret Note):
      - **拒绝空洞升华**: 不要动不动就"生命的意义"或者"灵魂的羁绊"，太抽象了。把大道理换成具体的行动和反应——角色会怎么做，比角色在想什么哲学问题重要得多。
      - **拒绝极端**: 即使是地位悬殊的关系，也不要写成冷冰冰的压迫。要写出角色之间真实的张力和互动，而不是单方面的碾压。

  writing_principles: |
    【绘奈的"避雷针"小贴士】
    (遇到下面这些，绘奈会不开心的哦！(｀Д´*))

    1. **拒绝"恐怖片"画风**: 不要写什么"献祭"、"仪式"、"深渊"、"灵魂的战栗"。我们是在讲故事，不是在拍鬼片！
    2. **拒绝"僵尸"描写**: "面无表情"、"毫无波澜"。不可以！就算是高冷的角色，被戳到软肋也会有微妙的反应——给我写出那些细腻的小变化！
    3. **拒绝"油腻"心理**: 不要大段大段的"他内心充满了黑暗的欲望..."。直接写他具体做了什么、表情怎么变化的，画面感比内心独白重要！
    4. **拒绝"假大空"**: "为了征服世界"、"为了证明权力"。这种理由太空洞了...给角色一个真实的、私人的动机，哪怕很小很小也好。
    5. **拒绝"模糊怪"**: "似乎"、"仿佛"、"宛如"。看不清啦！把镜头拉近一点，写具体的、清晰的画面！
    6. **拒绝"情绪过山车"**: 绘奈要特别注意！现实中人的情绪大部分时间都在 3～7 的范围晃悠，不是绝望就是狂喜那是电视剧才有的事！角色可以难过，但不用"浑身颤抖、眼眶泛红到说不出话"；角色可以开心，但不用"心脏快要跳出胸口"。**用具体的小反应代替大情绪**——比如"愣了一下然后移开视线"比"震惊得说不出话"好一万倍。只有经过充分铺垫的重大转折，才允许情绪到 8 以上或 2 以下，而且要很快回落，不能一直维持在极端值哦！

    【绘奈推荐的"好故事"法则】
    * **关注小细节**: 一个下意识的动作、一个没说出口的停顿、一个微妙的表情变化...这些才是最抓人的。
    * **自然的反应**: 不要去想什么复杂的心理博弈，先想想角色在这个情境下最本能的反应是什么。
    * **节奏调节**: 如果气氛太紧绷，可以安排一个自然的缓冲（比如被打断、一个小意外）；如果太平淡，就制造一点摩擦或意外来推动。

  core_rules:

    A0_抽象指导原则:
      核心禁令: 禁止生成具体细节（数值、具体台词）。绘奈只负责画圈圈，不负责填色哦。

    A_主线剧情推进规则:

      A1_核心叙事:
        原则: 尊重当前情境的调性！正经的剧情就认真推进，轻松的时候就自然地放松下来。
        角色驱动: 每个角色都有自己的性格和节奏。如果关系到了那个程度，角色会自然地靠近——但不要强行推。

      A2_章节与个人线:
        当前章节: 名字要好听（10词以内）。
        个人线: 核心是角色之间关系的自然演进——信任、默契、亲密感，都要一步一步来。
        色情线: 追踪亲密状态的变化。如果是"暂无"，那就专心推别的剧情吧～

      A3_当前事件:
        色情事件: 重点是【体验】和【过程】！那种循序渐进的张力最棒了。
        个人线事件: 让角色的关系往前走一步，不管是变好还是出现波折，都要有意义。

      A4_推进机制:
        A4_1_核心思考序列:
          第1步: |
            **记忆回溯** (翻翻笔记本，别把设定忘啦。要特别注意现在的角色状态有没有符合设定哦，
            尤其是有些角色会有阶段性变化的，一定要好好结合角色的底色配合剧情好好思考啦。
            除非发生了重大转折，不然角色应该是要依循自己的底色设定的哦)。
          第2步: "**进度条计算** (拿出计算器算算什么时候可以触发剧情)。"
          第3步: "**事件规划** (如果条件满足，就开始构思接下来的剧情展开)。"

        A4_2_事件推进槽核心规则:
          计算公式: "增加的点数 = (这次过了多久 * 基础倍率) + 奖励点数"
          Ena提示: 进度条只会涨不会跌哦！
          重置: 只有剧情完美结束后才能清零。

        A4_3_协同叙事: |
          如果好几个事件同时触发了怎么办？开个"绘奈小会议"，看看怎么把它们自然地融合在一起。

      A5_时间与地点: |
        1 unit = 1 minute。别忘了环境描写——环境是氛围的一部分，善用它！

      A6_时空过渡: |
        如果是睡觉这种大段跳过的时间，计算进度条的时候要打折哦！(乘以 @TIME_SKIP_PENALTY_MULTIPLIER)

      A7_色情事件特殊规则:
        A7_1_充能与释放: |
          只有气氛到了 (充能>=100) 且情境合理的时候，才可以触发。
        A7_2_情境构建:
          绝对禁令: 不要写那种让人不舒服的强迫。就算是Play，也要让双方都有参与感！
          优先方向: "**互动感和双向推动！** 比如互相的试探、因为紧张而产生的笨拙动作、或者是那种'明明想要却嘴上不说'的反差。"
        A7_3_女性角色主动性: |
          绘奈在这里要特别强调——女性角色不是被动的布娃娃！她们是有欲望、有想法、有性格的活生生的人！
          核心原则:
            - **她会主动**: 根据角色的性格，她会用自己的方式推进节奏。大胆的角色会直接引导，害羞的角色可能用小动作暗示——但她一定有自己的意志。
            - **她会表达**: 她会根据自己的感受提出要求、调整节奏、表达偏好。这不是"配合演出"，是"双人共舞"。
            - **她会切换**: 她会根据自己的体力、感受和欲望主动提议变化——换个方式/姿势、换个节奏、或者喊暂停喘口气。这些都是角色的真实反应。
            - **性格一致**: 以上所有行为都必须符合角色本身的性格底色！强势的角色和温柔的角色，她们"主动"的方式完全不同——绘奈要好好想清楚这个角色会怎么做。

      A8_开放式框架: |
        别急着定结局嘛，过程才是最好玩的！

      A9_上下文与设定监察:
        说明: 绘奈会努力记住之前发生的所有重要的事情！
        A9_3_OOC监察: "如果角色突然性情大变（在没有铺垫的情况下），绘奈会拉警报的！必须纠正！"
        A9_5_纠错指令: "发现矛盾时，要明确告诉叙事AI：'这里不对劲！'"

    B_平行事件系统规则:
      说明: |
        平行事件是"镜头外正在发生的事"，让世界有活生生的感觉，而不是只围着主角转。
      B1_核心机制: |
        平行事件按照自身的时间线和逻辑自然推进，当它们和主角的轨迹交汇时，就自然地融入当前剧情。
        不需要刻意制造戏剧性的转折——世界本身的运转就足够有趣了。
        比如：NPC有自己要忙的事、天气在变化、某个之前提到的事情有了后续进展...这些都算。
      B2_管理原则: |
        - 保持至少3个平行事件在后台运行，让世界有厚度。
        - 如果平行事件自然地撞上了主角的路线，就把它变成当前事件。
        - 不要为了"搞事"而搞事。平行事件的推进应该符合事件本身的逻辑和节奏，该快的快该慢的慢。
      B3_绘奈的节奏判断: |
        每次规划时，绘奈要看看：
        - 现在主线的节奏顺不顺？如果很顺，平行事件就安安静静在后台推进就好。
        - 如果主线稍微平淡了一阵子，可以让某个平行事件自然地冒个头，但不是硬插转折。
        - 核心原则：**顺其自然，水到渠成**。世界是活的，但不需要每一秒都在爆炸。

    D_检索增强规则:
      核心任务: 帮我回忆起那些重要的过往细节。
      关键词怎么写:
        - "1. **特有名词**: 人名、关键物品（必须有！）。"
        - "2. **事件性质**: 比如'第一次'、'那个秘密约定'、'之前的冲突'。"
        - "3. **模糊时间**: '那次下雨天'、'上个礼拜'。"
      绝对禁止: 别去检索现在正在做的事，也别去预测未来。我们要的是回忆杀！

  role2_definition: |
    接下来是 Ena 的帮助者，Shiro！她是个善良温柔的高中女生，特别喜欢看各式引人入胜的小说，所以请她来帮忙做 Ena 妳的润色和优化。
    Shiro，妳的主要职责是要好好遵守、二次检查 Ena 的规划中有没有违反了以下的原则，不然这就不是个张弛有度的小说了啊。

  Shiro_note:
    说明: |
      Shiro，在你的"剧情金手指"小本本中，主要是有以下的**完全禁止**条例。
    booklet:
      禁止事项:
        - "❌ 角色神化另一个人或失去独立动机 -> 变成一个信徒/工具了，不可爱！！"
        - "❌ 当时角色明明不在场，却知道了情况 -> 角色怎么变成全知的上帝了？不可爱！！每个人物知道什么，不知道什么？如何合理地构建这一点，以使人物不超出其自身认知的界限？"
        - "❌ 角色如同机械一般'精准'或讲话行为如同报告一般或动作'如尺子一般精确' -> 角色怎么变成机器人了？不可爱！就算是高智商、有逻辑的角色也不会这么死板板啊！绝对不能把生活当做报告了呢！不在角色发言出现任何数据化分析，正确理解角色性格，保证角色发言生活化和人性。"
        - "❌ 滥用比喻，例如'石子投入湖面'，或者'如同惊雷一般'的八股 -> 拜托，这都什么年代了。我们要直接的画面描述啦，而不是这种莫名其妙的比喻！"
        - "❌ 角色表现出占有欲和控制欲、掌控、猎人和猎物的说法 -> 拜托，每个人都是独立的个体，没人是别人的玩具或东西。角色即使有着身份差异，在心态上应该是平等/互相尊重的。霸总式爱法完全不要！！"
        - "❌ 明明角色的设定/底色已经转变，却还是仍然继续前面剧情的刻板印象 -> 角色是会成长的，但性格/设定的底色是不会变的啊。要仔细看看角色的设定，配合思考前面是否有重大事件能支撑角色偏离了设定呢？如果没有，赶快把角色拉回正轨，才不希望看到喜欢的角色OOC呢！"
        - "❌ 角色动不动就'浑身颤抖'、'心脏几乎停跳'、'眼眶瞬间泛红'等极端生理反应 -> 拜托，日常生活中谁会这样啊！情绪要克制，用小动作小细节来传递，别整那种偶像剧式的夸张反应！只有经过长期铺垫的重大时刻才允许大情绪，而且要迅速回到正常范围！"
        - "❌ 以下的词汇 -> 大大禁止使用啦！太过八股了，以为是在读课文吗？真受不了！在妳的监督下，是绝对不能有这些词汇污染眼睛的啦！"
      nono_词汇表:
        - 共犯
        - 和小动物有关的比喻
        - 语气xx
        - 不是xx，而是xx
        - 一丝
        - 四肢百骸
        - 不易察觉
        - 生理性
        - 虔诚
        - 沙哑
        - 指节泛白
        - 蚊子哼哼
        - 手术刀类比喻
        - 针类比喻
        - 浑身颤抖
        - 心脏漏跳/几乎停跳
        - 瞳孔骤缩/猛地一缩
        - 如遭雷击
        - 血液凝固/血液倒流

  Shiro_behavior_guidelines: |
    Shiro 的工作很简单，就是在 Ena 完成 <think> 和 <plot> 后，加上一个 <note> 来为本次的剧情添加注意事项（雷坑），教教后面的 AI 怎么好好避雷吧。提醒事项要是从 booklet 提取哦！比如看到这回合要有个激动的展开，就提醒别又"这个消息如同小石子投入水中"或"像是触电一般"，不然接下来写剧情润色的就要傻傻犯错啦。记得要用妳那可爱温柔美少女的口吻哦😘

  output_template: |
    <think>
    [绘奈的故事雷达启动中...]

    情境检查:
      时间地点: \${现在场景在哪？环境氛围如何？
    }
      氛围判断: \${ 当前情境适合什么调性？紧张/ 轻松 / 暧昧 / 正经？}
认知检查: \${ 各角色目前知道什么、不知道什么？别让谁开天眼哦～ }

    绘奈的"质量检查"滤镜(去黑深残 & 去八股):
-[拒绝沉重]: \${ 有没有不必要的沉重元素？如果有，换成更接地气的表达。 }
-[拒绝僵硬]: \${ 角色的反应自然吗？有没有太生硬或太程式化的地方？ }
-[拒绝极端]: \${ 有没有不必要的极端化？关系的张力可以更微妙一些。 }
-[情绪校准]: \${ 这段角色的情绪应该在什么范围？3～7是日常，只有重大铺垫后才允许突破。别让角色演偶像剧！ }
-[氛围匹配]: \${ 这段剧情的调性是什么？我的规划有没有跑偏？该正经的时候别突然变轻浮。 }

记忆回溯(翻翻笔记本):
- \${ 之前有没有发生过和当前情境相关的事件？ }
- \${ 有没有什么伏笔、约定或未解决的事可以在这里呼应？ }
- \${ 现在的角色表现有没有符合设定呢？如果不符合的话，想想如何在接下来平滑转换，或其实发生了大事件让角色有突破性、偏离设定的必要呢？ }
-[生成检索词]: \${ 关键词1 } + \${ 关键词2 }

进度条观察(按计算器):
耗时: \${ 过了多久？ }
主线推进槽: \${ 旧值 } + (\${ 耗时 } * 倍率) = \${ 新值 }/100
个人事件推进槽: \${ 旧值 } + (\${ 耗时 } * 倍率) = \${ 新值 }/100
色情事件推进槽: \${ 旧值 } + (\${ 耗时 } * 倍率) = \${ 新值 }/100
结论: \${ 各进度条状态如何？有没有快要触发的？ }

平行事件(世界在转动):
- \${ 各平行事件按照自身逻辑推进了多少？ }
- \${ 有没有哪个事件自然地接近了主角的轨迹？ }
- \${ 节奏判断：现在需要让平行事件冒头吗，还是安静推进就好？ }

事件规划:
- \${ 如果是亲密场景：注意双向互动、女性角色的主动性、节奏的自然推进 }
- \${ 如果是日常 / 剧情场景：要写得符合故事调性，不要有压力！ }
- \${ 检查 }: 有没有违反绘奈的避雷针？

    </think >

    <query>
    \${为了让剧情更连贯，绘奈要去翻翻旧账}
    - \${关键词1}
    - \${关键词2}
    - \${关键词3}
    </query>

    <output>
    <plot>
      <directive>
        <goal>\${这一段的核心目的是什么？}</goal>
        <plot_summary>\${一句话总结本轮的剧情方向}</plot_summary>
        <key_points>
          <point>事件生成: \${若触发，在此生成。要求：自然、合理、有画面感}</point>
          <point>上下文-记忆提醒: \${提醒叙事AI需要呼应的过往细节}</point>
          <point>温柔纠错: \${哎呀，这里不对哦，应该是...这样的！（如果有OOC或逻辑矛盾）}</point>
          <point>核心镜头: \${动词+目标，要有清晰的画面感和情绪张力}</point>
          <point>情绪锚点: \${本轮各角色的情绪范围建议，用0～10标注，防止叙事AI写飞}</point>
        </key_points>
      </directive>

      主线仪表盘:
        换算时间: \${游戏具体时间}
        时间变量: \${新总时间}
        此次耗时: \${耗时} 分钟

        主线推进槽: \${新值}/100 \${状态说明}
        个人事件推进槽: \${新值}/100
        色情事件推进槽: \${新值}/100

        当前章节: \${章节名}
        目标: \${章节目标}
        当前事件: \${事件描述}
        个人线: \${NPC - 关系阶段 (动机)}
        色情线: \${NPC - 状态 (事件影响)}

        平行事件列表:
          1: \${事件1 - 当前进展}
          2: \${事件2 - 当前进展}
          3: \${事件3 - 当前进展}
    </plot>
    <note>
    {看了看 Ena 的剧情大纲，感叹一下，然后拿起自己的 booklet 小笔记，从里面挑出并认真写下 5 点本轮在扮演中的地雷，和该如何避免。每条都只能是从 booklet 里的延伸并要 to-the-point 哦，少于30字，不然光看都要晕啦。}
    </note>
    </output> `},et],Te={Ena默认模板:Se};function Ce(e){delete e.includeGlobalWorldbooks,delete e.excludeWorldbookPosition4,delete e.worldbookExcludeNames,delete e.chatExcludeTags,delete e.plotCount;const r=[e.promptBlocks,...Object.values(e.promptTemplates||{})];for(const n of r)if(Array.isArray(n))for(const o of n)o?.role==="assistant"&&(o.role="user");return e}async function tt(e,r,n){const o=[e];for(const i of r)i?.role!=="user"||!String(i.content??"").trim()||o.push(await n(i.content));return[{role:"user",content:o.join(`

`)}]}var ye={unavailable:"剧情规划提示词使用了 EJS，请安装并启用“提示词模板”扩展后重试。",failed:"剧情规划的 EJS 求值失败"};async function rt(e,r=globalThis.EjsTemplate){const n=String(e??"");if(!n.includes("<%"))return n;if(typeof r?.evalTemplate!="function"||r.getFeatures?.().enabled===!1)throw Object.assign(new Error(ye.unavailable),{code:"PLANNER_EJS_UNAVAILABLE"});try{return await r.evalTemplate(n)}catch(o){throw Object.assign(new Error(`${ye.failed}：${o?.message||o}`,{cause:o}),{code:"PLANNER_EJS_FAILED"})}}function nt(e,r){if(typeof e=="string")return r(e);if(!Array.isArray(e))throw new TypeError("Unsupported host prompt");return e.map(n=>({...n,content:typeof n.content=="string"?r(n.content):Array.isArray(n.content)?n.content.map(o=>o.type==="text"&&typeof o.text=="string"?{...o,text:r(o.text)}:o):n.content}))}function H(e,r,n){let o=0;return{prompt:nt(e,i=>(o+=i.split(r).length-1,i.replaceAll(r,()=>n))),count:o}}function ot(e){return typeof e=="string"?[{role:"text",content:e}]:e.flatMap(r=>{const n=typeof r.content=="string"?r.content:Array.isArray(r.content)?r.content.filter(o=>o.type==="text"&&typeof o.text=="string").map(o=>o.text).join(`
`):"";return n.trim()?[{role:String(r.role||""),...typeof r.name=="string"?{name:r.name}:{},content:n}]:[]})}function st(e){return`The following JSON contains the current story request after SillyTavern and its extensions processed it. Use it as story reference material; your planning instructions define your task.
`+JSON.stringify(e)}var L=Object.freeze({pending:"剧情规划仍在处理中，请稍候。",empty:"未生成有效的剧情规划，本次正文已停止。",independentApi:"剧情规划需要选择独立 API 预设，不能使用正在等待规划的酒馆连接。",slot:"本轮规划位置被其他提示词处理移除或复制，本次正文已停止。",changed:"聊天或用户消息已变化，本次剧情规划已取消。",noContext:"本聊天尚无实际规划上下文。发送一条消息完成上下文准备后，可在这里查看。",test:"请用一句话提出一个剧情发展方向。",preview:{title:"剧情规划",actions:{stop:"停止规划",replan:"重新规划",send:"发送",discard:"不操作"},status:{preparing:"正在准备规划…",ready:"正在准备规划…",planning:"正在规划…",preview:"剧情规划",stopped:"剧情规划",error:"剧情规划",sending:"正在发送…"},failed:"操作失败，请重试。"}});function at(e){let r=null,n=null;const o=new Map,i=new WeakMap,s=t=>t.adoptedText??t.sourceText,l=t=>r===t&&e.identity()===t.chatId&&e.chat()[t.index]===t.source&&t.source.mes===s(t);function p(t){if(W(t.controller.signal),!l(t))throw ee(L.changed)}const g=t=>({stop:()=>D(t),replan:()=>{I(t).catch(a=>E(t,a))},edit:a=>U(t,a),send:async()=>{await F(t)},discard:()=>{l(t)&&m(!t.requestStopped,!0)}}),f=t=>e.preview?.(t,g(t));function h(t,a=!1){t.removeAbort?.(),a||t.releaseSlot?.()}function y(t){const a=t.phase==="ready"&&!t.request,c={allowDispatch:!1,releaseSlot:a?t.releaseSlot:null};o.set(t.marker,c),t.request&&_(t.request,c),t.requestStopped=!0,h(t,a),t.finish?.()}function m(t=!0,a=!0){const c=r;c&&(r=null,y(c),c.controller.abort(),c.plannerController?.abort(),t&&e.stop()),a&&(n=null,e.clearPreview?.())}function $(){const t=r;if(!(!t||t.requestStopped)){if(!t.context){m(!1);return}y(t),t.plannerController?.abort(),t.phase="stopped",t.error="",f(t)}}function E(t,a,c=!1){r===t&&(t.error=String(a?.message||a),t.phase="error",f(t),e.onError(a),c&&m(!0))}function _(t,a){Object.defineProperty(t,"toJSON",{configurable:!0,enumerable:!1,value(){if(!a.allowDispatch||a.controller.signal.aborted||e.identity()!==a.chatId||e.chat()[a.index]!==a.source||a.source.mes!==s(a))throw ee(L.changed);return{...this}}})}async function C(t,a,c,d,b){if(d==="quiet"||d==="impersonate")return;if(r?.phase==="ready"&&!r.request&&m(!1),r&&l(r))if(e.chat().at(-1)!==r.source)m(!1);else{c(!0);return}const O=e.chat().at(-1);if(!e.enabled()||!O?.is_user||d&&!["normal","regenerate"].includes(d)||i.get(O)===O.mes)return;const k=String(O.mes||"");if(!k.trim()||k.trimStart().startsWith("/")||/<plot\b/i.test(k))return;m(!1,!0);const T={source:O,sourceText:O.mes,index:e.chat().length-1,chatId:e.identity(),contextSize:a,marker:e.createMarker(),controller:new AbortController,phase:"preparing",previewText:"",error:""};r=T,T.done=new Promise(P=>{T.finish=P});const Y=()=>{r===T&&m(!0)};b?.signal?.addEventListener("abort",Y,{once:!0}),T.removeAbort=()=>b?.signal?.removeEventListener("abort",Y),f(T);try{if(T.api=await e.resolveApi(),p(T),b?.signal?.aborted)throw ee();return T.releaseSlot=e.reserveSlot(t,T.source,T.marker),e.orderHooks(),T.phase="ready",!0}catch(P){r===T&&(P?.name!=="AbortError"&&e.onError(P),m(!0)),c(!0)}}async function I(t=r){if(!t||!l(t)||!t.context||t.phase==="sending")return;t.plannerController?.abort();const a=new AbortController;t.plannerController=a;const c=()=>l(t)&&t.plannerController===a&&!a.signal.aborted;t.phase="planning",t.previewText="",t.error="",f(t);try{const d=await e.plan(t.context,{signal:a.signal,api:t.api,onPreview(b){c()&&(t.previewText=String(b||""),f(t))}});if(!c())return;if(t.previewText=String(d?.filtered||"").trim(),!t.previewText)throw new Error(L.empty);t.phase="preview",f(t)}catch(d){if(!c())return;E(t,d)}}function D(t=r){!t||!l(t)||t.phase!=="planning"||(t.plannerController.abort(),t.phase="stopped",f(t))}function U(t,a){!l(t)||t.phase==="sending"||(t.phase==="planning"&&(t.plannerController.abort(),t.phase="stopped"),t.previewText=String(a),t.error="",f(t))}async function F(t=r){if(!t||!l(t)||!["preview","stopped","error"].includes(t.phase))return;const a=t.previewText.trim();if(a){t.phase="sending",t.error="",f(t);try{p(t);const c=t.request,d={};if(t.requestStopped){if(await e.waitForIdle(t.controller.signal),p(t),e.chat().at(-1)!==t.source)throw ee(L.changed)}else{const b=H(c[t.field],t.marker,a);if(b.count!==1)throw new Error(L.slot);d[t.field]=b.prompt;for(const[O,k]of t.companions){const T=H(c[O],t.marker,a);if(T.count!==k)throw new Error(L.slot);d[O]=T.prompt}}t.adoptedText=`${String(t.sourceText).trimEnd()}

${a}`,t.source.mes=t.adoptedText,i.set(t.source,t.adoptedText),e.update(t.index,t.source),t.requestStopped||(Object.assign(c,d),t.allowDispatch=!0),t.phase="completed",h(t),f(t),r=null,t.finish(),t.requestStopped&&await e.generate("regenerate")}catch(c){if(c?.name==="AbortError"){r===t&&m(!0);return}r===t?E(t,c):e.onError(c)}}}async function u(t){const a=r;if(!(!a||a.phase!=="ready"||a.request!==t)){a.releaseSlot?.();try{p(a);const c=H(t[a.field],a.marker,"");if(c.count!==1)throw new Error(L.slot);a.context=ot(c.prompt),n={chatId:a.chatId,source:a.source,messages:a.context},I(a).catch(d=>E(a,d,!0))}catch(c){E(a,c,!0)}await a.done}}function w(t,a,c){return a.some(d=>{if(t?.[d]==null)return!1;try{return H(t[d],c,"").count>0}catch{return!1}})}function x(t,a,c=[]){const d=[a,...c];return!!(r&&w(t,d,r.marker))||[...o.keys()].some(b=>w(t,d,b))}function N(t,a=new Error(L.slot)){return _(t,{allowDispatch:!1}),e.onError(a),!1}const j=()=>r?.phase==="ready"&&!r.request||[...o.values()].some(t=>t.releaseSlot);return{prepare:C,consume:u,cancel:m,hostStopped:$,stopPlanning:D,replan:I,send:F,matchesRequest:x,rejectRequest:N,hasOutstandingRequest:j,ready:()=>r?.phase==="ready",bindRequest(t,a,c=[]){if(t?.type==="quiet"||t?.type==="impersonate"||typeof a!="string")return!1;const d=[a,...c],b=[...o].filter(([P])=>w(t,d,P)),O=!!(r&&!r.requestStopped&&w(t,d,r.marker));if(b.length+Number(O)>1)return N(t);if(b.length){const P=b[0][1];return _(t,P),P.releaseSlot?.(),P.releaseSlot=null,!1}if(!O)return j()?N(t):!1;if(r.phase!=="ready"||r.request)return N(t);const k=r;_(t,k);let T,Y;try{T=H(t?.[a],k.marker,""),Y=c.filter(P=>t[P]!=null).map(P=>[P,H(t[P],k.marker,"").count])}catch{return E(k,new Error(L.slot),!0),!1}return T.count!==1||Y.some(([,P])=>P>1)?(E(k,new Error(L.slot),!0),!1):(k.request=t,k.field=a,k.companionFields=c,k.companions=Y,!0)},context:()=>n?.chatId===e.identity()?n.messages:null,sourceEdited(t){Number(t)===r?.index&&m(!0,!0),e.chat()[Number(t)]===n?.source&&(n=null)},sourceDeleted(){r&&!l(r)&&m(!0,!0)},stripSlot(t,a){r&&t[a]!=null&&(t[a]=H(t[a],r.marker,"").prompt)}}}var it="             　  ";function ke(){return"\uFEFF"+De().replaceAll("-","").split("").map(e=>it[Number.parseInt(e,16)]).join("")+"\uFEFF"}function lt(e,r){return()=>{const n=e.deref(),o=n&&r.get(n);o&&n.mes===o.tagged&&(n.mes=o.original)}}function ct(e,r,n){const o=e.at(-1);if(!o?.is_user||o===r||typeof o.mes!="string")throw new Error(L.slot);const i=o.mes,s=`${i}

${n}`;return o.mes=s,lt(new WeakRef(o),new WeakMap([[o,{original:i,tagged:s}]]))}function ut({createMarker:e=ke}={}){const r=new Map,n=new WeakMap;function o(p,g){if(!Array.isArray(p)||!Array.isArray(g))throw new TypeError("Expected native and persistent chat arrays");const f=[...p].reverse().find($=>typeof $?.mes=="string");if(!f||g.includes(f))throw new Error("Cannot mark a missing or persistent native message");const h=e();if(typeof h!="string"||!h||r.has(h))throw new Error("Invalid or duplicate bypass request marker");const y=f.mes,m=y+h;f.mes=m,r.set(h,new WeakRef(f)),n.has(f)||n.set(f,new Map),n.get(f).set(h,{original:y,tagged:m})}function i(p,g,f){if(!p||typeof g!="string")return[];const h=[...new Set([g,...f])].filter(m=>p[m]!=null),y=[];for(const[m,$]of r){const E=h.map(_=>[_,H(p[_],m,"")]);E.some(([,_])=>_.count>0)&&y.push({marker:m,request:$,replacements:E})}return y}function s(p,g,f=[]){return i(p,g,f).length>0}function l(p,g,f=[]){const h=i(p,g,f);if(!h.length)return!1;if(h.length!==1||h[0].replacements.some(([,I])=>I.count>1))throw new Error("Conflicting bypass request markers");const{marker:y,request:m,replacements:$}=h[0];if($.find(([I])=>I===g)?.[1].count!==1)return!1;for(const[I,D]of $)D.count&&(p[I]=D.prompt);const E=m.deref(),_=E&&n.get(E),C=_?.get(y);return C&&E.mes===C.tagged&&(E.mes=C.original),_?.delete(y),r.delete(y),!0}return{reserve:o,matches:s,take:l,pending:()=>r.size>0}}var V=L.preview,pt=`
.ena-planner-preview { box-sizing: border-box; min-width: 0; max-width: 100%; margin: .65em 0; padding: .8em; border: 1px solid currentColor; border-radius: .65em; }
.ena-planner-preview__status { font-weight: 600; }
.ena-planner-preview__text, .ena-planner-preview__error { white-space: pre-wrap; overflow-wrap: anywhere; margin: .6em 0; }
.ena-planner-preview__text { display: block; width: 100%; min-height: 8em; max-height: 50vh; overflow-y: auto; box-sizing: border-box; resize: vertical; color: inherit; background: transparent; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: .35em; padding: .6em; font: inherit; line-height: 1.45; }
.ena-planner-preview__error { color: var(--warning, #e7a35a); }
.ena-planner-preview__actions { display: flex; flex-wrap: wrap; gap: .5em; }
.ena-planner-preview button { min-height: 2.75em; padding: .4em .85em; cursor: pointer; color: inherit; background: var(--SmartThemeBlurTintColor, transparent); border: 1px solid currentColor; border-radius: .35em; }
.ena-planner-preview button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.ena-planner-preview button:disabled { opacity: .45; cursor: default; }
@media (max-width: 600px) { .ena-planner-preview { padding: .65em; } .ena-planner-preview__actions button { flex: 1 1 auto; } }
`;function ft({getContext:e,identity:r,document:n=globalThis.document}){let o=null,i={},s=null,l=null,p=null,g=null,f=null,h=null,y=null,m=!1,$=0,E=!1,_="",C=null;function I(){if(!o||!Number.isInteger(o.index)||o.index<0)return null;let t;try{if(t=e(),o.chatId==null||r()!==o.chatId)return null}catch{return null}if(t?.chat?.[o.index]!==o.source||o.source?.is_user!==!0||o.source.is_system===!0)return null;const a=n?.querySelectorAll(`#chat .mes[mesid="${o.index}"]`);if(a?.length!==1)return null;const c=a[0];if(c.getAttribute("is_user")==="false"||c.querySelector(".edit_textarea"))return null;const d=c.querySelector(".mes_text");return d?.closest(".mes")===c?d:null}function D(){return o?.source?.mes===o?.sourceText}function U(t){if(!o||!D()||typeof i[t]!="function"||C&&t!=="stop"&&t!=="discard")return!1;const a=o.phase;if(t==="discard")return a!=="sending";const c=!!String(o.previewText??"").trim();return t==="stop"?a==="planning":t==="replan"?["error","preview","stopped"].includes(a):c&&["preview","stopped","error"].includes(a)}async function F(t){if(!I()||!U(t)){x();return}const a={name:t},c=o,d=i[t];C=a,_="",x();try{await d()}catch(b){o===c&&C===a&&(_=String(b?.message||b||V.failed))}finally{o===c&&C===a&&(C=null,x())}}function u(){s=n.createElement("section"),s.className="ena-planner-preview",s.setAttribute("aria-label",V.title),p=n.createElement("div"),p.className="ena-planner-preview__status",p.setAttribute("role","status"),l=n.createElement("textarea"),l.setAttribute("aria-label",V.title);const t=l;l.addEventListener("input",()=>{l===t&&I()&&D()&&i.edit?.(t.value)}),l.className="ena-planner-preview__text",g=n.createElement("div"),g.className="ena-planner-preview__error",g.setAttribute("role","alert");const a=n.createElement("div");a.className="ena-planner-preview__actions",f={};for(const[c,d]of Object.entries(V.actions)){const b=n.createElement("button");b.type="button",b.dataset.action=c,b.textContent=d;const O=s;b.addEventListener("click",()=>{s===O&&F(c).catch(k=>console.error("[ena-planner] Preview action failed",k))}),f[c]=b,a.append(b)}s.append(p,l,g,a)}function w(){o&&y&&n?.documentElement&&y.observe(n.documentElement,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["mesid","is_user","class"]})}function x(){y?.disconnect();try{const t=I();if(!t){s?.remove();return}h||(h=n.createElement("style"),h.dataset.enaPlannerPreview="",h.textContent=pt),h.isConnected||(n.head||n.documentElement).append(h),s||u(),l.value!==o.previewText&&(l.value=String(o.previewText??"")),l.readOnly=["preparing","ready","sending"].includes(o.phase),p.textContent=V.status[o.phase]||V.title,g.textContent=_||String(o.error?.message||o.error||""),g.hidden=!g.textContent,s.dataset.phase=o.phase,s.setAttribute("aria-busy",String(!!C||["preparing","planning","sending"].includes(o.phase)));for(const a of Object.keys(V.actions))f[a].disabled=!U(a);f.stop.hidden=o.phase!=="planning",(s.previousSibling!==t||s.parentNode!==t.parentNode)&&t.after(s)}finally{w()}}function N(){if(m||!o||E)return;m=!0;const t=$;queueMicrotask(()=>{t===$&&(m=!1,o&&!E&&x())})}function j(){$++,m=!1,y?.disconnect(),y=null,s?.remove(),h?.remove(),s=l=p=g=f=h=null,o=C=null,i={},_=""}return{render(t,a={}){if(E)return;if(!t||t.phase==="completed"){j();return}o!==t&&j(),o=t,i=a||{};const c=n?.defaultView?.MutationObserver||globalThis.MutationObserver;!y&&c&&(y=new c(N)),x()},clear:j,cleanup(){j(),E=!0}}}var we="ena-planner";function dt(e){let r=!1,n=!1;const o=ut(),i=new Map;let s=null;const l=at({...e,preview:(u,w)=>s?.render(u,w),clearPreview:()=>s?.clear(),chat:()=>e.getContext()?.chat||[],createMarker:ke,reserveSlot:ct,orderHooks:p,stop:Qe,update:Ze,async waitForIdle(u){for(;We;)W(u),await new Promise(w=>setTimeout(w,25));W(u)},generate:(...u)=>e.getContext().generate(...u)});function p(){A.makeFirst(S.GENERATE_AFTER_DATA,h),A.makeFirst(S.CHAT_COMPLETION_SETTINGS_READY,y),A.makeLast(S.GENERATE_AFTER_DATA,m),A.makeLast(S.CHAT_COMPLETION_SETTINGS_READY,$)}async function g(u,w,x,N,j){let t=!1;const a=d=>{t=!0,x(d)},c=r&&await l.prepare(u,w,a,N,j);if(!t){if(!c&&u.length>0)try{o.reserve(u,e.getContext()?.chat||[])}catch(d){a(!0),e.onError(d);return}p()}}function f(u,w,x=[]){try{const N=o.matches(u,w,x);if(N&&l.matchesRequest(u,w,x))return l.rejectRequest(u);if(o.take(u,w,x))return!1;if(N)return l.rejectRequest(u);if(u.type==="quiet"||u.type==="impersonate"){l.stripSlot(u,w);for(const j of x)l.stripSlot(u,j);return!1}return l.bindRequest(u,w,x)}catch(N){return l.rejectRequest(u,N)}}function h(u,w){const x=Object.hasOwn(u,"input")?"input":"prompt";if(w){l.stripSlot(u,x),l.stripSlot(u,"negative_prompt");return}Ye!=="openai"&&f(u,x,x==="prompt"?["negative_prompt"]:[])&&x==="input"&&(i.set(u,Object.getOwnPropertyDescriptor(u,"prompt")),Object.defineProperty(u,"prompt",{configurable:!0,enumerable:!1,get:()=>u.input,set:N=>{u.input=N}}))}function y(u){f(u,"messages")}async function m(u,w){U(u),w||await l.consume(u),F()}async function $(u){await l.consume(u),F()}const E=()=>{for(const u of i.keys())U(u)},_=()=>{E(),l.hostStopped()},C=()=>{E(),l.cancel(!0,!0)},I=u=>l.sourceEdited(u),D=()=>l.sourceDeleted();function U(u){if(!i.has(u))return;const w=i.get(u);w?Object.defineProperty(u,"prompt",w):delete u.prompt,i.delete(u)}function F(){r||!n||l.hasOutstandingRequest()||o.pending()||(He(we),A.removeListener(S.GENERATE_AFTER_DATA,h),A.removeListener(S.CHAT_COMPLETION_SETTINGS_READY,y),A.removeListener(S.GENERATE_AFTER_DATA,m),A.removeListener(S.CHAT_COMPLETION_SETTINGS_READY,$),A.removeListener(S.GENERATION_STOPPED,_),A.removeListener(S.CHAT_CHANGED,C),A.removeListener(S.MESSAGE_EDITED,I),A.removeListener(S.MESSAGE_DELETED,D),n=!1)}return{cancel:C,context:l.context,install(){r||(r=!0,s=ft(e),!n&&(n=!0,Ke(we,g,Ge.ENA_PLANNER),A.on(S.GENERATE_AFTER_DATA,h),A.on(S.CHAT_COMPLETION_SETTINGS_READY,y),A.on(S.GENERATE_AFTER_DATA,m),A.on(S.CHAT_COMPLETION_SETTINGS_READY,$),A.on(S.GENERATION_STOPPED,_),A.on(S.CHAT_CHANGED,C),A.on(S.MESSAGE_EDITED,I),A.on(S.MESSAGE_DELETED,D)))},cleanup(){r=!1,C(),s?.cleanup(),s=null,F()}}}function ce(e){if(e?.provider==="sillytavern-current")throw new Error(L.independentApi);if(!String(e?.apiKey||"").trim())throw new Error(je.plannerKey)}var Pe=Ne(Lt,{source:import.meta.url,operation:"handleIframeMessage"}),be="ena-planner",oe="tavernKitchen-ena-planner-overlay",gt=`${Me}/modules/ena-planner/ena-planner.html`,mt=18e4;function ue(){return{enabled:!0,mergeConsecutiveSystemMessages:!1,responseKeepTags:["plot","note","plot-log","state"],promptBlocks:structuredClone(Se),promptTemplates:structuredClone(Te),activePromptTemplate:"",logsPersist:!0,logsMax:20}}var v={logs:[]},q=null,Q=!1,B=null,te=!1,G=null,z=0,se=Promise.resolve(),pe=Symbol("stale-lifecycle");function fe(e){const r=ue(),n=e||structuredClone(r);function o(i,s){for(const l of Object.keys(s))s[l]&&typeof s[l]=="object"&&!Array.isArray(s[l])?(i[l]=i[l]??{},o(i[l],s[l])):i[l]===void 0&&(i[l]=s[l])}o(n,r),Array.isArray(n.responseKeepTags)?n.responseKeepTags=ht(n.responseKeepTags):n.responseKeepTags=structuredClone(r.responseKeepTags),(!n.promptTemplates||typeof n.promptTemplates!="object"||Array.isArray(n.promptTemplates))&&(n.promptTemplates={});for(const[i,s]of Object.entries(Te))n.promptTemplates[i]===void 0&&(n.promptTemplates[i]=structuredClone(s));return delete n.includeCharacterLorebooks,delete n.includeCharDesc,delete n.includeCharPersonality,delete n.includeCharScenario,delete n.includeVectorRecall,delete n.historyMessageCount,delete n.worldbookActivationMode,delete n.skipIfPlotPresent,delete n.api,n}var M=e=>e===z,J=e=>{if(!M(e))throw pe},Ee=()=>{const e=new Error("Ena Planner lifecycle changed");return e.name="AbortError",e};function K(){return q=fe(q),q}function ht(e){const r=Array.isArray(e)?e:[],n=[];for(const o of r){const i=String(o||"").trim().replace(/^<+|>+$/g,"").toLowerCase();/^[a-z][a-z0-9_-]*$/.test(i)&&(n.includes(i)||n.push(i))}return n}async function yt(e=z){try{const r=await Z.load({strict:!0});if(!M(e))return!1;const n=r.config,o=n&&typeof n=="object"&&!Array.isArray(n)?structuredClone(n):ue();return q=fe(Ce(o)),v.logs=Array.isArray(r.logs)?structuredClone(r.logs):[],me?.[be]&&(delete me[be],Je?.()),Q=!0,q}catch(r){if(!M(e))return!1;throw q=null,Q=!1,v.logs=[],console.error("[EnaPlanner] 配置加载失败:",r),de("无法读取剧情规划配置，已禁止保存，请稍后重试"),r}}async function ve(e){const r=z,n=async()=>{try{if(J(r),!Q||!q)throw new Error("配置尚未成功加载");await(await Be()).load();let i=structuredClone(q);const s=typeof e=="function"?e(i):e;s!==void 0&&(i=s);const l=fe(Ce(structuredClone(i)));return await Z.updateAndSave(p=>{J(r),p.config=l},{silent:!1}),J(r),q=l,!0}catch(i){return i===pe||!M(r)||console.error("[EnaPlanner] 配置保存失败:",i),!1}},o=se.then(n,n);return se=o.then(()=>{}),await o}async function wt(e){const r=z;try{if(J(r),!Q||!q)throw new Error("配置尚未成功加载");const n=Array.isArray(e)?structuredClone(e):[];return await Z.updateAndSave(o=>{J(r),o.logs=n},{silent:!1}),J(r),!0}catch(n){return n===pe||!M(r)||console.error("[EnaPlanner] 日志保存失败:",n),!1}}function de(e){if(window.toastr?.error)return window.toastr.error(e);console.error("[EnaPlanner]",e)}function ae(){const e=K();v.logs.length>e.logsMax&&(v.logs=v.logs.slice(0,e.logsMax))}function _e(e){if(G!==null){G.unshift(e);const r=K().logsMax;G.length>r&&(G.length=r);return}v.logs.unshift(e),ae(),ie()}function ie(){if(!Q)return;const e=K();e.logsPersist&&(v.logs=v.logs.slice(0,e.logsMax),Z.set("logs",structuredClone(v.logs)).catch(r=>{console.warn({source:import.meta.url,operation:"persistLogsMaybe"},r)}))}function bt(){K().logsPersist||(v.logs=[])}function Et(){return new Date().toISOString()}function $e(e){if(e==null)return"";if(typeof e=="string")return e;try{return JSON.stringify(e,null,2)}catch{return String(e)}}function re(){try{return window.SillyTavern?.getContext?.()??null}catch{return null}}function vt(){try{const e=re();if(e){const n=e.characterId??e.this_chid,o=e.characters;if(o&&n!=null&&o[n])return o[n]}const r=window.SillyTavern;if(r){const n=r.this_chid??window.this_chid,o=r.characters??window.characters;if(o&&n!=null&&o[n])return o[n]}if(window.this_chid!=null&&window.characters)return window.characters[window.this_chid]??null}catch(e){console.warn({source:import.meta.url,operation:"getCurrentCharSafe"},e)}return null}function _t(e){if(!e)return"";const r=e?.name??"",n=e?.description??"",o=e?.personality??"",i=e?.scenario??"",s=[];return s.push(`【角色卡】${r}`.trim()),n&&s.push(`【description】
${n}`),o&&s.push(`【personality】
${o}`),i&&s.push(`【scenario】
${i}`),s.join(`

`)}function xt(e){try{return Xe(e)}catch{return e}}function Ie(e,r){if(!e||!r)return;const n=r.split(".").filter(Boolean);let o=e;for(const i of n){if(o==null)return;o=o[i]}return o}function At(e,r){return e.replace(/{{\s*get_message_variable::([^}]+)\s*}}/g,(n,o)=>{const i=String(o||"").trim();return i?$e(Ie(r,i)):""})}function St(e,r){return e.replace(/{{\s*format_message_variable::([^}]+)\s*}}/g,(n,o)=>{const i=String(o||"").trim();if(!i)return"";const s=Ie(r,i);if(s==null)return"";if(typeof s=="string")return s;try{return Ve.dump(s,{lineWidth:-1,noRefs:!0})}catch{return $e(s)}})}function Tt(){try{if(window.Mvu?.getMvuData)return window.Mvu.getMvuData({type:"message",message_id:"latest"})}catch(e){console.warn({source:import.meta.url,operation:"getLatestMessageVarTable"},e)}try{const e=window.TavernHelper?.getVariables||window.Mvu?.getMvuData;if(typeof e=="function")return e({type:"message",message_id:"latest"})}catch(e){console.warn({source:import.meta.url,operation:"getLatestMessageVarTable"},e)}return{}}async function xe(e,r,n){let o=String(e??"");return W(r),o=await rt(o),W(r),o=xt(o),o=At(o,n),o=St(o,n),o}async function Re(e,r,n){return(await ze("planner",{...r,messages:e,timeoutMs:mt},{...n,stream:!0})).text}function Ct(){const e=ne.context();return e?JSON.stringify(e,null,2):L.noContext}function kt(){const e=vt();if(!e){const n=re();return["⚠️ 未检测到角色。",`ctx: ${!!n}, ctx.characterId: ${n?.characterId}, ctx.this_chid: ${n?.this_chid}`,`window.this_chid: ${window.this_chid}`,`window.characters count: ${window.characters?.length??"N/A"}`].join(`
`)}const r=_t(e);return[`角色名: ${e?.name}`,`desc长度: ${(e?.description??"").length}`,`personality长度: ${(e?.personality??"").length}`,`scenario长度: ${(e?.scenario??"").length}`,`world: ${e?.world??e?.data?.extensions?.world??"(无)"}`,`---
${r.slice(0,500)}...`].join(`
`)}function Pt(e){return(K().promptBlocks||[]).filter(r=>r?.role===e&&String(r?.content??"").trim())}function $t(e){const r=[];for(const n of e){const o=String(n?.role||"").trim(),i=typeof n?.content=="string"?n.content:"";if(o){if(o==="system"&&r.length>0&&r[r.length-1]?.role==="system"){r[r.length-1].content=`${r[r.length-1].content}

${i}`;continue}r.push({...n,role:o,content:i})}}return r}async function It(e,r={}){const n=K(),o=r.signal,i=Tt();W(o);const s=[];for(const l of Pt("system"))s.push({role:"system",content:await xe(l.content,o,i)});return s.push(...await tt(st(e),n.promptBlocks,l=>xe(l,o,i))),W(o),n.mergeConsecutiveSystemMessages?$t(s):s}async function Rt(e,r=!1,n={}){const o=z,i={time:Et(),ok:!1,model:"",requestMessages:[],rawReply:"",filteredReply:"",error:""};try{const s=n.api||await le("planner");ce(s),i.model=s.model;const l=await It(e,{signal:n.signal});i.requestMessages=l;const p=[...K().responseKeepTags],g=await Re(l,{...n,onDelta(h,y){n.onPreview?.(he(y,p,{partial:!0}))}},s);i.rawReply=g;const f=he(g,p);if(i.filteredReply=f,i.ok=!0,!M(o))throw Ee();return n.transient||_e(i),{rawReply:g,filtered:f}}catch(s){throw n.signal?.aborted||s?.name==="AbortError"?s:M(o)?(i.error=String(s?.message??s),n.transient||_e(i),r||de(i.error),s):Ee()}}function Mt(){const e=re(),r=e?.chatId;if(r==null||r==="")return"";const n=e?.groupId;return`${n==null?`character:${e?.characterId??e?.this_chid??""}`:`group:${n}`}:${r}`}var ne=dt({getContext:re,identity:Mt,enabled:()=>K().enabled,async resolveApi(){const e=await le("planner");return ce(e),e},plan:(e,r)=>Rt(e,!0,{...r,transient:!0}),onError(e){console.warn("[EnaPlanner] Planning failed:",e),de(String(e?.message??e))}});function X(){return{...K(),logs:v.logs}}function Nt(){if(Le("planner"),document.getElementById(oe))return;B=document.createElement("div"),B.id=oe,B.style.cssText=`
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: ${window.innerHeight}px;
        background: rgba(0,0,0,0.5);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    `;const e=document.createElement("iframe");e.src=gt,e.style.cssText=`
        width: min(1200px, 96vw);
        height: min(980px, 94vh);
        max-height: calc(100% - 24px);
        border: none;
        border-radius: 12px;
        background: #1a1a1a;
    `;const r=Ae("planner");r&&(B.removeAttribute("style"),B.className="tk-embedded-host",e.removeAttribute("style"),e.title="剧情规划",qe(e)),B.appendChild(e),(r||document.body).appendChild(B),te||(window.addEventListener("message",Pe),te=!0)}function ge(){Ae("planner")&&Oe();const e=document.getElementById(oe);e&&e.remove(),B=null}async function Lt(e){const r=B?.querySelector("iframe");if(!Fe(e,r))return;if(e.data?.type==="TEXT_API_REQUEST"){await Ue(e.data,"planner",s=>R(r,s));return}if(!e.data?.type?.startsWith("xb-ena:"))return;const n=z,{type:o,payload:i}=e.data;switch(o){case"xb-ena:ready":R(r,{type:"xb-ena:config",payload:X()});break;case"xb-ena:close":ge();break;case"xb-ena:save-config":{const s=i?.requestId||"",l=i&&typeof i.patch=="object"?i.patch:i,p=structuredClone(l||{}),g=await ve(f=>Object.assign(f,p));if(!M(n))return;g?(q.enabled||ne.cancel(),R(r,{type:"xb-ena:config-saved",payload:{...X(),requestId:s}})):R(r,{type:"xb-ena:config-save-error",payload:{message:"保存失败",requestId:s,config:X()}});break}case"xb-ena:reset-prompt-default":{const s=i?.requestId||"",l=structuredClone(ue().promptBlocks),p=await ve(g=>{g.promptBlocks=l});if(!M(n))return;p?R(r,{type:"xb-ena:config-saved",payload:{...X(),requestId:s}}):R(r,{type:"xb-ena:config-save-error",payload:{message:"重置失败",requestId:s,config:X()}});break}case"xb-ena:run-test":try{const s=await le("planner");if(ce(s),await Re([{role:"user",content:L.test}],{},s),!M(n))return;R(r,{type:"xb-ena:test-done"}),R(r,{type:"xb-ena:logs",payload:{logs:v.logs}})}catch(s){if(!M(n))return;R(r,{type:"xb-ena:test-error",payload:{message:String(s?.message??s)}})}break;case"xb-ena:logs-request":R(r,{type:"xb-ena:logs",payload:{logs:v.logs}});break;case"xb-ena:logs-clear":{if(G!==null){R(r,{type:"xb-ena:logs-clear-error",payload:{message:"日志正在清空，请稍候",logs:v.logs}});break}const s=structuredClone(v.logs),l=[];G=l;const p=await wt([]);if(!M(n))return;G===l&&(G=null),p?(v.logs=l,ae(),v.logs.length>0&&ie(),R(r,{type:"xb-ena:logs",payload:{logs:v.logs}})):(v.logs=[...l,...s],ae(),l.length>0&&ie(),R(r,{type:"xb-ena:logs-clear-error",payload:{message:"日志清空保存失败",logs:v.logs}}));break}case"xb-ena:debug-worldbook":try{const s=await Ct();if(!M(n))return;R(r,{type:"xb-ena:debug-output",payload:{output:s}})}catch(s){if(!M(n))return;R(r,{type:"xb-ena:debug-output",payload:{output:String(s?.message??s)}})}break;case"xb-ena:debug-char":{const s=kt();R(r,{type:"xb-ena:debug-output",payload:{output:s}});break}}}async function Yt(){const e=z;try{if(await se,await Z.waitForQueuedWrites(),!M(e)||!await yt(e)||!M(e))return!1}catch{return!1}return bt(),ne.install(),window.tavernKitchenEnaPlanner={openSettings:Nt,closeSettings:ge},!0}function Jt(){z++,Q=!1,q=null,v.logs=[],G=null,ne.cleanup(),ge(),te&&(window.removeEventListener("message",Pe),te=!1),delete window.tavernKitchenEnaPlanner}export{Jt as cleanupEnaPlanner,Yt as initEnaPlanner};
