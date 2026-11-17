import { OPENING } from '../modules/world-records/opening.js';

export const OPENING_SKIP_KEY = 'tavernKitchenOpeningSkipped';
export const OPENING_GATE_TYPES = new Set(['normal', 'continue', 'group']);
const AFFIRMATIVE = 1, NEGATIVE = 0;

export function openingGateNeeded(state, context) {
    if (!context?.chat?.length) return false;
    if (context.chatMetadata?.[OPENING_SKIP_KEY] === true) return false;
    return !state?.sources?.[OPENING];
}

/**
 * Three-way first-send gate: initialize now, persist a per-chat skip, or keep
 * the user's draft and abort. Only the explicit negative answer may pass.
 */
export async function askOpening({ context, initialize, saveSkip, onProgress = () => {} }) {
    if (typeof context?.Popup !== 'function') throw new Error('无法打开世界初始化确认窗口，请手动打开「世界生成」完成初始化');
    const PopupType = context.POPUP_TYPE || { CONFIRM: 2 };
    const Result = context.POPUP_RESULT || { AFFIRMATIVE, NEGATIVE };
    const result = await new context.Popup(
        '当前聊天尚未建立世界档案。是否现在进行世界初始化？初始化完成前不会发送本轮正文。选择「否」将在本聊天跳过初始化，之后仍可从侧栏手动生成世界。',
        PopupType.CONFIRM,
        '',
        { okButton: '是，初始化', cancelButton: '否，跳过' },
    ).show();
    if (result === null || result === undefined) return 'cancel';
    if (result === Result.NEGATIVE) {
        await saveSkip();
        return 'skip';
    }
    if (result !== Result.AFFIRMATIVE) throw new Error('世界初始化确认结果无效');
    onProgress('正在初始化世界档案，完成后将自动继续发送…');
    await initialize();
    return 'initialized';
}
