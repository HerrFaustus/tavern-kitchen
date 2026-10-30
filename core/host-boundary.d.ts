// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Upstream host is untyped; build validates actual exported names.
type HostValue = any;
// SillyTavern external boundary. Build validation checks actual host exports.
declare module '*/PromptManager.js' {
    export const INJECTION_POSITION: HostValue;
}
declare module '*/SlashCommand.js' {
    export const SlashCommand: HostValue;
}
declare module '*/SlashCommandAbortController.js' {
    export const SlashCommandAbortController: HostValue;
}
declare module '*/SlashCommandArgument.js' {
    export const ARGUMENT_TYPE: HostValue;
    export const SlashCommandArgument: HostValue;
    export const SlashCommandNamedArgument: HostValue;
}
declare module '*/SlashCommandParser.js' {
    export const SlashCommandParser: HostValue;
}
declare module '*/custom-request.js' {
    export const ChatCompletionService: HostValue;
}
declare module '*/engine.js' {
    export const SCRIPT_TYPES: HostValue;
    export const getScriptsByType: HostValue;
    export const saveScriptsByType: HostValue;
}
declare module '*/extensions.js' {
    export const extension_settings: HostValue;
    export const getContext: HostValue;
    export const saveMetadataDebounced: HostValue;
}
declare module '*/group-chats.js' {
    export const generateGroupWrapper: HostValue;
    export const is_group_generating: HostValue;
    export const saveGroupChat: HostValue;
}
declare module '*/lib.js' {
    export const DOMPurify: HostValue;
}
declare module '*/openai.js' {
    export const chat_completion_sources: HostValue;
    export const getChatCompletionModel: HostValue;
    export const oai_settings: HostValue;
    export const openai_setting_names: HostValue;
    export const openai_settings: HostValue;
    export const promptManager: HostValue;
}
declare module '*/power-user.js' {
    export const power_user: HostValue;
}
declare module '*/script.js' {
    export const activateSendButtons: HostValue;
    export const cancelDebouncedChatSave: HostValue;
    export const chat: HostValue;
    export const chat_metadata: HostValue;
    export const deactivateSendButtons: HostValue;
    export const eventSource: HostValue;
    export const event_types: HostValue;
    export const extension_prompt_roles: HostValue;
    export const extension_prompt_types: HostValue;
    export const extension_prompts: HostValue;
    export const getCurrentChatId: HostValue;
    export const getRequestHeaders: HostValue;
    export const isChatSaving: HostValue;
    export const isStreamingEnabled: HostValue;
    export const is_send_press: HostValue;
    export const main_api: HostValue;
    export const name1: HostValue;
    export const saveChat: HostValue;
    export const saveSettings: HostValue;
    export const saveSettingsDebounced: HostValue;
    export const setCharacterId: HostValue;
    export const setCharacterName: HostValue;
    export const setExtensionPrompt: HostValue;
    export const setExternalAbortController: HostValue;
    export const setSendButtonState: HostValue;
    export const stopGeneration: HostValue;
    export const substituteParams: HostValue;
    export const substituteParamsExtended: HostValue;
    export const updateMessageBlock: HostValue;
    export const user_avatar: HostValue;
}
declare module '*/st-context.js' {
    export const getContext: HostValue;
}
declare module '*/utils.js' {
    export const debounce: HostValue;
    export const findChar: HostValue;
    export const getCharaFilename: HostValue;
    export const uuidv4: HostValue;
}
declare module '*/variables.js' {
    export const getGlobalVariable: HostValue;
    export const getLocalVariable: HostValue;
    export const setGlobalVariable: HostValue;
    export const setLocalVariable: HostValue;
}
declare module '*/world-info.js' {
    export const METADATA_KEY: HostValue;
    export const createNewWorldInfo: HostValue;
    export const createWorldInfoEntry: HostValue;
    export const deleteWorldInfoEntry: HostValue;
    export const getWorldInfoSettings: HostValue;
    export const loadWorldInfo: HostValue;
    export const newWorldInfoEntryTemplate: HostValue;
    export const onWorldInfoChange: HostValue;
    export const originalWIDataKeyMap: HostValue;
    export const reloadEditor: HostValue;
    export const saveWorldInfo: HostValue;
    export const selected_world_info: HostValue;
    export const setWIOriginalDataValue: HostValue;
    export const updateWorldInfoList: HostValue;
    export const world_info: HostValue;
    export const world_names: HostValue;
}
interface Window { toastr?: { info?(message: string): void; warning?(message: string): void; error?(message: string): void }; }

declare module '*/secrets.js' {
    export const findSecret: HostValue;
    export const SECRET_KEYS: HostValue;
}
