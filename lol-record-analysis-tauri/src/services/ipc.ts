import { invoke } from '@tauri-apps/api/core';

export async function getImgBase64ByIpc(typeString: string, id: number) {
    let basse64 = await invoke<string>('get_asset_base64', { typeString, id });
    return basse64;
}

export async function putConfigByIpc(key: string, value: any) {
    await invoke('put_config', { key, value });
}


export async function getConfigByIpc<T>(key: string) {
    return await invoke<T>('get_config', { key });
}