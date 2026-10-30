export const TEXT_API_COPY = Object.freeze({
    title: 'API 配置档案', host: '沿用酒馆', unset: '未选择配置',
    features: { summary: '剧情总结', planner: '剧情规划', memory: '剧情助手', world: '世界与地图后台', l0: '召回语义整理', embedding: '向量嵌入', rerank: '召回重排' },
    load: '加载中…', retry: '重试', save: '保存配置', saved: '已保存', saving: '保存中…',
    add: '新增配置', rename: '重命名配置', remove: '删除配置',
    name: '配置名称', duplicate: '已存在同名配置', emptyName: '请输入配置名称',
    last: '至少要保留一套配置', missing: '配置不存在，请重新选择',
    provider: '渠道', url: '接口地址', key: 'API Key', model: '模型',
    show: '显示', hide: '隐藏', pull: '拉取模型', test: '测试连接', testing: '测试中…',
    testOk: '生成测试成功', pulling: '拉取中…', manual: '手动填写',
    stream: '流式输出', temperature: '温度', maxTokens: '最大输出 Token',
    sampling: '生成参数', prefix: '路径前缀', autoPrefix: '自动', customPrefix: '自定义',
    reasoning: '思考模式', effort: '思考强度', budget: '思考 Token 预算',
    inherit: '不发送', plannerKey: '剧情规划需要填写所选配置的 API Key',
    modelRequired: '请填写模型名称', urlRequired: '请填写 API 地址',
    unavailable: '配置尚未加载，请重试', invalid: 'API 配置配置格式无效',
    requestFailed: '请求失败',
    saveFailed: 'API 配置保存失败', timeout: '请求超时', cancelled: '请求已停止',
    emptyResponse: '接口未返回正文', hostUnavailable: '酒馆生成模块尚未加载',
    modelListAuth: '模型列表鉴权', modelCount: count => `${count} 个模型`,
});

export function deletionMessage(name, replacement, features) {
    const affected = features.map(feature => TEXT_API_COPY.features[feature]).join('、');
    return `删除配置“${name}”？${affected ? `\n${affected}将使用“${replacement}”。` : ''}`;
}
