import { invoke } from '@tauri-apps/api/core';

export async function getImgBase64ByIpc(typeString: string, id: number) {
    let basse64 = await invoke<string>('get_asset_base64', { typeString, id });
    console.log('basse64', basse64);
    return basse64;
}
