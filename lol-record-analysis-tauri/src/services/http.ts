// import { invoke } from "@tauri-apps/api/core";

// Resolve backend HTTP server port from Tauri command
// const port = await invoke<number>("get_http_server_port");

// Base URL for the local HTTP server
const baseURL = ``

// Public assets prefix (no trailing slash to avoid double slashes)
export const assetPrefix = `http://asset.localhost`

export { baseURL }
